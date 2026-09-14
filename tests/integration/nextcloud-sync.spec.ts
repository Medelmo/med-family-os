import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../infrastructure/db/client";
import { documentReferences, integrationConnections, syncRuns } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import {
  connectIntegration,
  IntegrationRuleError,
} from "../../application/commands/integrations/connectionCommands";
import { runSync } from "../../application/commands/integrations/runSync";
import type { Actor } from "../../application/policies/authorize";

/**
 * A Nextcloud connection, from the connect form to a document reference,
 * against a real database and the *real* adapter — only `fetch` is
 * stubbed.
 *
 * That distinction matters: the unit tests cover the adapter in isolation
 * and the existing integrations spec covers the sync driver with a stub
 * provider. Neither exercises the piece that is new here — a connection
 * whose provider decides which adapter runs, with a username and a folder
 * that only Nextcloud has.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

const APP_PASSWORD = "nextcloud-app-password-value";

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

async function connectNextcloud(overrides: Partial<Parameters<typeof connectIntegration>[2]> = {}) {
  const { householdId, actor } = await household();
  const connection = await connectIntegration(actor, householdId, {
    provider: "NEXTCLOUD",
    displayName: "Cloud",
    baseUrl: "https://cloud.internal",
    apiToken: APP_PASSWORD,
    username: "ada",
    remotePath: "Documents/Household",
    ...overrides,
  });
  return { householdId, actor, connection };
}

const multistatus = (...entries: string[]) => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
${entries.join("\n")}
</d:multistatus>`;

const file = (fileId: string, name: string, modified = "Mon, 14 Sep 2026 12:00:00 GMT") => `
  <d:response>
    <d:href>/remote.php/dav/files/ada/Documents/Household/${encodeURIComponent(name)}</d:href>
    <d:propstat>
      <d:prop>
        <oc:fileid>${fileId}</oc:fileid>
        <d:displayname>${name}</d:displayname>
        <d:getlastmodified>${modified}</d:getlastmodified>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

const theFolder = `
  <d:response>
    <d:href>/remote.php/dav/files/ada/Documents/Household/</d:href>
    <d:propstat>
      <d:prop><oc:fileid>1</oc:fileid><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

function stubFetch(body: string, init: ResponseInit = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(body, { status: 200, ...init });
  });
  return { calls, fetchImpl: impl as unknown as typeof fetch };
}

const referencesOf = (householdId: string) =>
  db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId));

describe("syncing a Nextcloud folder", () => {
  it("imports the folder's files as document references", async () => {
    const { householdId, actor, connection } = await connectNextcloud();
    const { calls, fetchImpl } = stubFetch(multistatus(theFolder, file("10", "Bescheid.pdf"), file("11", "Police.pdf")));

    const outcome = await runSync(actor, householdId, connection.id, { fetchImpl });

    expect(outcome).toMatchObject({ status: "SUCCEEDED", itemsImported: 2 });
    // The right adapter ran: a WebDAV URL for this account and folder, not
    // Paperless's /api/documents/.
    expect(calls[0]).toBe("https://cloud.internal/remote.php/dav/files/ada/Documents/Household/");

    const rows = await referencesOf(householdId);
    expect(rows.map((r) => r.title).sort()).toEqual(["Bescheid.pdf", "Police.pdf"]);
    expect(rows.every((r) => r.provider === "NEXTCLOUD")).toBe(true);
    expect(rows.every((r) => r.url?.startsWith("https://cloud.internal/index.php/f/"))).toBe(true);
  });

  it("is idempotent: running it again changes nothing", async () => {
    const { householdId, actor, connection } = await connectNextcloud();
    const body = multistatus(theFolder, file("10", "Bescheid.pdf"));

    const first = await runSync(actor, householdId, connection.id, { fetchImpl: stubFetch(body).fetchImpl });
    const second = await runSync(actor, householdId, connection.id, { fetchImpl: stubFetch(body).fetchImpl });

    expect(first.itemsImported).toBe(1);
    expect(second).toMatchObject({ itemsImported: 0, itemsSkipped: 1 });
    expect(await referencesOf(householdId)).toHaveLength(1);
  });

  /**
   * The property the whole design rests on: the identity is the file id,
   * so a rename is an update. A path-keyed sync would have created a
   * second reference and orphaned the first, which the household would
   * experience as their note silently detaching from the document.
   */
  it("follows a rename instead of creating a second reference", async () => {
    const { householdId, actor, connection } = await connectNextcloud();

    await runSync(actor, householdId, connection.id, {
      fetchImpl: stubFetch(multistatus(theFolder, file("10", "Bescheid.pdf"))).fetchImpl,
    });

    // The household's own note, which a sync must never touch.
    await db
      .update(documentReferences)
      .set({ note: "The one we are appealing", titleOverride: "The refusal" })
      .where(eq(documentReferences.householdId, householdId));

    await runSync(actor, householdId, connection.id, {
      fetchImpl: stubFetch(multistatus(theFolder, file("10", "Bescheid 2026.pdf"))).fetchImpl,
    });

    const rows = await referencesOf(householdId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Bescheid 2026.pdf");
    // Untouched, because they are different columns from the ones a sync
    // writes (domain/documents/documentReference.ts).
    expect(rows[0].note).toBe("The one we are appealing");
    expect(rows[0].titleOverride).toBe("The refusal");
  });

  it("does not mirror the tree: subfolders are left alone", async () => {
    const { householdId, actor, connection } = await connectNextcloud();
    const subfolder = `
      <d:response>
        <d:href>/remote.php/dav/files/ada/Documents/Household/Old/</d:href>
        <d:propstat>
          <d:prop><oc:fileid>2</oc:fileid><d:resourcetype><d:collection/></d:resourcetype></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`;
    const { calls, fetchImpl } = stubFetch(multistatus(theFolder, subfolder, file("12", "a.pdf")));

    await runSync(actor, householdId, connection.id, { fetchImpl });

    expect((await referencesOf(householdId)).map((r) => r.externalId)).toEqual(["12"]);
    // One request. Nothing walked into the subfolder.
    expect(calls).toHaveLength(1);
  });

  it("records a failure in the app's own words, never the provider's", async () => {
    const { householdId, actor, connection } = await connectNextcloud();
    const fetchImpl = (async () => {
      throw new Error(`connect ECONNREFUSED https://ada:${APP_PASSWORD}@cloud.internal/remote.php/dav`);
    }) as unknown as typeof fetch;

    const outcome = await runSync(actor, householdId, connection.id, { fetchImpl });

    expect(outcome.status).toBe("FAILED");

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, outcome.runId));
    expect(run.errorKind).toBe("network");
    expect(run.errorMessage).not.toContain(APP_PASSWORD);
    expect(JSON.stringify(run)).not.toContain(APP_PASSWORD);
  });
});

describe("configuring one", () => {
  it("stores the account and folder, and seals only the password", async () => {
    const { connection } = await connectNextcloud();

    expect(connection).toMatchObject({ username: "ada", remotePath: "Documents/Household" });
    // The app password is not on the connection row at all — it lives
    // sealed in its own table (ADR-019).
    expect(JSON.stringify(connection)).not.toContain(APP_PASSWORD);
  });

  it("refuses a Nextcloud connection with no account, at the point of configuring it", async () => {
    // Asserted on the field rather than just "it threw": without this the
    // test would pass if it failed for any reason at all, and the point is
    // that the household is told *what* is missing, when they can fix it,
    // rather than at every sync with a message about WebDAV.
    const error = await connectNextcloud({ username: "" }).catch((e) => e);
    expect(JSON.stringify(error)).toContain("username");
    expect(JSON.stringify(error)).toMatch(/app password belongs to/);
  });

  // Both become URL path segments, so a slash or a traversal in one would
  // reach a folder the household did not name.
  it.each([
    ["a slash in the account", { username: "ada/../bob" }],
    ["a traversal in the folder", { remotePath: "Documents/../../etc" }],
    ["a line break in the account", { username: "ada\nX-Evil: 1" }],
  ])("refuses %s", async (_label, overrides) => {
    await expect(connectNextcloud(overrides)).rejects.toThrow();
  });

  // And the database refuses them too, so no other write path can store
  // one — an import, a migration, a hand-run UPDATE.
  it("refuses them at the database as well as in the command", async () => {
    const { connection } = await connectNextcloud();

    await expect(
      db
        .update(integrationConnections)
        .set({ remotePath: "a/../../etc" })
        .where(eq(integrationConnections.id, connection.id))
    ).rejects.toThrow();

    await expect(
      db
        .update(integrationConnections)
        .set({ username: "ada/bob" })
        .where(eq(integrationConnections.id, connection.id))
    ).rejects.toThrow();
  });

  it("still refuses a provider with no adapter", async () => {
    const { householdId, actor } = await household();
    const connection = await connectIntegration(actor, householdId, {
      provider: "CALDAV",
      displayName: "Calendar",
      baseUrl: "https://dav.internal",
      apiToken: "token",
    });

    await expect(runSync(actor, householdId, connection.id)).rejects.toBeInstanceOf(IntegrationRuleError);
  });
});
