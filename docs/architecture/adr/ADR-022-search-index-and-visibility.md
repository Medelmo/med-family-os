# ADR-022: Generated `tsvector` columns, the `simple` configuration, and search results that can only be as visible as the record

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations), global search

Implements ADR-003, which chose PostgreSQL full-text search over search
infrastructure but did not say how.

## Context

`docs/requirements/product-spec.md` lists "Global search and contextual
links make information discoverable" under Retrieve;
`docs/design/screen-inventory.md` §4 is the screen;
`docs/architecture/module-boundaries.md` reserves `features/search` for
"Search projection and ranking".

Seven aggregates are worth searching — task, case, expense, reimbursement,
trip, asset, document reference — and every one of them carries a
visibility and a sensitivity that already governs whether a given household
member may open it.

## Decision

### 1. The index is a generated column, not a projection this app maintains

Each searchable table gains

```sql
search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', …)) STORED
```

with a GIN index on it (migration `0011`).

The alternative — a `search_document` table written by the application, or
a trigger, or an outbox-driven reindex — would have been a second copy of
the truth, and every copy needs a story for what happens when the two
disagree. A generated column cannot disagree with its row: PostgreSQL
recomputes it on every write, whatever performed the write. A title
corrected by a form, an importer, a sync run, or somebody's `psql` session
is searchable immediately and by construction. There is no reindex job to
run, no backfill to remember after a migration, and nothing to monitor.

The cost is that the indexed expression lives in the schema rather than in
TypeScript, so changing which columns are searchable is a migration. For a
household application that is the right way round.

### 2. `simple`, not `german` or `english`

A generated column's expression must be immutable, and `to_tsvector(text)`
— the one-argument form that reads the session's default configuration —
is not. So the configuration has to be named in the DDL, and it names one.

This household reads and writes both German and English, frequently in the
same sentence ("Pflegegrad appeal"). Naming `german` would stem German
well and mangle English; naming `english` would do the reverse. Either
choice silently degrades half of the household's own data, and "silently"
is the problem: nobody would ever see why a search missed.

`simple` stems nothing. It folds case and splits on word boundaries, and
that is all. Searching for a word finds that word.

What is given up is real and should be stated: `simple` does not match
"Anträge" when you type "Antrag", and it does not fold diacritics, so
"Muller" does not find "Müller". A test asserts that last one so it is
documented behaviour rather than a surprise. If it becomes a genuine
irritation, the fix is `unaccent` plus a second, language-tagged vector
column — additive, and a decision that should be made from real
complaints rather than in advance.

### 3. `websearch_to_tsquery`, not `to_tsquery`

`to_tsquery` raises a syntax error on input a person would plausibly type:
`a & | b`, an unclosed quote, a trailing operator, a bare `-`. From a
search box that means the page fails because somebody typed. A search that
can 500 on user input is not a search box, it is a trap.

`websearch_to_tsquery` never raises on arbitrary text and understands the
syntax people already know from every other search box: quoted phrases,
`or`, and a leading `-` to exclude. Seven hostile-ish inputs are asserted
not to throw.

### 4. Search never loads a title it has not been permitted to show

This is the security decision, and it is the same one ADR-021 made for
links: **a record appears in search results only if the actor may read
that record.** A result list that showed titles the reader cannot open
would be a way to enumerate the household's sensitive records — and the
title is usually the disclosure. "Consultant's letter" tells a child most
of what the sensitivity level was protecting.

The implementation makes that structural rather than careful.
`application/queries/search/search.ts` runs the full-text match and selects
**only ids and ranks** — it never reads a title, a description, or a
merchant. It then hands the bare ids to `resolveRecords`, the same function
links use, which is the single place that decides what a record is called,
where it lives, and whether this actor may see it.

Two things follow:

- Search cannot leak a title, because search never has one to leak.
- Search and links cannot drift apart, because they are not two
  implementations of the same rule. They are one.

A refused row is simply absent. No count of withheld results is reported,
because "3 results you may not see" is itself the disclosure.

### 5. The page is a GET form

`/search?q=…` — a plain `<form method="get">`, no Server Action. It works
before hydration and with JavaScript off entirely (asserted), the back
button and bookmarks behave, and a read stays a read.

The query does appear in the URL, against CLAUDE.md's rule that sensitive
data must not. The judgement: a search term is the household's own words
rather than a record's contents, the address never leaves the household's
own machine, and the only place this application writes a URL is the
request log, which logs `pathname` and not the query string (ADR-010). If
that last fact ever changes, this form must become a POST-and-redirect,
and the page's docblock says so.

### 6. Twenty rows per type, ranked

The cap is per type rather than overall, so one noisy category cannot crowd
out the rest — a household with four hundred expenses should still find the
case it was looking for. Ordering happens in the database (`ts_rank`, then
id) so the cap keeps the most relevant rows rather than an arbitrary
twenty, and so the same query returns the same order every time.

The cap is applied *before* authorization filtering, which means a reader
with narrower access sees fewer than twenty rather than causing a larger
scan. For a household of a handful of people that is the right trade; it
would not be for a multi-tenant application.

## Consequences

- One migration (`0011`) adds seven generated columns and seven GIN
  indexes. Storage grows by roughly the size of the indexed text again.
- Every new searchable aggregate needs a schema change, not a code change.
- Stemming is absent by design. Revisit with `unaccent` and a
  language-tagged column only in response to real complaints.
- `resolveRecords` became the authorization chokepoint for two features
  instead of one. That concentration is the point, and it is also a
  standing reason to be careful there: a defect in it is now a defect in
  both. Building search on it exposed exactly such a defect — it was not
  loading the person scope of tasks and cases, which held their scope in a
  join table rather than a column, so an adult outside a case's person
  scope could reach it through a link. Fixed, with a regression test that
  fails without the fix.

## Alternatives considered

- **A `search_document` projection table.** Rejected: a second copy of the
  truth, plus a reindex path to write, run, and monitor.
- **Trigram (`pg_trgm`) matching.** Rejected for now: better at typos and
  worse at multi-word relevance, and it does not rank. Worth revisiting
  alongside `unaccent` if fuzzy matching is what the household actually
  misses.
- **Searching the full text of documents.** Out of scope by CLAUDE.md §13:
  Paperless owns document contents, and this app indexes its own pointer —
  the title, the household's own title override, and their note.
