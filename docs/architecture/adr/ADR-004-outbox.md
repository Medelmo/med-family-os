# ADR-004 Transactional Outbox

Status: Accepted

Use an outbox table for reliable asynchronous side effects.

Reason: reminders and integrations must not depend on a request completing after the database transaction.
