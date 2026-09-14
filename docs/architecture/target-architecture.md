# Target Architecture

## Shape

Modular monolith with explicit ports/adapters.

```text
Browser
  |
  v
Next.js App Router
  |
  +--> UI / route handlers / server actions
  |
  v
Application layer
  |
  +--> Domain services / commands / queries / policies
  |
  +--> Ports
          |
          +--> PostgreSQL adapter
          +--> Notification adapter
          +--> Paperless adapter
          +--> Nextcloud adapter
          +--> Calendar adapter
          +--> Home Assistant projection
          +--> AI adapter
```

## Why modular monolith

The workload is one household, not a distributed organization. A modular monolith gives:
- simpler deployment
- one transaction boundary
- fewer operational failure modes
- easy local development
- easier backups
- clear future extraction points if ever needed

Microservices would add network, deployment and observability complexity without product benefit.

## Runtime

Docker Compose project:
- app
- postgres

Optional:
- backup worker

No public PostgreSQL port.

Reverse proxy remains external to the application stack.

## Failure behavior

### PostgreSQL unavailable
Readiness fails; app returns safe dependency error. No writes are accepted as “successful.”

### App container recreated
Persistent state remains in PostgreSQL and explicit application data volume.

### Host reboot
Compose restart policy + database healthcheck + application startup dependency.

### Integration unavailable
Core app remains usable; sync state becomes degraded and attention surfaces the failure.

## Outbox

Transactional changes create outbox records in the same DB transaction. A worker processes them with retries and idempotency.

## Search

Start with PostgreSQL FTS. Avoid adding Elasticsearch/OpenSearch until scale proves necessary.
