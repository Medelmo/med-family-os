# ADR-014 Recurrence: a small in-house engine over wall-clock times, no date library

Status: Accepted

## Decision
Implement recurrence in `domain/calendar/recurrence.ts` as a small pure
module supporting DAILY / WEEKLY / MONTHLY / YEARLY, an interval, weekly
by-weekday, and `count`/`until`. Convert between wall-clock times and
instants in `domain/calendar/timezone.ts` using the platform's `Intl`
timezone data. Add no date or recurrence dependency.

## Context
CLAUDE.md §7 is specific: "Recurring events must store recurrence rules
and a timezone… DST transitions must have tests." The requirement is
therefore not "support recurrence" but "be correct across DST", which
narrows the options more than it first appears.

`rrule` — the obvious library — expands rules in UTC and leaves the
timezone problem to the caller. Adopting it would still have required the
wall-clock↔instant conversion written here, so it would have added a
dependency without removing the hard part. A full date library (Luxon,
date-fns-tz) would supply the conversion, but for two functions whose
whole implementation is ~60 lines against timezone data the platform
already ships.

Full RFC 5545 was also rejected as a target. It covers rules a household
calendar never expresses ("the second-to-last workday of every third
month"); implementing or importing all of it would be carrying weight for
cases that will not arise, contrary to CLAUDE.md §14's preference for
simple architecture over premature generality.

The decisive design point is not the rule vocabulary but **where
occurrences are generated**. A recurring household event is defined in
wall-clock terms — "swimming, Tuesdays at 17:00" — so occurrences are
generated as wall-clock values and only then converted to instants, each
with the offset in force on *its own* date. Storing an instant and adding
seven days drifts by an hour across a transition, and the family arrives
at the pool at the wrong time.

## Consequences
- Two DST edge cases needed an explicit choice, and both are documented in
  `timezone.ts` and covered by tests: a time skipped by the spring-forward
  resolves *forward* (02:30 → 03:30) rather than throwing, and an
  ambiguous time on the autumn fall-back resolves to the *first* of its
  two readings.
- A monthly event on the 31st **skips** months that have no 31st rather
  than sliding to the 28th, which would invent a commitment on a day
  nobody chose.
- `count` is counted over the series, not over the query window, so "the
  first five lessons" means the same five whichever month is being viewed.
- Expansion is bounded (`MAX_OCCURRENCES`), because an open-ended daily
  rule queried over a decade would otherwise be a denial of service
  against the household's own server.
- If a genuine need for fuller RFC 5545 support appears — most likely from
  importing an external calendar in Phase 7 — revisit this ADR then. The
  rule is stored as structured JSON, so widening it is an additive change
  rather than a migration of stored text.
