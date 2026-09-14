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

## Integration sync

PENDING -> RUNNING -> SUCCEEDED
RUNNING -> PARTIAL
RUNNING -> FAILED
FAILED -> RETRYING -> RUNNING

A sync run must never silently overwrite local edits.
