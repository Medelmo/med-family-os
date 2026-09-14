# ADR-002 Dedicated PostgreSQL

Status: Accepted

Use a dedicated PostgreSQL container for Med Family OS unless the homelab has a proven managed/shared PostgreSQL service with isolated database/user/backup controls.

Reason: independent lifecycle, simpler recovery, lower coupling.
