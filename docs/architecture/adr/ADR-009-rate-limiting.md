# ADR-009 Rate limiting: in-process token bucket, no Redis

Status: Accepted

## Decision
Use `rate-limiter-flexible` with its Postgres-backed store (reusing the
existing `db` service) for rate limiting authentication and other
abuse-sensitive endpoints. Do not add Redis or another cache service.

## Context
`docs/security/security-model.md` requires rate limiting on authentication
and abuse-sensitive endpoints, but no mechanism was chosen. ADR-001 already
rejects added operational complexity for a one-household workload; adding a
Redis service purely for rate-limit counters would contradict that
reasoning (`docs/architecture/adr/ADR-001-modular-monolith.md`).

A Postgres-backed limiter reuses the one stateful service the deployment
already runs (`docs/architecture/deployment.md`), survives app container
restarts (in-memory limiters do not), and needs no new backup/restore
consideration since it lives in the same database already covered by
`docs/backup/backup-restore.md`.

## Consequences
- Add `rate-limiter-flexible` to `package.json` in Phase 1.
- `RateLimiterPostgres` speaks the `pg` (node-postgres) `Pool`/`Client`
  query interface, not the `postgres.js` tagged-template API Drizzle uses
  for domain queries (`infrastructure/db/client.ts`). Rather than force a
  mismatch, a small dedicated `pg.Pool` is created in
  `infrastructure/rate-limit/limiter.ts` solely for the limiter — same
  physical `db` container/database, a second lightweight connection pool.
  This is the concrete implementation of "reusing the existing db service"
  above: one Postgres instance, two client libraries for two different
  jobs.
- The limiter's table is created and owned by `rate-limiter-flexible`
  itself (`CREATE TABLE IF NOT EXISTS`, `tableCreated` left `false`) — it is
  intentionally **not** part of the Drizzle schema in `db/schema/`. It is
  infrastructure, not a domain aggregate, and is exempt from the
  household-tenancy/audit rules that apply to domain data.
- If the deployment ever moves to multiple app replicas behind a load
  balancer, the Postgres-backed store remains correct (unlike an in-memory
  limiter, which would under-count across replicas). This ADR should be
  revisited only if per-request latency from the Postgres round-trip proves
  material under real load.
