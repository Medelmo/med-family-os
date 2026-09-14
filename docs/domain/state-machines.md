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
APPROVED -> PARTIALLY_REIMBURSED
PARTIALLY_REIMBURSED -> PAID
Any open state -> CANCELLED where business rules allow.

## Integration sync

PENDING -> RUNNING -> SUCCEEDED
RUNNING -> PARTIAL
RUNNING -> FAILED
FAILED -> RETRYING -> RUNNING

A sync run must never silently overwrite local edits.
