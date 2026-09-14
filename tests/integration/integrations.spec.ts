import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
  documentReferences,
  integrationConnections,
  integrationCredentials,
  syncRuns,
} from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import {
  connectIntegration,
  openIntegrationCredential,
  replaceIntegrationCredential,
  rotateIntegrationCredentials,
  setIntegrationEnabled,
} from "../../application/commands/integrations/connectionCommands";
import { runSync } from "../../application/commands/integrations/runSync";
import { ProviderError, type DocumentProvider } from "../../application/integrations/documentProvider";
import { AuthorizationError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * Integrations end to end against a real database: the credential is
 * sealed, the sync is idempotent, a failure keeps the work already done,
 * and a local edit survives a re-sync.
 *
 * The provider is a stub. A test that reached a real Paperless would be
 * testing somebody's homelab, not this code — the adapter's own parsing is
 * covered in tests/unit/infrastructure/paperless.spec.ts.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

const NOW = new Date("2026-06-01T09:00:00Z");
const TOKEN = "paperless-secret-token-value";

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

async function connected() {
  const { householdId, actor } = await household();
  const connection = await connectIntegration(actor, householdId, {
    provider: "PAPERLESS",
    displayName: "Paperless",
    baseUrl: "https://paperless.internal",
    apiToken: TOKEN,
  });
  return { householdId, actor, connection };
}

interface StubPage {
  documents: { externalId: string; title: string; documentDate: string | null; url: string | null }[];
  nextCursor: string | null;
}

/** A provider that replays scripted pages, and can be told to fail. */
function stubProvider(pages: (StubPage | ProviderError)[]): { provider: DocumentProvider; calls: (string | null)[] } {
  const calls: (string | null)[] = [];
  let index = 0;

  return {
    calls,
    provider: {
      id: "PAPERLESS",
      async listDocuments(cursor) {
        calls.push(cursor);
        const next = pages[Math.min(index, pages.length - 1)];
        index += 1;
        if (next instanceof ProviderError) throw next;
        return next;
      },
    },
  };
}

const doc = (id: string, title = `Document ${id}`) => ({
  externalId: id,
  title,
  documentDate: "2026-01-04",
  url: `https://paperless.internal/documents/${id}/details`,
});

describe("configuring a connection", () => {
  it("stores the token sealed, and nowhere else", async () => {
    const { householdId, connection } = await connected();

    const [credential] = await db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.connectionId, connection.id));

    expect(credential.sealed).not.toContain(TOKEN);
    expect(credential.keyId).toBe("v1");
    // Not on the connection row either.
    expect(JSON.stringify(connection)).not.toContain(TOKEN);

    // And not in the audit trail, which is read by people who cannot open
    // the credential itself.
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.householdId, householdId));
    expect(JSON.stringify(audit)).not.toContain(TOKEN);
  });

  it("opens the credential again for the adapter", async () => {
    const { householdId, connection } = await connected();
    expect(await openIntegrationCredential(householdId, connection.id)).toBe(TOKEN);
  });

  // The AEAD binds household, connection and purpose into the tag.
  it("will not open a credential moved to another connection", async () => {
    const { householdId, actor, connection } = await connected();
    const other = await connectIntegration(actor, householdId, {
      provider: "NEXTCLOUD",
      displayName: "Nextcloud",
      baseUrl: "https://cloud.internal",
      apiToken: "another-token",
      // Required since the Nextcloud adapter landed: its WebDAV path is
      // per-account, so a connection without one cannot build a URL. The
      // provider is incidental to this test, which is about the AEAD
      // binding household, connection and purpose into the tag.
      username: "ada",
    });

    const [stolen] = await db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.connectionId, connection.id));

    await db
      .update(integrationCredentials)
      .set({ sealed: stolen.sealed })
      .where(eq(integrationCredentials.connectionId, other.id));

    await expect(openIntegrationCredential(householdId, other.id)).rejects.toThrow(/could not be opened/);
  });

  // This string becomes a fetch target on one side and an href on the
  // other.
  it("refuses a base URL that is not http or https", async () => {
    const { householdId, actor } = await household();

    for (const baseUrl of ["file:///etc/passwd", "javascript:alert(1)", "not a url", "ftp://host/x"]) {
      await expect(
        connectIntegration(actor, householdId, {
          provider: "PAPERLESS",
          displayName: "Bad",
          baseUrl,
          apiToken: TOKEN,
        }),
        baseUrl
      ).rejects.toThrow();
    }
  });

  // Replacing a token is what a household does when it thinks one has
  // leaked; it should not require re-entering a name and a URL as well.
  it("replaces a token without touching anything else", async () => {
    const { householdId, actor, connection } = await connected();

    await replaceIntegrationCredential(actor, householdId, connection.id, "brand-new-token", NOW);

    expect(await openIntegrationCredential(householdId, connection.id)).toBe("brand-new-token");
    const [unchanged] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id));
    expect(unchanged).toMatchObject({ displayName: "Paperless", baseUrl: "https://paperless.internal" });
  });
});

describe("who may configure an integration", () => {
  // docs/permissions.md gives Integrations to Owner/Admin only — "none by
  // default" even for an adult. Configuring where the household's data
  // goes is not the same as using the household's data.
  it("refuses an adult and a viewer", async () => {
    const { householdId, actor } = await household();

    const adult: Actor = { ...actor, role: "ADULT" };
    const viewer: Actor = { ...actor, role: "VIEWER" };

    for (const who of [adult, viewer]) {
      await expect(
        connectIntegration(who, householdId, {
          provider: "PAPERLESS",
          displayName: "Paperless",
          baseUrl: "https://paperless.internal",
          apiToken: TOKEN,
        }),
        who.role
      ).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("refuses a child outright", async () => {
    const { householdId, actor } = await household();
    const person = await addHouseholdMember(actor, householdId, {
      displayName: "Lukas",
      role: "CHILD",
      account: { email: "kid@example.test", temporaryPassword: "another correct horse battery" },
    });
    const child: Actor = { userId: person.accountUserId!, householdId, role: "CHILD", personIds: [person.id] };

    await expect(runSync(child, householdId, "00000000-0000-7000-8000-000000000000")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("refuses someone from another household", async () => {
    const { householdId, actor, connection } = await connected();
    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    await expect(
      setIntegrationEnabled(outsider, householdId, connection.id, connection.version, false)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("running a sync", () => {
  it("imports a page and records what it did", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider } = stubProvider([{ documents: [doc("1"), doc("2")], nextCursor: null }]);

    const outcome = await runSync(actor, householdId, connection.id, {
      providerFactory: () => provider,
      now: NOW,
    });

    expect(outcome).toMatchObject({ status: "SUCCEEDED", itemsSeen: 2, itemsImported: 2 });

    const refs = await db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId));
    expect(refs.map((r) => r.externalId).sort()).toEqual(["1", "2"]);
    expect(refs[0].sensitivity).toBe("SENSITIVE");
  });

  it("follows the cursor across pages and stops at the end", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider, calls } = stubProvider([
      { documents: [doc("1")], nextCursor: "2" },
      { documents: [doc("2")], nextCursor: "3" },
      { documents: [doc("3")], nextCursor: null },
    ]);

    const outcome = await runSync(actor, householdId, connection.id, { providerFactory: () => provider, now: NOW });

    expect(calls).toEqual([null, "2", "3"]);
    expect(outcome.itemsImported).toBe(3);
  });

  // The unique index makes this a database property rather than something
  // the adapter has to get right.
  it("imports the same page twice without duplicating anything", async () => {
    const { householdId, actor, connection } = await connected();
    const page = { documents: [doc("1"), doc("2")], nextCursor: null };

    await runSync(actor, householdId, connection.id, { providerFactory: () => stubProvider([page]).provider, now: NOW });
    const second = await runSync(actor, householdId, connection.id, {
      providerFactory: () => stubProvider([page]).provider,
      now: NOW,
    });

    const refs = await db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId));
    expect(refs).toHaveLength(2);
    // Nothing changed, so nothing was written — and the run says so.
    expect(second).toMatchObject({ itemsImported: 0, itemsSkipped: 2 });
  });

  it("updates a title the provider changed", async () => {
    const { householdId, actor, connection } = await connected();

    await runSync(actor, householdId, connection.id, {
      providerFactory: () => stubProvider([{ documents: [doc("1", "Bescheid")], nextCursor: null }]).provider,
      now: NOW,
    });
    await runSync(actor, householdId, connection.id, {
      providerFactory: () => stubProvider([{ documents: [doc("1", "Bescheid (korrigiert)")], nextCursor: null }]).provider,
      now: NOW,
    });

    const [ref] = await db.select().from(documentReferences).where(eq(documentReferences.externalId, "1"));
    expect(ref.title).toBe("Bescheid (korrigiert)");
  });

  // "A sync run must never silently overwrite local edits."
  it("never touches the household's own title or note", async () => {
    const { householdId, actor, connection } = await connected();

    await runSync(actor, householdId, connection.id, {
      providerFactory: () => stubProvider([{ documents: [doc("1", "Bescheid")], nextCursor: null }]).provider,
      now: NOW,
    });

    await db
      .update(documentReferences)
      .set({ titleOverride: "Lukas — Pflegegrad", note: "Appeal deadline is in March" })
      .where(eq(documentReferences.externalId, "1"));

    await runSync(actor, householdId, connection.id, {
      providerFactory: () => stubProvider([{ documents: [doc("1", "Something else entirely")], nextCursor: null }]).provider,
      now: NOW,
    });

    const [ref] = await db.select().from(documentReferences).where(eq(documentReferences.externalId, "1"));
    expect(ref.titleOverride).toBe("Lukas — Pflegegrad");
    expect(ref.note).toBe("Appeal deadline is in March");
    // The provider's own field did move.
    expect(ref.title).toBe("Something else entirely");
  });

  it("skips a document whose link would not be safe to render", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider } = stubProvider([
      {
        documents: [{ ...doc("1"), url: "javascript:alert(1)" }, doc("2")],
        nextCursor: null,
      },
    ]);

    const outcome = await runSync(actor, householdId, connection.id, { providerFactory: () => provider, now: NOW });

    expect(outcome).toMatchObject({ itemsImported: 1, itemsSkipped: 1 });
    const refs = await db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId));
    expect(refs.map((r) => r.externalId)).toEqual(["2"]);
  });
});

describe("when a sync goes wrong", () => {
  // Eleven imported documents are real work. Re-importing them on the
  // next attempt would be wasteful and make the counts meaningless.
  it("keeps the work already done and records it as partial", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider } = stubProvider([
      { documents: [doc("1"), doc("2")], nextCursor: "2" },
      new ProviderError("rate_limit", "The provider asked us to slow down (429)."),
    ]);

    const outcome = await runSync(actor, householdId, connection.id, { providerFactory: () => provider, now: NOW });

    expect(outcome).toMatchObject({ status: "PARTIAL", itemsImported: 2 });

    const refs = await db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId));
    expect(refs).toHaveLength(2);

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.connectionId, connection.id));
    expect(run).toMatchObject({ status: "PARTIAL", errorKind: "rate_limit" });
  });

  it("records a run that achieved nothing as failed", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider } = stubProvider([new ProviderError("auth", "The provider rejected the credential (401).")]);

    const outcome = await runSync(actor, householdId, connection.id, { providerFactory: () => provider, now: NOW });

    expect(outcome.status).toBe("FAILED");
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.connectionId, connection.id));
    expect(run).toMatchObject({ status: "FAILED", errorKind: "auth", itemsImported: 0 });
  });

  // A failed run's cursor cannot be trusted, so the next one starts where
  // the last good one left off.
  it("does not advance the connection's cursor past a page it never read", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider } = stubProvider([
      { documents: [doc("1")], nextCursor: "2" },
      new ProviderError("network", "Could not reach the provider."),
    ]);

    await runSync(actor, householdId, connection.id, { providerFactory: () => provider, now: NOW });

    // The first page succeeded, so the cursor is at 2 — not at 3.
    const [after] = await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, connection.id), eq(syncRuns.status, "PARTIAL")));
    expect(after.cursorAfter).toBe("2");
  });

  it("refuses to sync a disabled integration", async () => {
    const { householdId, actor, connection } = await connected();
    await setIntegrationEnabled(actor, householdId, connection.id, connection.version, false, NOW);

    await expect(
      runSync(actor, householdId, connection.id, { providerFactory: () => stubProvider([]).provider, now: NOW })
    ).rejects.toMatchObject({ code: "DISABLED" });
  });

  it("says so when a provider has no adapter yet", async () => {
    const { householdId, actor } = await household();
    const connection = await connectIntegration(actor, householdId, {
      provider: "CALDAV",
      displayName: "Calendar",
      baseUrl: "https://dav.internal",
      apiToken: TOKEN,
    });

    await expect(runSync(actor, householdId, connection.id, { now: NOW })).rejects.toMatchObject({
      code: "NO_ADAPTER",
    });
  });

  // The stored message is shown and logged; a provider's own text can
  // contain the URL it was called with, and a URL can contain a
  // credential.
  it("never stores the credential in a sync run", async () => {
    const { householdId, actor, connection } = await connected();
    const { provider } = stubProvider([new ProviderError("network", `failed calling https://x?token=${TOKEN}`)]);

    await runSync(actor, householdId, connection.id, { providerFactory: () => provider, now: NOW });

    const runs = await db.select().from(syncRuns).where(eq(syncRuns.connectionId, connection.id));
    expect(JSON.stringify(runs)).not.toContain(TOKEN);
  });
});

describe("rotating credentials", () => {
  it("reports nothing to do when everything is on the active key", async () => {
    const { householdId, actor } = await connected();
    expect(await rotateIntegrationCredentials(actor, householdId, NOW)).toEqual({ examined: 1, resealed: 0 });
  });

  it("refuses an adult", async () => {
    const { householdId, actor } = await connected();
    await expect(
      rotateIntegrationCredentials({ ...actor, role: "ADULT" }, householdId, NOW)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
