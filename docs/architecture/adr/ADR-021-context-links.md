# ADR-021: One generic link table, and links are only as visible as both ends

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations), context links

## Context

`docs/domain/erd.md` models `CASE }o--o{ DOCUMENT_REFERENCE :
contextualizes`, and `docs/integrations/integration-contracts.md` lists
"context links" among what a document reference carries. The same need
appeared in every phase since: an expense that belongs to a case, a
document that justifies a claim, an asset a warranty case is about, a trip
a booking confirmation belongs to. It has been deferred since Phase 3 and
was, by Phase 7, the most-deferred item in the project.

## Decision

### 1. One generic table, not a join table per pair

Seven linkable types would otherwise mean twenty-one join tables,
twenty-one authorization paths, and twenty-one places for the same rule to
be got subtly wrong.

The cost is that the database cannot enforce a foreign key — a generic
`targetId` cannot reference seven tables at once. That is paid for on
read: links are resolved by looking each end up in its own table, and an
end that no longer exists simply does not come back. A dangling link
disappears rather than rendering as a broken entry, and a test asserts it.

### 2. A link is visible only if the actor may read the record at the *other* end

This is the security-critical rule, and it is not "may read the record
they are looking at".

A `NORMAL` case linked to a `SENSITIVE` document would otherwise tell a
child account that the document exists and what it is called — most of
what the sensitivity was protecting. So `resolveRecords` runs every far
end through the policy kernel with the same inputs that record's own list
query uses, and a link whose far end does not resolve is simply not
returned.

Creating and removing a link require the same: a household member who
cannot see a record has no business asserting what it relates to, nor
learning it exists by linking to it and seeing whether the call succeeded.

**An unreadable record is reported as not found, not as forbidden.** For
the far end of a link, a refusal that distinguishes the two is a way to
test whether something is there.

### 3. Storage is canonical, not directional

"These two are related" is symmetric: linking a document to a case and
linking a case to a document are the same fact. Storing whichever order
the caller passed would let both rows exist, which means a unique index
cannot prevent duplicates and every read has to check two directions.

So the pair is sorted into a fixed order before writing, a unique index
does the work, and `otherEnd` figures out which column a record landed in
on read.

**The order is the enum's declaration order, not alphabetical.** PostgreSQL
compares enum values by declaration order and a `CHECK` constraint
enforces canonical ordering, so comparing type names as strings in
TypeScript would disagree with the database for any pair whose two orders
differ. `task` and `expense` are exactly such a pair, and the first draft
would have had every task-expense link rejected by the constraint. Ranking
by index into `LINKABLE_TYPES` makes the two definitions the same one.

### 4. Linking the same pair twice is a no-op

`onConflictDoNothing`, not an error. Two people reaching the same
conclusion about two records is not a conflict worth interrupting either
of them for.

## Consequences

- Only the case detail page offers linking so far. The mechanism is
  type-agnostic, so adding it to a trip, an asset or a claim is a section
  on that page rather than new schema.
- The picker is bounded per type and recent-first. It is for "the thing I
  was just looking at"; a household that needs to search for it needs
  search, not a longer dropdown. It is filtered through the policy kernel
  for the same reason the links are — a list of things you may not open
  would tell you they exist.
- A link carries an optional note, because "these are related" is less
  useful a year later than "this is the refusal we are appealing".
- Two UI defects surfaced from this work and were fixed at their source
  rather than locally:
  - `TextField.module.css` gave fields no `max-width`, and a `<select>`
    sizes itself to its widest option. A long record description in the
    picker pushed the page 24px wider than a 412px phone. Every select in
    the app had this latent.
  - The unlink button rendered the full record name so a screen reader
    would hear which one it removes. That made it 395px wide. It now shows
    "Unlink" and carries the full name as its accessible name — which
    still satisfies WCAG 2.2 SC 2.5.3, because the accessible name begins
    with the visible word.
