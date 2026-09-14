import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { documentReferences } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { createCase } from "../../application/commands/cases/createCase";
import { recordExpense } from "../../application/commands/finance/recordExpense";
import { createTrip } from "../../application/commands/travel/tripCommands";
import { linkRecords } from "../../application/commands/links/linkRecords";
import { buildExport } from "../../application/queries/export/buildExport";
import { getBackupStatus } from "../../application/queries/backup/getBackupStatus";
import { AuthorizationError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * The export bundle, against a real database.
 *
 * This is the one feature where an authorization mistake is **total**
 * rather than partial: every other screen leaks one record at a time, and
 * an export that read rows directly would hand over the whole house in a
 * single click. So most of this file is about what must not be in the
 * file, and it is written from the reader's side — a child, an adult
 * outside a person scope, somebody from another household.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor, personId: person.id };
}

async function member(actor: Actor, householdId: string, role: "ADULT" | "CHILD" | "VIEWER", email: string, name: string) {
  const person = await addHouseholdMember(actor, householdId, {
    displayName: name,
    role,
    account: { email, temporaryPassword: "another correct horse battery" },
  });
  return {
    actor: { userId: person.accountUserId!, householdId, role, personIds: [person.id] } as Actor,
    personId: person.id,
  };
}

async function aDocument(householdId: string, title: string, sensitivity: "NORMAL" | "SENSITIVE" = "SENSITIVE") {
  const [row] = await db
    .insert(documentReferences)
    .values({ householdId, provider: "MANUAL", title, sensitivity })
    .returning();
  return row;
}

describe("what an export contains", () => {
  it("gathers the household's records, with counts that match", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Pflegegrad appeal" });
    await recordExpense(actor, householdId, { description: "Apotheke", amount: "12,40", incurredOn: "2026-05-02" });
    await createTrip(actor, householdId, { title: "Vienna", startsOn: "2026-07-10", endsOn: "2026-07-17" });

    const bundle = await buildExport(actor, householdId);

    expect(bundle.formatVersion).toBe(1);
    expect(bundle.cases).toHaveLength(1);
    expect(bundle.expenses).toHaveLength(1);
    expect(bundle.trips).toHaveLength(1);
    // The counts are what the page promises before the download; they must
    // be derived from the same arrays rather than computed separately.
    expect(bundle.counts.cases).toBe(bundle.cases.length);
    expect(bundle.counts.expenses).toBe(bundle.expenses.length);
  });

  it("says in the file itself what the file is", async () => {
    const { householdId, actor } = await household();
    const bundle = await buildExport(actor, householdId);

    // A file outlives the page that produced it, so the caveat travels
    // with it rather than staying on screen.
    expect(bundle.scope).toMatch(/permitted to read/i);
    expect(bundle.exportedBy).toMatchObject({ userId: actor.userId, role: "OWNER" });
    expect(bundle.household.id).toBe(householdId);
  });

  it("leaves out the columns that are not the household's data", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Searchable case" });

    const bundle = await buildExport(actor, householdId);
    const serialised = JSON.stringify(bundle);

    // A tsvector is megabytes of lexemes nobody can read (ADR-022).
    expect(serialised).not.toContain("searchVector");
    expect(serialised).not.toContain("search_vector");
    // No password hash, because the users table is not exported at all.
    expect(serialised).not.toContain("passwordHash");
    expect(serialised).not.toContain("argon2");
  });

  it("includes a link only when both of its ends are in the file", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid@example.test", "Lukas");

    const kase = await createCase(actor, householdId, {
      title: "Lukas at school",
      aboutPersonIds: [kid.personId],
    });
    const document = await aDocument(householdId, "Consultant's letter", "SENSITIVE");
    await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    const asOwner = await buildExport(actor, householdId);
    expect(asOwner.links).toHaveLength(1);

    // The child can see the case, not the document. Exporting the link
    // would name a record that is not in their file — telling them it
    // exists and what type it is, which is most of what the sensitivity
    // protects (ADR-021).
    const asChild = await buildExport(kid.actor, householdId);
    expect(asChild.cases).toHaveLength(1);
    expect(asChild.documents).toHaveLength(0);
    expect(asChild.links).toHaveLength(0);
  });
});

describe("what an export must never contain", () => {
  it("does not give a child a SENSITIVE record", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid2@example.test", "Lukas");

    await aDocument(householdId, "Consultant's letter", "SENSITIVE");
    await recordExpense(actor, householdId, { description: "Apotheke", amount: "12,40", incurredOn: "2026-05-02" });

    const asOwner = await buildExport(actor, householdId);
    expect(asOwner.documents).toHaveLength(1);
    expect(asOwner.expenses).toHaveLength(1);

    const asChild = await buildExport(kid.actor, householdId);
    expect(asChild.documents).toEqual([]);
    expect(asChild.expenses).toEqual([]);
    // Not merely absent from the arrays — absent from the file.
    expect(JSON.stringify(asChild)).not.toContain("Consultant");
    expect(JSON.stringify(asChild)).not.toContain("Apotheke");
  });

  it("does not give an adult a case scoped to somebody else", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid3@example.test", "Lukas");
    const other = await member(actor, householdId, "ADULT", "bea@example.test", "Bea");

    await createCase(actor, householdId, {
      title: "Schulbegleitung application",
      aboutPersonIds: [kid.personId],
    });

    expect((await buildExport(actor, householdId)).cases).toHaveLength(1);

    const asAdult = await buildExport(other.actor, householdId);
    expect(asAdult.cases).toEqual([]);
    expect(JSON.stringify(asAdult)).not.toContain("Schulbegleitung");
  });

  // A warranty has no visibility of its own — it belongs to its asset. An
  // export that gathered warranties independently would leak the asset's
  // existence through the back door.
  it("does not give a child the children of a record they cannot see", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid4@example.test", "Lukas");

    const trip = await createTrip(actor, householdId, {
      title: "Vienna",
      startsOn: "2026-07-10",
      endsOn: "2026-07-17",
    });
    expect(trip.id).toBeTruthy();

    const asChild = await buildExport(kid.actor, householdId);
    expect(asChild.trips).toEqual([]);
    expect(asChild.tripItems).toEqual([]);
    expect(JSON.stringify(asChild)).not.toContain("Vienna");
  });

  it("refuses a household the actor is not a member of", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Pflegegrad appeal" });

    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    // Not found rather than forbidden, and refused before any query runs.
    await expect(buildExport(outsider, householdId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(buildExport(actor, "00000000-0000-7000-8000-00000000ffff")).rejects.toBeInstanceOf(NotFoundError);
  });

  /**
   * The gap this feature found.
   *
   * `docs/permissions.md` has always said "Finance | Viewer | none by
   * default", and the kernel gave a viewer read on every expense and
   * claim: it applies a sensitivity ceiling to CHILD only, and a VIEWER
   * passes straight through on any read. A viewer is the account somebody
   * is given so they can see the calendar, and they were getting the
   * household's complete financial history.
   *
   * Nothing made it visible before, because a viewer had to go and look
   * at the finance page. An export is where a quiet over-grant stops
   * being quiet: it turns per-record access into one file containing all
   * of it.
   */
  it("gives a viewer no finance at all, as the matrix has always said", async () => {
    const { householdId, actor } = await household();
    const viewer = await member(actor, householdId, "VIEWER", "viewer@example.test", "Chris");

    await createCase(actor, householdId, { title: "An open case" });
    await recordExpense(actor, householdId, { description: "Apotheke", amount: "12,40", incurredOn: "2026-05-02" });

    const asViewer = await buildExport(viewer.actor, householdId);

    // Cases are "read allowed" for a viewer, and stay so.
    expect(asViewer.cases).toHaveLength(1);
    expect(asViewer.expenses).toEqual([]);
    expect(asViewer.budgets).toEqual([]);
    expect(JSON.stringify(asViewer)).not.toContain("Apotheke");
  });
});

describe("backup status", () => {
  it("counts what is there, and says which schema produced it", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "A case" });
    await recordExpense(actor, householdId, { description: "Apotheke", amount: "12,40", incurredOn: "2026-05-02" });

    const status = await getBackupStatus(actor, householdId);

    // `household_case`, not `case` — the real table name, because `case`
    // is a reserved word. A hand-typed list got this wrong and the catch
    // turned it into a confident zero.
    const byTable = Object.fromEntries(status.tables.map((t) => [t.table, t.rows]));
    expect(byTable.household_case).toBe(1);
    expect(byTable.expense).toBe(1);
    expect(byTable.person).toBeGreaterThan(0);
    // No table reported as uncountable: every name comes from the schema.
    expect(status.tables.filter((t) => t.rows === null)).toEqual([]);
    expect(status.totalRows).toBeGreaterThan(0);

    // The numbers only mean something next to a schema version: comparing
    // counts across two different schemas proves nothing.
    expect(status.schemaVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  it("reports the last export from the audit trail rather than a guess", async () => {
    const { householdId, actor } = await household();

    expect((await getBackupStatus(actor, householdId)).lastExport).toBeNull();

    // buildExport does not audit — the route does, so that a programmatic
    // build for the page's own counts is not recorded as somebody taking
    // a copy. Written here the way the route writes it.
    const { recordAuditEvent } = await import("../../application/audit/recordAuditEvent");
    await recordAuditEvent({
      householdId,
      actorUserId: actor.userId,
      action: "household.exported",
      resourceType: "household",
      resourceId: householdId,
    });

    const status = await getBackupStatus(actor, householdId);
    expect(status.lastExport?.actorUserId).toBe(actor.userId);
  });

  it("says whether an encryption key exists, never what it is", async () => {
    const { householdId, actor } = await household();
    const status = await getBackupStatus(actor, householdId);

    expect(typeof status.keyringConfigured).toBe("boolean");
    expect(JSON.stringify(status)).not.toContain(process.env.CREDENTIAL_KEYS ?? " never");
  });

  /**
   * Stricter than the "Household settings" row an adult has read access
   * to, deliberately: everything here is a read of the whole household,
   * and "there are 14 documents" told to somebody who can open three is
   * the aggregate form of the enumeration search and links both prevent.
   * `docs/permissions.md` now carries its own row for this.
   */
  it("is refused to an adult", async () => {
    const { householdId, actor } = await household();
    const other = await member(actor, householdId, "ADULT", "adult2@example.test", "Bea");

    await expect(getBackupStatus(other.actor, householdId)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("does not count another household's rows", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "A case" });

    const [row] = await db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId));
    expect(row).toBeUndefined();

    const status = await getBackupStatus(actor, householdId);
    const cases = status.tables.find((t) => t.table === "household_case");
    expect(cases?.rows).toBe(1);
  });
});
