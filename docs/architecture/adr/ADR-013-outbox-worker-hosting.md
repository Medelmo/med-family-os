# ADR-013 Outbox worker runs in-process, claiming work with SKIP LOCKED

Status: Accepted

## Decision
The transactional outbox worker (ADR-004) runs **inside the `app`
container**, started once from Next.js's `instrumentation.ts` hook, on a
polling interval. It claims batches with
`SELECT ... FOR UPDATE SKIP LOCKED`, so more than one worker may run
safely without double-processing an event.

No separate Compose service, no external queue, no cron.

## Context
ADR-004 established the outbox but deliberately said nothing about where
the worker runs; `docs/audit/ARCHITECTURE_AUDIT.md` §8 carried that as an
open question to decide "in Phase 2 with a real workload" rather than
guess up front. That workload now exists.

A separate worker service was considered and rejected for the same reason
ADR-001 rejected microservices: this is one household's workload — a
handful of events an hour at most. A second container would double the
deployment surface, the restart policy, the log stream and the failure
modes, to run a loop that is idle almost all the time.

`LISTEN/NOTIFY` was considered and rejected as the *primary* mechanism:
it delivers no backlog to a worker that was down when the notify fired, so
it would still need a poll as a safety net. Polling alone is simpler and
its worst case is one interval of latency, which is irrelevant for
household reminders.

`FOR UPDATE SKIP LOCKED` is used even though only one worker is expected,
because it is what makes the "only expected" part unnecessary to enforce:
a rolling restart that briefly runs two app containers, or a developer
running `pnpm dev` against the production database, cannot produce
duplicate side effects.

## Consequences
- `instrumentation.ts` starts the loop once per server process, guarded so
  it does not run during `next build` or in the Edge runtime.
- Events carry `attempts`, `nextAttemptAt`, `lastError` and a terminal
  `FAILED` status: retries back off exponentially and then stop, leaving
  the row for inspection rather than retrying forever
  (CLAUDE.md §9: "retries, exponential backoff, deduplication,
  idempotency, failure state, observability, manual retry where
  appropriate").
- A failed event is visible in the database and in the logs; a "retry this
  event" admin surface is a reasonable later addition and needs no schema
  change.
- If this application is ever deployed as more than one replica, nothing
  needs to change — which is the point of claiming with SKIP LOCKED rather
  than assuming a singleton.
- The worker is disabled by setting `OUTBOX_WORKER_ENABLED=false`, so a
  developer can run the app without it competing for events with another
  instance.
