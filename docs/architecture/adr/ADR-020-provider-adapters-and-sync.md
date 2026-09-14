# ADR-020: Provider adapters, sync runs, and document references

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations), vertical slice 8

## Context

`docs/integrations/integration-contracts.md` defines what a Paperless
integration stores — "provider, externalId, title, document date, URL,
context links" — and adds "Do not copy OCR text by default". It also lists
what every adapter must support: timeout, retry with backoff, idempotency,
structured errors, auditability, credential rotation, sync health.

`docs/domain/state-machines.md` gives the sync lifecycle and one rule in
prose: **"A sync run must never silently overwrite local edits."**

CLAUDE.md §9 requires the core domain not to depend on provider-specific
types, and §13 says not to recreate Paperless.

## Decision

### 1. `PARTIAL` is why a sync run is a state machine

A run that imported eleven documents and choked on the twelfth has done
real, useful work **and** has not finished. Recording it as success loses
the error; recording it as failure re-imports eleven documents next time
and makes the counts meaningless.

So each page is imported in its own transaction, the connection's cursor
advances per page, and a failure after any progress ends as `PARTIAL` with
the progress *and* the error stored together. `nextCursorAfter` advances
past a successful or partial run and **not** past a failed one — nothing
about where a failed run stopped can be trusted.

A run that imported nothing cannot be called `PARTIAL`: that is a failure
wearing a friendlier name, and it would advance the cursor past documents
nobody has seen. The domain refuses it.

`PARTIAL` is terminal. Picking up where it left off is the *next* run,
starting from the cursor this one reached — resurrecting the record would
lose the history of what happened.

### 2. "Never overwrite local edits" is structural, not a comparison

Provider-owned and household-owned fields are **different columns**.
`title` is what Paperless calls the document and a sync overwrites it
freely; `titleOverride` and `note` are the household's and a sync cannot
reach them at all.

There is no "has this been edited?" flag to get wrong, no last-writer-wins
comparison, and no timestamp race — the question never arises because the
two never share a field. The cost is one extra column and a `displayTitle`
helper. The alternative, one `title` plus a dirty flag, fails the first
time a household edits a title through a path that forgot to set the flag.

### 3. Idempotency is a unique index, not adapter good behaviour

`(householdId, provider, externalId)` is unique. Re-running the same page
updates rather than duplicates, whatever the adapter does, and the
importer can be a plain read-then-write instead of a check-then-insert
race.

An unchanged row is **not** written — it is counted as skipped. A sync
that rewrites unchanged rows churns `updatedAt` and makes "what did this
run actually do?" unanswerable.

### 4. Stored failure messages are this application's own words

`FAILURE_MESSAGES` is a fixed table keyed by error kind. **No part of a
stored message comes from the thing that failed.**

This was not hypothetical. The first version stored
`error.message.slice(0, 300)`, and the adapter interpolated the underlying
fetch error into its own message. The integration test asserting that a
token never reaches a sync run failed immediately — an underlying fetch
error routinely names the URL it was called with, and a URL can carry a
credential. Both ends are now fixed: the adapter classifies without
echoing, and the driver ignores the message entirely.

### 5. Errors are classified by whether retrying could help

`ProviderError.kind` with a derived `retryable`. 401/403 are `auth` and
**not** retryable: a token that is wrong now will be wrong in five
minutes, and hammering an authentication endpoint is how an integration
gets a household's account locked. 429, network failures and 5xx are.

### 6. The adapter never trusts the provider's response

Every field is checked rather than destructured. A row that is not the
expected shape is skipped, not turned into a `DocumentReference` with
`undefined` in it — the household would see a broken entry and have no
idea why.

**The document URL is built from the configured base**, never taken from
the response. A URL from the provider would be an open redirect waiting to
happen, and these are links the household clicks. `isSafeDocumentUrl`
rejects anything but http(s), in the domain, at import *and* again at
render — a row could predate the check or arrive by a path that skipped
it.

### 7. Read-only, one page at a time, bounded

Nothing in the `DocumentProvider` port can write to a provider. §13 says
not to recreate Paperless, and an adapter that can only read cannot damage
the system of record.

`MAX_PAGES_PER_RUN` bounds a run. A first sync against ten thousand
documents would otherwise loop for minutes with the household unable to
tell whether it was working; stopping early is a `PARTIAL`, which is
exactly the state for "real progress, not finished".

### 8. Deletions are not synced

Knowing a document vanished from Paperless would need either a full
reconciliation every run or a provider-side change feed, and acting on it
would mean this app deleting a household's reference because a system it
does not own returned a shorter list. A reference to a document that has
moved is a broken link the household can see and fix; a reference this app
silently removed is information nobody gets back.

### 9. Integrations are OWNER/ADMIN only, and that is stricter than usual

`docs/permissions.md` says "none by default" even for an adult.
`authorizeIntegrationAccess` does not delegate to `canAccess`, because an
`ADULT` falls through its role branches to `true` — delegating would hand
every adult the ability to point a connection at a new base URL and store
a credential under it. That is configuration of where the household's data
goes, not use of the household's data.

Document *references* are a different matter and use the kernel unchanged:
they default to `SENSITIVE`, which keeps them from child accounts without
a rule of its own.

## Consequences

- Only Paperless has an adapter. A connection can be configured for
  Nextcloud or CalDAV and will refuse to sync with `NO_ADAPTER` — which is
  clearer than a run that silently imports nothing.
- The sync is manual ("Sync now"). Scheduling it belongs with the existing
  reminder scan (ADR-013's worker), and doing that before a household has
  used the manual one would be guessing at an interval.
- There is no retry loop yet. `FAILED -> RETRYING -> RUNNING` exists in the
  machine and is tested, but nothing drives it automatically; the household
  presses the button. Automatic retry needs a backoff policy per error
  kind, which is the same work as scheduling.
- A `MANUAL` document reference — one typed in rather than imported — is
  supported by the schema but has no UI yet.
