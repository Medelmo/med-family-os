import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { auditEvents, documentReferences, integrationConnections, syncRuns } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import {
  connectIntegration,
  IntegrationRuleError,
  setIntegrationEnabled,
  setSyncInterval,
} from "../../application/commands/integrations/connectionCommands";
import { runSync } from "../../application/commands/integrations/runSync";
import { scanForSyncs } from "../../application/commands/integrations/scanForSyncs";
import { MAX_SYNC_ATTEMPTS, STALE_RUN_MS, retryBackoffMs } from "../../domain/integrations/syncSchedule";
import { ProviderError, type DocumentProvider } from "../../application/integrations/documentProvider";
import { AuthorizationError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * The sync scheduler (ADR-023), against a real database.
 *
 * `docs/domain/state-machines.md` has always contained
 * `FAILED -> RETRYING -> RUNNING`, and until now nothing drove it. These
 * tests are what makes the retry policy something the system does rather
 * than something a document claims.
 *
 * Time is passed in rather than waited for: every scheduling decision is a
 * function of a row and a clock, so forty minutes of backoff is one
 * argument, not a sleeping test.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

const NOW = new Date("2026-06-01T09:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const minutesLater = (m: number) => later(m * 60_000);

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor };
}

async function connected(displayName = "Paperless") {
  const { householdId, actor } = await household();
  const connection = await connectIntegration(actor, householdId, {
    provider: "PAPERLESS",
    displayName,
    baseUrl: "https://paperless.internal",
    apiToken: "paperless-secret-token-value",
  });
  return { householdId, actor, connection };
}

const doc = (id: string) => ({
  externalId: id,
  title: `Document ${id}`,
  documentDate: "2026-01-04",
  url: `https://paperless.internal/documents/${id}/details`,
});

/** A provider that replays scripted pages, and can be told to fail. */
function stub(pages: ({ documents: ReturnType<typeof doc>[]; nextCursor: string | null } | ProviderError)[]) {
  let index = 0;
  const provider: DocumentProvider = {
    id: "PAPERLESS",
    async listDocuments() {
      const next = pages[Math.min(index, pages.length - 1)];
      index += 1;
      if (next instanceof ProviderError) throw next;
      return next;
    },
  };
  return () => provider;
}

const onePage = stub([{ documents: [doc("1")], nextCursor: null }]);
const alwaysFails = stub([new ProviderError("network", "unreachable")]);

const latestRun = async (connectionId: string) =>
  (
    await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connectionId))
      .orderBy(desc(syncRuns.createdAt), desc(syncRuns.id))
      .limit(1)
  )[0];

describe("setting a schedule", () => {
  it("is off until somebody asks for it", async () => {
    const { connection } = await connected();
    expect(connection.syncIntervalMinutes).toBeNull();

    // The connection has never synced, so if an interval were set it would
    // be due at once. With none, the scan does nothing.
    expect(await scanForSyncs(NOW, { providerFactory: onePage })).toMatchObject({ scheduled: 0 });
  });

  it("refuses an interval that would hammer the provider", async () => {
    const { householdId, actor, connection } = await connected();

    await expect(setSyncInterval(actor, householdId, connection.id, connection.version, 5)).rejects.toBeInstanceOf(
      IntegrationRuleError
    );
    // And the database refuses it too, so no other write path can.
    await expect(
      db.update(integrationConnections).set({ syncIntervalMinutes: 1 }).where(eq(integrationConnections.id, connection.id))
    ).rejects.toThrow();
  });

  it("is a permission a household grants once, and only an owner or admin may", async () => {
    const { householdId, actor, connection } = await connected();
    const member = await addHouseholdMember(actor, householdId, {
      displayName: "Lukas",
      role: "ADULT",
      account: { email: "adult@example.test", temporaryPassword: "another correct horse battery" },
    });
    const adult: Actor = { userId: member.accountUserId!, householdId, role: "ADULT", personIds: [member.id] };

    await expect(
      setSyncInterval(adult, householdId, connection.id, connection.version, 60)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("records who set it, because the scheduler itself records nobody", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.householdId, householdId), eq(auditEvents.action, "integration.schedule_set")));

    expect(event.actorUserId).toBe(actor.userId);
    expect(event.metadata).toMatchObject({ intervalMinutes: 60 });
  });
});

describe("a scheduled sync", () => {
  it("runs a connection that is due, and does not run it again until the interval passes", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    expect(await scanForSyncs(NOW, { providerFactory: onePage })).toMatchObject({ scheduled: 1, unsuccessful: 0 });
    expect(await db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId))).toHaveLength(1);

    // Fifty-nine minutes later: not yet.
    expect(await scanForSyncs(minutesLater(59), { providerFactory: onePage })).toMatchObject({ scheduled: 0 });
    // Sixty-one: due again.
    expect(await scanForSyncs(minutesLater(61), { providerFactory: onePage })).toMatchObject({ scheduled: 1 });
  });

  it("attributes the run to nobody, and says the schedule caused it", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);
    await scanForSyncs(NOW, { providerFactory: onePage });

    const events = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.householdId, householdId), eq(auditEvents.resourceType, "sync_run")));

    expect(events.length).toBeGreaterThan(0);
    // No invented user. "Nobody" and "the schedule" are different answers,
    // and the trail records both.
    expect(events.every((e) => e.actorUserId === null)).toBe(true);
    expect(events.every((e) => (e.metadata as { trigger?: string })?.trigger === "SCHEDULE")).toBe(true);
  });

  it("leaves a disabled connection alone even if its interval is set", async () => {
    const { householdId, actor, connection } = await connected();
    const scheduled = await setSyncInterval(actor, householdId, connection.id, connection.version, 60);
    await setIntegrationEnabled(actor, householdId, connection.id, scheduled.version, false);

    expect(await scanForSyncs(NOW, { providerFactory: onePage })).toMatchObject({ scheduled: 0 });
  });

  // A household with a broken Nextcloud must still sync its Paperless.
  it("steps over a connection it cannot start", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    // A provider with no adapter: the scan must log it and carry on rather
    // than throwing out of the pass.
    const [other] = await db
      .insert(integrationConnections)
      .values({
        householdId,
        provider: "CALDAV",
        displayName: "Calendar",
        baseUrl: "https://dav.internal",
        syncIntervalMinutes: 60,
      })
      .returning();

    const result = await scanForSyncs(NOW, { providerFactory: onePage });

    expect(result.scheduled).toBe(1);
    expect(await latestRun(other.id)).toBeUndefined();
  });
});

describe("retrying a failed run", () => {
  it("waits out the backoff, then picks up the same run rather than starting a new one", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    await scanForSyncs(NOW, { providerFactory: alwaysFails });
    const failed = await latestRun(connection.id);
    expect(failed).toMatchObject({ status: "FAILED", attempt: 1 });

    // Four minutes on: still inside the five-minute backoff, and the
    // hourly schedule is not due either.
    expect(await scanForSyncs(minutesLater(4), { providerFactory: onePage })).toMatchObject({ retried: 0, scheduled: 0 });

    const after = await scanForSyncs(minutesLater(6), { providerFactory: onePage });
    expect(after.retried).toBe(1);

    const retried = await latestRun(connection.id);
    // The same row: "this has failed and been retried" is one history, not
    // two unrelated rows somebody has to correlate.
    expect(retried.id).toBe(failed.id);
    expect(retried).toMatchObject({ status: "SUCCEEDED", attempt: 2 });
  });

  it("backs off further after each failure", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    await scanForSyncs(NOW, { providerFactory: alwaysFails });

    let at = NOW;
    for (let attempt = 1; attempt < 3; attempt++) {
      at = later(at.getTime() - NOW.getTime() + retryBackoffMs(attempt) + 1_000);
      const result = await scanForSyncs(at, { providerFactory: alwaysFails });
      expect(result.retried, `attempt ${attempt + 1}`).toBe(1);
    }

    expect(await latestRun(connection.id)).toMatchObject({ status: "FAILED", attempt: 3 });
  });

  it("gives up after the attempts are spent, leaving the failure visible", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    // Start failed, then drive it to the attempt ceiling directly: the
    // backoff arithmetic is covered by the unit tests, and this one is
    // about what happens at the end.
    await scanForSyncs(NOW, { providerFactory: alwaysFails });
    await db
      .update(syncRuns)
      .set({ attempt: MAX_SYNC_ATTEMPTS })
      .where(eq(syncRuns.connectionId, connection.id));

    // A day later. Never retried again — a misconfigured connection must
    // not become a permanent source of requests to somebody else's server.
    const result = await scanForSyncs(minutesLater(60 * 24), { providerFactory: alwaysFails });
    expect(result.retried).toBe(0);

    // But the schedule still runs it, because that is a fresh attempt at
    // the household's own request, not an endless retry of a dead one.
    expect(result.scheduled).toBe(1);
    expect(await latestRun(connection.id)).toMatchObject({ attempt: 1 });
  });

  it("does not retry a partial run", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    // First page imports, second throws: PARTIAL.
    const partial = stub([
      { documents: [doc("1")], nextCursor: "page-2" },
      new ProviderError("network", "unreachable"),
    ]);
    await scanForSyncs(NOW, { providerFactory: partial });
    expect(await latestRun(connection.id)).toMatchObject({ status: "PARTIAL" });

    // Its remainder is the next scheduled run's job, from the cursor it
    // reached — not a retry of the row.
    expect(await scanForSyncs(minutesLater(10), { providerFactory: onePage })).toMatchObject({ retried: 0 });
  });
});

describe("a run whose process died", () => {
  it("is given up on, and the connection is not wedged forever", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    // Exactly the row a killed container leaves behind.
    const [abandoned] = await db
      .insert(syncRuns)
      .values({ householdId, connectionId: connection.id, status: "RUNNING", startedAt: NOW })
      .returning();

    // Still inside the window: left alone, and the connection is busy.
    expect(await scanForSyncs(later(STALE_RUN_MS - 1_000), { providerFactory: onePage })).toMatchObject({
      reaped: 0,
      scheduled: 0,
    });

    const reapedPass = await scanForSyncs(later(STALE_RUN_MS + 1_000), { providerFactory: onePage });
    expect(reapedPass.reaped).toBe(1);

    const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, abandoned.id));
    expect(row).toMatchObject({ status: "FAILED", errorKind: "abandoned" });

    // And the connection works again on the next pass.
    const next = await scanForSyncs(later(STALE_RUN_MS + retryBackoffMs(1) + 2_000), { providerFactory: onePage });
    expect(next.retried + next.scheduled).toBe(1);
  });

  it("reaps one that never left PENDING", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    await db.insert(syncRuns).values({ householdId, connectionId: connection.id, status: "PENDING" });

    expect(await scanForSyncs(NOW, { providerFactory: onePage })).toMatchObject({ reaped: 1 });
    expect(await latestRun(connection.id)).toMatchObject({ status: "FAILED" });
  });
});

describe("two syncs never race over one cursor", () => {
  it("refuses a manual sync while one is already live", async () => {
    const { householdId, actor, connection } = await connected();

    await db.insert(syncRuns).values({ householdId, connectionId: connection.id, status: "RUNNING", startedAt: NOW });

    // A friendly rejection, not a constraint-violation 500.
    await expect(runSync(actor, householdId, connection.id, { providerFactory: onePage })).rejects.toMatchObject({
      name: "IntegrationRuleError",
      code: "ALREADY_RUNNING",
    });
  });

  it("lets a manual sync through once the live run has finished", async () => {
    const { householdId, actor, connection } = await connected();

    const [live] = await db
      .insert(syncRuns)
      .values({ householdId, connectionId: connection.id, status: "RUNNING", startedAt: NOW })
      .returning();
    await db.update(syncRuns).set({ status: "SUCCEEDED", finishedAt: NOW }).where(eq(syncRuns.id, live.id));

    await expect(runSync(actor, householdId, connection.id, { providerFactory: onePage })).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
  });

  it("does not start a scheduled run on a connection somebody is already syncing", async () => {
    const { householdId, actor, connection } = await connected();
    await setSyncInterval(actor, householdId, connection.id, connection.version, 60);

    await db.insert(syncRuns).values({ householdId, connectionId: connection.id, status: "RUNNING", startedAt: NOW });

    expect(await scanForSyncs(NOW, { providerFactory: onePage })).toMatchObject({ scheduled: 0, retried: 0 });
  });
});
