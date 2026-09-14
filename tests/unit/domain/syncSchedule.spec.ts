import { describe, expect, it } from "vitest";
import {
  MAX_SYNC_ATTEMPTS,
  MIN_SYNC_INTERVAL_MINUTES,
  STALE_RUN_MS,
  isStaleRun,
  isSyncLive,
  retryBackoffMs,
  retryDueAt,
  scheduledDueAt,
  type SchedulableRun,
} from "../../../domain/integrations/syncSchedule";
import type { SyncRunStatus } from "../../../domain/integrations/syncRun";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const minutesBefore = (n: number) => new Date(NOW.getTime() - n * 60_000);

function run(overrides: Partial<SchedulableRun> = {}): SchedulableRun {
  return { status: "FAILED", attempt: 1, startedAt: minutesBefore(30), finishedAt: minutesBefore(30), ...overrides };
}

describe("which runs hold their connection's slot", () => {
  it.each<[SyncRunStatus, boolean]>([
    ["PENDING", true],
    ["RUNNING", true],
    ["RETRYING", true],
    ["SUCCEEDED", false],
    ["PARTIAL", false],
    ["FAILED", false],
  ])("%s is live: %s", (status, live) => {
    expect(isSyncLive(status)).toBe(live);
  });

  // The three live states are exactly the three in the partial unique
  // index (db/schema/integrations.ts). If one list changes without the
  // other, either two runs race or a connection wedges — so they are
  // asserted to be the same list.
  it("matches the states the database treats as live", () => {
    const live = (["PENDING", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "RETRYING"] as SyncRunStatus[]).filter(
      isSyncLive
    );
    expect(live.sort()).toEqual(["PENDING", "RETRYING", "RUNNING"]);
  });
});

describe("reaping an abandoned run", () => {
  it("leaves a run that is still within its window alone", () => {
    expect(isStaleRun(run({ status: "RUNNING", startedAt: minutesBefore(19) }), NOW)).toBe(false);
  });

  it("gives up on one past the window", () => {
    expect(isStaleRun(run({ status: "RUNNING", startedAt: minutesBefore(21) }), NOW)).toBe(true);
  });

  it("is exactly at the boundary, not one tick either side", () => {
    const at = new Date(NOW.getTime() - STALE_RUN_MS);
    expect(isStaleRun(run({ status: "RUNNING", startedAt: at }), NOW)).toBe(true);
    expect(isStaleRun(run({ status: "RUNNING", startedAt: new Date(at.getTime() + 1) }), NOW)).toBe(false);
  });

  // The process died between inserting the run and starting it. Without
  // this the row would sit PENDING with no timestamp and block the
  // connection forever.
  it("gives up on a live run that never even started", () => {
    expect(isStaleRun(run({ status: "PENDING", startedAt: null, finishedAt: null }), NOW)).toBe(true);
  });

  it("never reaps a run that has already finished", () => {
    for (const status of ["SUCCEEDED", "PARTIAL", "FAILED"] as SyncRunStatus[]) {
      expect(isStaleRun(run({ status, startedAt: minutesBefore(600) }), NOW)).toBe(false);
    }
  });
});

describe("retry backoff", () => {
  // Minutes, not seconds. A sync is a request to somebody else's server,
  // and asking again in ten seconds does not fix a sleeping NAS.
  it("doubles from five minutes", () => {
    expect([1, 2, 3, 4].map(retryBackoffMs)).toEqual([5, 10, 20, 40].map((m) => m * 60_000));
  });

  it("does not go below the base for a nonsense attempt number", () => {
    expect(retryBackoffMs(0)).toBe(5 * 60_000);
  });

  it("holds a failed run until its backoff has elapsed", () => {
    const failed = run({ status: "FAILED", attempt: 1, finishedAt: minutesBefore(4) });
    expect(retryDueAt(failed)!.getTime()).toBeGreaterThan(NOW.getTime());

    const older = run({ status: "FAILED", attempt: 1, finishedAt: minutesBefore(6) });
    expect(retryDueAt(older)!.getTime()).toBeLessThan(NOW.getTime());
  });

  it("stops retrying once the attempts are spent", () => {
    expect(retryDueAt(run({ attempt: MAX_SYNC_ATTEMPTS - 1 }))).not.toBeNull();
    expect(retryDueAt(run({ attempt: MAX_SYNC_ATTEMPTS }))).toBeNull();
  });

  // A partial run did real work; its remainder is the next scheduled
  // run's job, starting from the cursor it reached. Retrying the row
  // would re-do what already succeeded.
  it("never retries a run that was not a failure", () => {
    for (const status of ["SUCCEEDED", "PARTIAL", "RUNNING", "PENDING", "RETRYING"] as SyncRunStatus[]) {
      expect(retryDueAt(run({ status }))).toBeNull();
    }
  });
});

describe("the schedule", () => {
  const connection = (overrides: Partial<Parameters<typeof scheduledDueAt>[0]> = {}) => ({
    enabled: true,
    syncIntervalMinutes: 60,
    lastSyncAt: minutesBefore(30),
    ...overrides,
  });

  it("is due once the interval has elapsed", () => {
    expect(scheduledDueAt(connection({ lastSyncAt: minutesBefore(59) }))!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(scheduledDueAt(connection({ lastSyncAt: minutesBefore(61) }))!.getTime()).toBeLessThan(NOW.getTime());
  });

  // The default, and the thing that stops a migration quietly starting
  // outbound requests for every existing connection.
  it("never schedules a connection with no interval set", () => {
    expect(scheduledDueAt(connection({ syncIntervalMinutes: null }))).toBeNull();
  });

  it("never schedules a disabled connection", () => {
    expect(scheduledDueAt(connection({ enabled: false }))).toBeNull();
  });

  // Somebody has just set an interval and expects something to happen.
  it("is due immediately when it has never synced", () => {
    expect(scheduledDueAt(connection({ lastSyncAt: null }))!.getTime()).toBeLessThan(NOW.getTime());
  });

  it("keeps the floor somewhere a household cannot argue with", () => {
    expect(MIN_SYNC_INTERVAL_MINUTES).toBe(15);
  });
});
