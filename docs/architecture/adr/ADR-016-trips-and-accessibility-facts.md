# ADR-016: The trip lifecycle, trip items, and accessibility verification

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 6 (Travel), vertical slice 6

## Context

`docs/domain/domain-model.md` defines Trip as "a bounded travel context"
and says nothing else. `docs/domain/state-machines.md` has no trip section
at all. `docs/architecture/module-boundaries.md` names the pieces —
"trips, participants, itinerary, packing, accessibility facts" — and
`docs/implementation/implementation-plan.md` orders slice 6 as
"Trips -> accessibility verification -> packing".

`docs/requirements/product-spec.md` lists "trip readiness" as an attention
trigger, and `docs/permissions.md` gives a CHILD a "participant-safe view"
of trips.

Everything else was a decision.

## Decision

### 1. There is no IN_PROGRESS or COMPLETED trip status

The lifecycle is `PLANNED -> CONFIRMED`, with `CANCELLED` and `ARCHIVED`
as ends, and `CONFIRMED -> PLANNED` for a booking that falls through.

Whether a trip is upcoming, happening now, or over is a fact about today's
date and the trip's own two date columns. Storing it as well would create
a second copy of that truth which needs a scheduled job to maintain, can
disagree with the dates it was derived from, and is simply wrong for any
household whose instance was switched off over the weekend. `tripPhase()`
computes it on read.

This is the same argument the attention engine rests on — "a projection,
not stored truth" — applied to a smaller thing, and the tests assert it by
reading the same row on three different days and getting three answers.

What *is* stored is precisely what a date cannot tell you: whether the
household has committed (`CONFIRMED`), given up (`CANCELLED`), or finished
with the record (`ARCHIVED`).

`CONFIRMED -> PLANNED` exists because bookings fall through. Without it a
household would have to either leave the record lying or cancel a trip it
is still taking.

### 2. Archiving an upcoming trip is refused

`ARCHIVE` from `CONFIRMED` requires the trip to be over. Archiving a trip
that has not happened yet takes it off every view that exists to prepare
for it, which is how a household ends up somewhere without the thing it
needed. Cancelling is the honest action for a trip that is not happening,
and `CANCELLED -> ARCHIVED` has no date condition.

This is the first rule in the codebase where a pure domain function needs
the household's own "today". It is passed in, never inferred (CLAUDE.md
§7) — the application command resolves the household timezone and hands it
down, exactly as the attention rules already do.

### 3. Itinerary, packing and access requirements share one aggregate

One `trip_item` table with a `kind`, not three tables.

All three answer the same question — "is this trip ready?" — and carry the
same shape: a title, who it concerns, whether it is settled. Three tables
would mean three queries, three authorization paths, and three chances for
the readiness count to disagree with itself.

What differs is which fields carry meaning, and that is documented per
field rather than enforced by separate tables. Two rules keep the
difference honest rather than sloppy:

- An access requirement cannot be "ticked off". It is answered.
- A packing line cannot be "verified".

Both are refused by the domain with their own rejection codes.

### 4. An answer to an access question must carry its source

`verification` is `UNVERIFIED | CONFIRMED | REFUSED`, and both answers
require a source — "phoned the hotel, spoke to Frau Müller" — and the date
it was given. A database `CHECK` enforces it as well as the domain,
because this is the whole feature: "the hotel is step-free" is worth
nothing without who said so and when. The household has to be able to
weigh it, re-check it, or hold someone to it on arrival.

**`REFUSED` counts as answered.** A household that knows the hotel has no
lift can act on that; treating it as an open question would nag them about
something they have already settled. Being told "no" is information, not
an unfinished task.

### 5. Readiness is counted, and counted from what the reader can see

`tripReadiness()` derives `{ outstanding, unverified, refused, total }`
from the items. Nothing is stored, for the same reason as §1: a stored
counter has to be maintained by every write path and is wrong the first
time one forgets.

On the detail page it is computed from the items **this reader is allowed
to see**, so the summary and the list underneath it always agree — the
same rule the finance totals follow, and for the same reason: a count that
includes rows the page refuses to show is a disclosure by arithmetic.

### 6. Preparation is a new kind of attention reason

product-spec.md's "trip readiness" is not the same thing as overdue.
Nothing is late, and the date has not passed — what matters is that the
window to act is closing. Two new reason codes, `UNVERIFIED_FACTS` and
`PREPARATION_INCOMPLETE`, fire only inside a **21-day** preparation
window, much longer than the 3-day "due soon" window, because the things
that cannot be fixed late need weeks.

`UNVERIFIED_FACTS` outranks `PREPARATION_INCOMPLETE`: a bag can be packed
the night before, and a hotel cannot grow a lift.

The candidate shape stays aggregate-agnostic. `PreparationContext` is
`{ outstanding, unverified }` and says nothing about trips, so an asset's
service checklist could use it unchanged — which is the same property that
let reimbursements reuse the waiting rules in Phase 5 without a new rule.

### 7. A child sees a trip because they are named as going on it

`docs/permissions.md` grants a CHILD a "participant-safe view", and the
participant list delivers it: the policy kernel gives a CHILD only what is
explicitly scoped to them.

Two consequences, both found by tests rather than by reasoning:

- **A trip with no participants is invisible to every child.** That is the
  correct reading of CLAUDE.md §5 ("Children ... never inherit adult
  access") rather than a gap — a trip nobody has been added to is a trip
  nobody has been told they are going on. The form says so where the
  participants are chosen.
- **An item naming nobody inherits the trip's participants.** The first
  draft scoped an unscoped item to nobody, which meant a child could see
  that a trip existed and not one line on it — the "participant-safe view"
  exactly inverted. `tripItemScope()` is now the single place that
  decides, used by both the read and the write path.

An item naming a person is scoped to that person, because "Lukas needs a
step-free bathroom" is narrower than the trip and health-adjacent.

## Consequences

- Trips carry `NORMAL` sensitivity, unlike expenses. A family holiday is
  ordinary household business, and the participant scope — not a
  sensitivity level — is what does the narrowing.
- There is no trip timeline aggregate. Cases have one because a case *is*
  a history; a trip's history is its itinerary, and the audit log already
  records who changed what.
- "Stale external verification" from product-spec.md is **not**
  implemented. Requirements record `verifiedOn`, so the data for it
  exists, but no staleness window is enforced: there is no evidence yet of
  what window matters, and a guessed one would either nag or lull. The
  unanswered case is the one that actually bites, and that is covered.
- Trip-linked deadlines, expenses and documents are not wired up.
  `docs/domain/domain-model.md` allows a deadline to link to a trip; doing
  it well needs the same generic linking work Phase 3 deferred.
