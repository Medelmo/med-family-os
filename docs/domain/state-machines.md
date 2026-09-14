# State Machines

## Task

INBOX -> PLANNED -> IN_PROGRESS -> COMPLETED
INBOX -> CANCELLED
PLANNED -> WAITING
IN_PROGRESS -> WAITING
WAITING -> IN_PROGRESS
PLANNED -> CANCELLED
IN_PROGRESS -> CANCELLED

Rules:
- COMPLETED requires completion timestamp.
- WAITING requires waitingFor + followUpAt unless explicitly marked indefinite.
- IN_PROGRESS requires an owner.
- Reopening a completed task creates an audit event.

## Case

DRAFT -> ACTIVE -> WAITING -> ACTIVE -> COMPLETED
ACTIVE -> BLOCKED -> ACTIVE
DRAFT/ACTIVE/WAITING/BLOCKED -> CANCELLED
COMPLETED -> ARCHIVED

WAITING requires:
- waitingFor
- waitingSince
- followUpAt or explicit no-follow-up reason
- optional externalReference

BLOCKED requires a blocking reason.

## Reimbursement

PLANNED -> SUBMITTED -> WAITING -> APPROVED -> PAID -> COMPLETED
SUBMITTED -> REJECTED
WAITING -> REJECTED
APPROVED -> PARTIALLY_REIMBURSED
PARTIALLY_REIMBURSED -> PAID
Any open state -> CANCELLED where business rules allow.

"Any open state" means PLANNED, SUBMITTED, WAITING, APPROVED,
PARTIALLY_REIMBURSED. PAID is not open: the money has arrived, and
cancelling would record something untrue — a paid claim is closed with
COMPLETED.

REJECTED, COMPLETED and CANCELLED are terminal. An appeal is a new claim,
not a resurrected one.

WAITING requires:
- followUpAt or explicit no-follow-up reason

SUBMITTED requires a counterparty. REJECTED requires a reason.
PARTIALLY_REIMBURSED requires a payment smaller than the claim; a payment
covering the whole claim is PAID. PAID does not require the full claimed
amount — counterparties routinely pay less than was asked.

WAITING -> REJECTED and the enumeration of "any open state" were added in
ADR-015; see that record for the reasoning.

## Trip

PLANNED -> CONFIRMED
CONFIRMED -> PLANNED
PLANNED/CONFIRMED -> CANCELLED
CONFIRMED/CANCELLED -> ARCHIVED

There is deliberately no IN_PROGRESS or COMPLETED state: whether a trip is
upcoming, happening or over is derived from its dates and today's date,
never stored. See ADR-016.

ARCHIVED from CONFIRMED requires the trip to be over. Cancelling is the
action for a trip that is not happening; archiving an upcoming one would
remove it from the views that exist to prepare for it.

CONFIRMED -> PLANNED exists because bookings fall through.

ARCHIVED is terminal.

## Accessibility requirement (trip item)

UNVERIFIED -> CONFIRMED
UNVERIFIED -> REFUSED

Both answers require a source and the date it was given. REFUSED is an
answer, not an unfinished question.

## Asset

Deliberately none. An asset is owned, and then one day it is not; that is a
single fact with a date (`disposedOn`), not a lifecycle. See ADR-017 for
the test applied: does a human ever have to decide which state it should be
in next?

A maintenance record is append-only and cannot be dated in the future.
A warranty cannot end before it starts.

## Integration sync

PENDING -> RUNNING -> SUCCEEDED
RUNNING -> PARTIAL
RUNNING -> FAILED
FAILED -> RETRYING -> RUNNING

A sync run must never silently overwrite local edits.
