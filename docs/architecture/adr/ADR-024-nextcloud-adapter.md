# ADR-024: One Nextcloud folder, read over WebDAV, with a hand-written multistatus reader

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations)

Second implementation of the `DocumentProvider` port from ADR-020.

## Context

`docs/integrations/integration-contracts.md`, in full: "Purpose: file links
and optionally selected attachment storage. **Do not mirror the full
Nextcloud tree.**"

Nextcloud has no document API in the Paperless sense. Its files are reached
over WebDAV — `PROPFIND` against
`/remote.php/dav/files/<account>/<path>/`, authenticated with HTTP Basic —
and the response is an XML `multistatus` document rather than JSON.

## Decision

### 1. A connection is one folder, not an account

Two new nullable columns on `integration_connection`: `username` and
`remote_path`. The listing is `Depth: 1`. Subfolders are recognised as
folders and skipped, not descended into.

That is the contract's sentence, implemented literally. A household that
wants two folders makes two connections — which also gives them two health
rows, two schedules and two things to switch off independently, all of
which are better than one connection with a tree inside it.

`Depth: infinity` is what "mirror the full tree" would look like. Many
servers refuse it anyway, but the reason not to use it here is the
contract, not the server.

### 2. The username is a column; only the app password is sealed

A Nextcloud account name is not a secret — the household reads it in their
own Nextcloud — and the WebDAV path is per-account, so it is part of the
*address*. Sealing it would mean opening the credential vault to build a
URL, and would put a non-secret behind a decryption step for no gain
(ADR-019 exists to keep secrets out of ordinary tables, not to put
ordinary values into the vault).

Both `username` and `remote_path` become URL path segments, so both are
constrained in three places: the connect command refuses a `/`, a line
break or a `..` segment; a `CHECK` constraint refuses the same, so no
import or hand-run `UPDATE` can store one; and `filesUrl` encodes every
segment regardless. A traversal is **refused rather than resolved** —
resolving it would silently read a folder the household did not name.

The UI asks for an **app password**, not the account password, in both
languages. A per-application credential is revocable without changing the
account's own password, which is the difference between "rotate the
integration" and "lock everyone out of Nextcloud".

### 3. The identity is `oc:fileid`, not the path

A file id survives a rename and a move within the account. Keying the
upsert on it means renaming a document in Nextcloud *updates* the
household's reference, keeping the note and the title override attached to
it.

Keying on the path would have created a second reference and orphaned the
first — experienced by the household as their own notes silently detaching
from their documents, with no error anywhere. An entry with no usable file
id is skipped rather than imported, because an import with no stable
identity would duplicate itself on every run.

The stored link is `{base}/index.php/f/{fileid}` — Nextcloud's own
permalink, built from the configured base and the id, never from the
`href` in the response. A URL taken from a provider response is an open
redirect waiting to happen, and the household clicks these.

### 4. No cursor, and the size cap says so out loud

A `PROPFIND` returns the whole folder in one response. There is nothing to
page through, and slicing it into pages would mean re-fetching the same
body. `nextCursor` is always null and the run is one request.

The incremental version is a `REPORT` with `sync-collection` (RFC 6578)
and a sync token, which Nextcloud supports. It is worth doing when a
household has a folder large enough to care — and until then, an 8 MB
response cap and a 5,000-entry cap fail loudly rather than degrading
quietly. The body is measured as it streams, because `content-length` is
optional and a chunked response will not have one, and the reader is
cancelled on refusal so the server stops sending.

### 5. The multistatus reader is hand-written, and is not an XML parser

CLAUDE.md §16 asks for a reason before a dependency. There are two.

The ordinary one: this reads one highly constrained document and takes
four leaf values out of each entry. The project already made this call,
hand-writing an RFC 4180 reader in `domain/finance/csv.ts` rather than
taking a CSV dependency.

The security-shaped one is the more interesting. **The scanner does not
resolve entities, and cannot.** No DTD handling, no external entity
resolution, no entity expansion — so XXE and billion-laughs are not
*mitigated*, they are absent. A general parser would have to be configured
into that same position, correctly, and stay configured across upgrades.
Both attacks are asserted in the tests to do nothing at all.

What is given up must be stated plainly: this is not an XML parser and
must never be described as one. It matches on local names, and does not
understand namespaces properly, comments, processing instructions or mixed
content. It would be the wrong tool for a format anyone is free to shape.

The mitigation for mis-parsing is strictness plus tests against the shapes
a real Nextcloud sends: the folder itself as the first entry, the second
`404` propstat whose empty elements would otherwise overwrite good values,
other namespace prefixes, percent-encoded and entity-escaped filenames,
CDATA, and an unterminated entry that must not take the rest of the
listing down with it.

### 6. `getlastmodified` is the date, and it is honest about what it is

WebDAV offers no "document date" the way a Paperless record does. The
modified time is what there is; it is accurate as "when this last
changed", and it is what the documents list orders by.

## Consequences

- One migration (`0013`), two nullable columns, two `CHECK` constraints.
- `runSync` gained `adapterFor` — the one place provider identity becomes
  provider code. Everything on either side of it stayed provider-agnostic,
  which is why the second adapter was a new file and a function rather
  than a change to the sync driver, the run machine or the scheduler.
- CalDAV remains configurable and unreadable, and says so.
- Deletion is still not reported, per the port's existing decision: a
  reference to a moved document is a broken link the household can see and
  fix; one this app removed is information nobody can get back.

## Alternatives considered

- **`fast-xml-parser` or similar.** Rejected — see §5. Revisit if this
  application ever needs to read XML it does not control the shape of.
- **Keying on the path.** Rejected: renames become duplicates. See §3.
- **Recursive listing with a depth limit.** Rejected: it is the thing the
  contract forbids, wearing a smaller number.
- **Storing the username inside the sealed credential.** Rejected: it
  would require opening the vault to build a URL, and it is not a secret.
- **Nextcloud's OCS API instead of WebDAV.** Rejected: OCS covers sharing,
  users and capabilities, not file listing. WebDAV is the file interface.
