# ADR-007 Case state machine: retain the 7-state model with distinct WAITING/BLOCKED

Status: Accepted

## Decision
`docs/domain/state-machines.md` is authoritative for the Case lifecycle:

```text
DRAFT -> ACTIVE -> WAITING -> ACTIVE -> COMPLETED
ACTIVE -> BLOCKED -> ACTIVE
DRAFT/ACTIVE/WAITING/BLOCKED -> CANCELLED
COMPLETED -> ARCHIVED
```

A simpler five-state model (Draft/Active/Waiting/Resolved/Archived) was
considered and rejected.

## Context
WAITING and BLOCKED are semantically different and drive different attention
behavior (`docs/requirements/product-spec.md` attention inputs):
- WAITING means the case is stalled on an external party — it requires
  `waitingFor`, `waitingSince`, and `followUpAt` so the attention engine can
  surface it when the follow-up date arrives.
- BLOCKED means the case is stalled on an internal dependency (missing
  document, unresolved decision) — it requires a blocking reason, not a
  follow-up date, and should not silently age out of view the way a WAITING
  case's follow-up clock does.

Collapsing both into a single "Waiting" state would force the attention
engine to guess which kind of stall it is, defeating the "waiting list
becomes a graveyard" fix already identified in
`docs/research/deep-audit.md` item 1.

An explicit CANCELLED terminal state (distinct from ARCHIVED, which is only
reachable from COMPLETED) also preserves the difference between "this case
was abandoned" and "this case was resolved and is now historical" —
important for statistics and for not showing abandoned cases as successes.

## Consequences
- Case commands must implement all transitions listed above, each requiring
  the fields CLAUDE.md/security-model specify (actor, timestamp, reason
  where applicable, auditability, idempotency).
- The attention engine (Phase 2) reads BLOCKED and WAITING as distinct
  attention inputs, not a single "waiting" bucket.
- Any future simplification of this state machine requires superseding this
  ADR, not a silent doc edit.
