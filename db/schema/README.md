# Database schema

Implement schema from `docs/domain/domain-model.md` after Phase 0 validation.

Recommended conventions:
- UUIDv7 or equivalent time-sortable IDs where supported
- bigint integer minor units for money
- explicit foreign keys
- indexes on householdId + lifecycle/date fields
- unique provider/external IDs
- optimistic concurrency version columns
- audit/outbox/sync tables separated from business aggregates
