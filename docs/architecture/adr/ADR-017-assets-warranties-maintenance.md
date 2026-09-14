# ADR-017: Assets have no state machine; cover ending is not a deadline

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 6 (Assets), vertical slice 7

## Context

`docs/domain/domain-model.md` gives three lines: Asset is "a durable
household object", Warranty is a "coverage interval associated with an
asset", and MaintenanceRecord appears only in CLAUDE.md §3's list.
`docs/domain/state-machines.md` says nothing about any of them.
`docs/requirements/product-spec.md` lists "upcoming warranty" as an
attention trigger, and `docs/permissions.md` gives a CHILD "explicit"
access to assets.

## Decision

### 1. An asset has no state machine

Cases, trips and reimbursement claims each have one because each is a
*process* the household is working through, where the legal next steps are
the point. A washing machine is not a process. It is owned, and then one
day it is not — sold, broken, given away — which is a single fact with a
date, not a lifecycle.

`PLANNED/ACTIVE/RETIRED` would have produced states nobody transitions
deliberately and which drift out of date the moment someone forgets.
`disposedOn` (with an optional note) records the only transition there is,
and it happens once.

This is worth stating because the last three slices all added a state
machine, and the reflex to add a fourth was the thing to resist. The test
for "does this need one?" is whether a human ever has to decide which
state it should be in next.

### 2. Cover ending is not the same thing as a deadline

An asset carries two dates, deliberately in two different fields:

- `dueOn` — the next service. Something is **owed by** that date, so it
  can be overdue, and an overdue service should keep being said.
- `expiresOn` — when the warranty runs out. A protection **ends on** it.
  The useful moment to act is *before*, with enough notice to decide
  whether to claim, extend or replace, and once it has passed there is
  nothing left to do.

So a new reason code, `COVER_ENDING`, with its own **30-day** window —
longer again than the 21-day preparation window, because deciding what to
do about a lapsing warranty is not an afternoon's work. And unlike
`OVERDUE`, it **goes silent once the date passes**: a list that keeps
mentioning last year's warranty is a list people stop reading.

The candidate field is named `expiresOn` rather than `warrantyEndsOn`
because the same shape fits a passport, a permit or an insurance policy,
and the rules module stays aggregate-agnostic.

### 3. Sensitivity is decided by category, not by the person recording it

`MEDICAL` and `MOBILITY` assets are raised to `SENSITIVE`; everything else
is `NORMAL`. A wheelchair or a nebuliser in the asset list says something
about a household member's health, which CLAUDE.md §5 keeps away from
child accounts and §10 keeps out of the Home Assistant projection. A
dishwasher says nothing about anybody.

Doing it from the category rather than asking makes the safe answer the
automatic one — the same argument that made every expense `SENSITIVE` by
default (ADR-015 §4). A default that depends on someone remembering fails
open.

The column default cannot express "depends on the category", so the rule
lives in one place in `defaultSensitivityFor` and is tested there and in
the integration suite.

### 4. "Next service due" comes from the most recent record

Not the earliest outstanding `nextDueOn`. Each service supersedes the plan
the one before it set, so a machine serviced early in March is not still
due the date February's record predicted. Ties on the same day go to the
record entered last, because two services on one day means somebody
corrected the first.

### 5. "Cover ends" is the **latest** end date, across all warranties

Two overlapping covers — a retailer's year and a manufacturer's three —
leave the household protected until the later one runs out. Warning them
when the shorter one lapses would be crying wolf.

### 6. Service records are append-only

No update or delete path in application code, like the case and claim
timelines. A service history that can be edited afterwards cannot answer
"when was the boiler last serviced?", and answering that is the point.

A record may not be dated in the future, enforced in the domain and by the
form's `max`. Dating one forward would make "when was it last serviced?"
answerable with a date nobody has reached, and would quietly satisfy a
service that is actually overdue.

### 7. A CHILD gets "explicit" access, which is narrower than trips

`docs/permissions.md` says Assets → Child → "explicit", where Trips →
Child → "participant-safe view". Those are genuinely different, and the
difference is honoured rather than smoothed over: a child sees assets
scoped to them personally and **not** the household's own things.

So no scope inheritance here, unlike `tripItemScope()`. Sensitivity is a
second, independent gate: even an asset scoped to a child is refused if it
is `MEDICAL` or `MOBILITY`.

A first draft of the test asserted a child could see the household
dishwasher. The kernel refused it, and the kernel was right — the matrix
says so.

## Consequences

- Disposing of an asset removes it from the list and from Attention. A
  warranty on a machine that is gone is not something anybody needs
  reminding about, and that is what disposal is for. `includeDisposed`
  brings it back when the household is actually looking for it.
- Warranties and service records inherit the asset's authorization rather
  than carrying their own. They have no meaning apart from the thing they
  describe, and independent visibility would let a service record be
  readable when the machine it describes is not.
- Prices and service costs go through `parseAmountToMinor`, the same
  single documented money rule as every expense (ADR-015 §2).
- `disposeAsset`'s optimistic-concurrency check is unreachable by a
  sequential second call, because `ALREADY_DISPOSED` is checked first —
  which is the right order, since "this is already gone" tells the
  household more than "someone else changed it". The version check still
  earns its place against two *simultaneous* disposals, and that is what
  the test exercises.
- Not done: linking an asset to the expense that bought it, or to a case
  about a failed repair. Both want the generic linking work Phase 3
  deferred.
