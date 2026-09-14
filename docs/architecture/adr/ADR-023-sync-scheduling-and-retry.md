# ADR-023: Syncs that happen without being asked, and a retry policy something actually enacts

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations)

Extends ADR-013 (where unattended work runs) and ADR-020 (provider
adapters and sync runs).

## Context

`docs/domain/state-machines.md` has contained
`FAILED -> RETRYING -> RUNNING` since Phase 0. ADR-020 implemented that
machine and tested every transition. `CLAUDE.md` §9 requires each adapter
to define a retry policy, and §8 says never to rely on a UI toast as proof
a side effect completed.

All of that was true and none of it did anything. The only thing that
could move a run through the machine was a person pressing "Sync now".
`RETRYING` was a state no code had ever written outside a unit test, and
the retry policy was a sentence in a document. An integration that failed
at 2am stayed failed until somebody noticed.

## Decision

### 1. One new column: `sync_interval_minutes`, nullable, defaulting to NULL

NULL means manual only, and that is what every existing connection gets.
A migration must not quietly start making outbound requests to somebody
else's server on behalf of a household that never asked — so the feature
is off until a person turns it on, per connection.

A floor of **15 minutes** is enforced in three places: the command, a
`CHECK` constraint, and the UI, which offers a fixed set of intervals
rather than a number field. A field that invites "5" and then refuses it
teaches the household nothing except that the app is fussy.

### 2. A run claims its connection by existing

```sql
CREATE UNIQUE INDEX sync_run_one_live_per_connection_uq
  ON sync_run (connection_id)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRYING');
```

**Not a row lock.** A sync makes network calls across up to ten pages, and
holding a transaction open for the duration is exactly what the rest of
this codebase refuses to do (it is why the outbox uses
`FOR UPDATE SKIP LOCKED` on small claims and the sync driver commits per
page).

So the claim is the row itself. A second scheduler tick, a rolling restart
briefly running two app containers, a developer's `pnpm dev` against the
same database, or a person pressing "Sync now" while a scheduled run is in
flight — all of them collide on this index and lose, rather than producing
two runs racing over one cursor. Postgres checks unique indexes on UPDATE
too, so this also covers the retry path, where a `FAILED` row *becomes*
live rather than a new row being inserted.

The violation is translated into `IntegrationRuleError("ALREADY_RUNNING")`
and shown as a sentence. Doing that correctly needs the error's `cause`
chain walked: Drizzle wraps the driver error, and the `PostgresError`
carrying SQLSTATE 23505 is one level down. Checking only the top level
looked right and would have shipped a raw constraint violation as a 500
the first time two syncs overlapped.

### 3. Abandoned runs are reaped

A claim that is never released wedges its connection forever, so a live
run older than **20 minutes** (`STALE_RUN_MS`) is presumed dead and moved
to `FAILED` — the transition the machine already allows from `RUNNING` —
with `error_kind = 'abandoned'`. That is deliberately distinguishable from
"the provider refused us", and being `FAILED` makes it retryable, which is
the right outcome: the work still needs doing.

Twenty minutes is comfortably longer than a bounded ten-page run with the
provider timeout on each, so a slow but living sync is never mistaken for
a dead one. A run found in `PENDING` or `RETRYING` with no `started_at` is
also reaped — that is a process that died between the insert and the first
transition, and it would wedge the connection just as effectively.

### 4. Retry backoff is in minutes, not seconds

5, 10, 20, 40 minutes, up to five attempts — then the run is left alone,
`FAILED` and visible with its error, and only a person or the next
scheduled run starts anything.

Much slower than the outbox's seconds-scale backoff, deliberately. An
outbox event is this application's own work and retrying costs a query; a
sync is a request to somebody else's server, and the likely causes — the
NAS is asleep, the container is restarting, the token has expired — are
not fixed by asking again in ten seconds. Retrying forever would turn one
misconfigured connection into a permanent, silent source of traffic
against a machine that is saying no.

A retry continues **the same run row**, incrementing `attempt`. "This has
failed four times in a row" is then one readable history rather than four
rows somebody has to correlate. A `PARTIAL` run is never retried: it
succeeded at something, and its remainder is the next *scheduled* run's
job, starting from the cursor it actually reached.

### 5. The scheduler has no actor, and that is the honest design

`runScheduledSync` and `retrySyncRun` take no `Actor` and perform no
authorization check.

There is no user here whose permissions could be checked. Inventing a
"system user" would put a name in the audit trail belonging to nobody, and
a fabricated actor is worse than an absent one.

What stands in for authorization:

- **Neither function is reachable from any route or Server Action.** Their
  only caller is the scheduler, which selects connections by the
  household's own stored interval. Neither can be pointed at an arbitrary
  connection by a request.
- **The household authorizes this once, by setting the interval** — and
  `setSyncInterval` *does* check permissions, owner or admin like every
  other change to an integration. That is the consent, and it is recorded
  in the audit trail with the person who gave it.
- **Every run the scheduler causes is audited with `actorUserId: null` and
  `metadata.trigger`** of `SCHEDULE` or `RETRY`. "Nobody" and "the
  schedule" are different answers and the trail gives both.

If a "retry this run" button is ever added, it must go through a command
that authorizes, exactly as `runSync` does.

### 6. It runs on the existing worker, and not on boot

A third timer alongside the outbox drain and the reminder scan
(ADR-013), every **5 minutes** by default — three times more often than
the most eager connection can possibly be due, which is enough.

It is the only loop in the application that makes an outbound request with
no person waiting, so it belongs where the other unattended work is and is
disabled by the same switch.

Unlike the other two, the first pass is **not** run immediately at
startup. A container that crash-loops would otherwise contact somebody
else's server on every boot, and the work is due within five minutes
anyway.

## Consequences

- One migration (`0012`). It reaps any pre-existing live runs before
  creating the index, because a database holding two would otherwise fail
  the migration and, worse, be left with wedged connections.
- `runSync` was split: `executeRun` drives a run, and the three entry
  points (manual, scheduled, retry) differ only in how the run came to
  exist and who to attribute it to. Two copies of that loop would have
  been two chances for the retry path to handle `PARTIAL` or the cursor
  differently from the first attempt.
- A household that sets an interval is agreeing to unattended outbound
  traffic. That is now stated on the page, in the summary line of every
  connection, rather than buried in a settings pane.
- `SYNC_SCAN_INTERVAL_MS` joins `OUTBOX_POLL_INTERVAL_MS` and
  `REMINDER_SCAN_INTERVAL_MS` as an operational knob.

## Alternatives considered

- **Cron, or a systemd timer, or a separate container.** Rejected for the
  same reason ADR-013 rejected a separate outbox worker: this is one
  household's workload, and a second deployment surface to run a loop that
  is idle almost all the time is a poor trade. It also puts the schedule
  outside the application, where the household cannot see or change it.
- **A `next_sync_at` column maintained by the scheduler.** Rejected: a
  second copy of a fact already derivable from `last_sync_at` and the
  interval, with its own drift and backfill story. Dueness is computed.
- **Row locking to claim a connection.** Rejected: it would hold a
  transaction open across network I/O.
- **Retrying indefinitely with a long cap.** Rejected: an expired token is
  not transient, and a household should not learn about their integration
  from their NAS's access log.
