ALTER TABLE "integration_connection" ADD COLUMN "sync_interval_minutes" integer;--> statement-breakpoint
-- Hand-added before the unique index below (ADR-023).
--
-- A migration runs while nothing is syncing, so any run still sitting in a
-- live state belongs to a process that is gone: it was abandoned when the
-- container stopped. Creating the index without clearing them would fail
-- on any database that happens to hold two, and would leave the rest
-- wedged — the index is what a run claims its connection with, so an
-- abandoned row blocks every future run on that connection.
--
-- Reaped rather than deleted: what happened is part of the record. FAILED
-- is where the state machine already allows RUNNING to go, and it is the
-- state the scheduler's own reaper uses for the same situation.
UPDATE "sync_run"
   SET "status" = 'FAILED',
       "finished_at" = coalesce("finished_at", now()),
       "error_kind" = coalesce("error_kind", 'abandoned'),
       "error_message" = coalesce("error_message", 'This run was interrupted and did not finish.')
 WHERE "status" in ('PENDING', 'RUNNING', 'RETRYING');--> statement-breakpoint
CREATE UNIQUE INDEX "sync_run_one_live_per_connection_uq" ON "sync_run" USING btree ("connection_id") WHERE "sync_run"."status" in ('PENDING', 'RUNNING', 'RETRYING');--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_sync_interval_floor" CHECK ("integration_connection"."sync_interval_minutes" is null or "integration_connection"."sync_interval_minutes" >= 15);
