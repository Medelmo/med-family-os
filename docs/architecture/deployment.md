# Deployment

## Preferred

Separate Compose project on the existing Docker host.

Services:
- `app`
- `db`

Networks:
- private internal network
- optional external reverse-proxy network

Volumes:
- postgres-data
- optional app-data

## Ports

Only the reverse proxy-facing app port should be published. PostgreSQL stays private.

The exact port must be configurable through environment variables and confirmed against the homelab.

## Resource target

Initial planning envelope:
- app: 0.5–1.5 CPU, 512MB–1.5GB RAM depending on build/runtime workload
- PostgreSQL: 0.5–2 CPU, 512MB–2GB RAM depending on dataset/backup workload

These are planning estimates, not verified host requirements.

## Existing host inspection required

Claude must not invent:
- CPU/RAM
- storage type
- reverse proxy
- Docker version
- network ranges
- backup target

Phase 0 should document the inspection commands and record findings in the deployment-feasibility report.
