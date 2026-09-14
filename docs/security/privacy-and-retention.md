# Privacy, Retention & Deletion

## Principles

- collect only what supports a product workflow
- prefer references to duplicated content
- separate person identity from login identity
- minimize highly sensitive fields
- make retention explicit
- make export human-readable

## Retention defaults

Operational records: retained until archived and household policy permits deletion.

Audit records: retained longer than operational records; deletion requires a documented policy.

Integration logs: retain enough for troubleshooting, then purge.

Failed sync payloads: never retain sensitive provider payloads unnecessarily.

## Deletion

Deleting a person does not silently delete financial/audit history. Use anonymization or archival rules where legal/domain semantics require it.

Before implementing hard deletion, document:
- child records
- external provider copies
- search indexes
- caches
- backups
- audit references

## Export

Export must include:
- manifest
- JSON
- CSV
- ICS where meaningful
- schema version
- application version
- generated timestamp
