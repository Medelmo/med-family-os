# Deployment Feasibility

## Current evidence

The provided repository does not contain actual mini-PC hardware inventory or Docker host configuration. Therefore host-specific capacity claims cannot be verified from the repository.

## Recommendation

Run as a dedicated Docker Compose project on the existing Docker host unless inspection reveals a concrete isolation/resource reason to use a VM/LXC.

## Inspection checklist

- `docker version`
- `docker compose version`
- `docker info`
- CPU cores
- RAM
- storage free space and filesystem
- existing reverse proxy
- existing backup system
- existing Docker networks
- host reboot policy
- current PostgreSQL services
- monitoring

## Questions this must answer before production

1. Can the host accommodate app + PostgreSQL?
2. Which reverse proxy is authoritative?
3. Where do encrypted backups live?
4. What hostname is used?
5. Is LAN-only access desired?
6. Is remote access via VPN or reverse proxy?
7. What is the recovery target?
8. What backup retention is practical?

## Decision

Do not create a new VM/LXC by default.
