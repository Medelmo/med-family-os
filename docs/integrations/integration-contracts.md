# Integration Contracts

## Paperless-ngx

Purpose: locate/open documents and optionally import metadata.

Core domain stores:
- provider
- externalId
- title
- document date
- URL
- context links

Do not copy OCR text by default.

## Nextcloud

Purpose: file links and optionally selected attachment storage.

Do not mirror the full Nextcloud tree.

## Calendar

Provider abstraction:
- read events
- optionally create/update events
- sync cursor
- provider event ID
- conflict policy

Initial product should not require Google Calendar.

## Home Assistant

Read-only projection:
- summary endpoint
- dedicated `/ha` page
- scoped credential

## Integration safety

Every provider adapter must support:
- timeout
- retry with backoff
- idempotency
- structured errors
- auditability
- credential rotation
- sync health
