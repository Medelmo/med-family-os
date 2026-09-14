# ADR-025: An export is what you can see, and a backup page that refuses to claim a tick

**Status:** Accepted
**Date:** 2026-09-15
**Phase:** 7 (Integrations), screens 48 and 49

## Context

CLAUDE.md §6 requires every durable record to define its export behaviour.
`docs/backup/backup-restore.md` lists an "export bundle" as the fifth
backup layer and sets out a restore drill whose steps 5 and 6 are "run
integrity checks" and "verify representative records".
`docs/design/screen-inventory.md` has carried 48 (Export) and 49
(Backup/restore status) since Phase 0 as the last two unbuilt screens.

## Decision

### 1. The export is filtered through the policy kernel, record by record

`buildExport` loads each aggregate and passes every row through the same
per-aggregate policy function its own list page uses —
`authorizeCaseAccess`, `authorizeExpenseAccess`, and the rest.

This is the whole security story of the feature, and it deserves stating
at full strength: **an export that read rows directly would be the most
complete authorization bypass the application could contain**, wearing the
friendly name "Export". Every other screen leaks one record at a time and
only to somebody looking for it. An export is one click, one file, all of
it.

So the bundle is *what this actor can see*. A child's export is small.
An adult outside a case's person scope does not get that case. A viewer
gets no finance. That is correct behaviour rather than a broken export,
and the file says so in its own `scope` field — because a file outlives
the page that produced it and the caveat has to travel with it.

Three narrower rules follow from the same principle:

- **Children of a parent go only when the parent goes.** A warranty has no
  visibility of its own; it belongs to its asset. Gathering warranties
  independently would leak the asset's existence through the back door.
- **A link is exported only when both ends are.** Same rule as ADR-021 and
  for the same reason: a link naming a record that is not in the file
  tells the reader it exists and what type it is.
- **A deny-list of columns, not an allow-list.** An allow-list is safer in
  the abstract and wrong here: the point of an export is that it contains
  the household's records, so a list of permitted fields would silently
  drop every column somebody forgot to add. The deny-list holds the few
  things that are not the household's data — the `tsvector`, anything that
  looks like a credential.

### 2. The download is a GET route, not a Server Action

An action returns a value to React. A download needs a response with its
own `Content-Disposition`, and every workaround ends with a base64 data
URL sitting in browser memory — the wrong place for a file of medical and
financial records.

GET rather than POST, even for the most sensitive read in the
application: it mutates nothing, so GET is the honest verb, and CSRF is
not the relevant risk — a cross-origin page can cause the request but
cannot read the response, and the worst it achieves is making somebody
download their own data.

The response carries `no-store, private` and `nosniff`. Every export is
audited as `household.exported` with the counts as metadata — counts are a
fact about the export, where a record would be a fact about the household.
"Somebody took a copy of everything they can see" is the single most
audit-worthy action here, being all the reads at once.

### 3. The backup page reports only what the application knows

It does not take the backups; they live in the household's homelab. **So
there is no green tick.** A "Backups: healthy" badge for a job this
process cannot observe would be the most dangerous thing on the page — a
reassurance with nothing behind it, believed precisely until the day it
mattered.

Instead it gives the restore drill its numbers: rows and newest timestamp
per table, schema version, size on disk, last export. Noted before a
restore, these turn "it seems to have worked" into a check. And it states
what the household must back up, with the one mistake that looks entirely
correct until the dump is stolen given its own emphasis rather than a
bullet among four: **`CREDENTIAL_KEYS` must not live where the database
backup lives**, or the encryption at rest protects nothing against the
attacker who has both (ADR-019).

### 4. Backup status is owner/admin, which is stricter than the row above it

`docs/permissions.md` gives an ADULT "limited" access to household
settings, implemented as read-only — and read-only is exactly the wrong
shape here, because everything on this page *is* a read of the whole
household. "There are 14 documents" told to somebody who can open three is
the aggregate form of the enumeration that search (ADR-022) and links
(ADR-021) both go to some trouble to prevent.

`docs/permissions.md` now carries its own rows for Backup status and
Export rather than leaving either to be inferred.

## Consequences

- **A pre-existing over-grant was found and closed.** The matrix has
  always said "Finance | Viewer | none by default"; `canAccess` applies a
  sensitivity ceiling to CHILD only, so a VIEWER passed straight through
  on any read and could see every expense and claim in the household. A
  viewer is the account somebody is given so they can see the calendar.
  Fixed in `authorizeExpenseAccess` and `authorizeBudgetAccess`, and an
  existing test that asserted the old behaviour was updated — it had
  encoded what the kernel did rather than what the matrix said.
- The export page runs the real query to show its counts, so the page
  cannot promise one thing and download another. That costs a page load
  on a household-sized dataset, which is the right trade.
- `buildExport` deliberately does not audit; the route does. A page
  computing its own counts is not somebody taking a copy.

## Alternatives considered

- **A database dump as the export.** Rejected: it needs PostgreSQL and
  this schema to mean anything, which is exactly the dependency an export
  exists to escape. It also cannot be authorization-filtered at all.
- **Export restricted to owners.** Rejected: taking your own data is not
  administration. Bounding it by what the role can already read is both
  safer and more useful than refusing everyone but one person.
- **A "last backup" field the household updates by hand.** Rejected: a
  number nobody remembers to update is worse than no number, because it
  looks like one that is maintained.
- **Counting tables from `information_schema`.** Rejected: it would grow
  silently to include session and rate-limit tables. Naming the schema
  objects keeps the list a decision — and, after the first version got two
  table names wrong by typing them, it keeps them correct by construction.
