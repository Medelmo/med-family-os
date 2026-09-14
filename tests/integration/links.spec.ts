import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { documentReferences, recordLinks } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { createCase } from "../../application/commands/cases/createCase";
import { recordExpense } from "../../application/commands/finance/recordExpense";
import { createTrip } from "../../application/commands/travel/tripCommands";
import { getLinksFor, linkRecords, unlinkRecords, LinkRuleError } from "../../application/commands/links/linkRecords";
import { AuthorizationError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * Context links (docs/domain/erd.md, "CASE contextualizes
 * DOCUMENT_REFERENCE"), against a real database.
 *
 * The counts and the round trips matter, but the tests that matter most
 * are the ones about what a link must not reveal: a link is visible only
 * if the actor may read the record at the *other* end, or it becomes a
 * side door around every sensitivity rule in the app.
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

async function child(actor: Actor, householdId: string, email: string) {
  const person = await addHouseholdMember(actor, householdId, {
    displayName: "Lukas",
    role: "CHILD",
    account: { email, temporaryPassword: "another correct horse battery" },
  });
  return {
    actor: { userId: person.accountUserId!, householdId, role: "CHILD", personIds: [person.id] } as Actor,
    personId: person.id,
  };
}

/** A document reference, which has no command yet — Phase 7 imports them. */
async function aDocument(householdId: string, title: string, sensitivity: "NORMAL" | "SENSITIVE" = "SENSITIVE") {
  const [row] = await db
    .insert(documentReferences)
    .values({ householdId, provider: "MANUAL", title, sensitivity })
    .returning();
  return row;
}

describe("linking two records", () => {
  it("links a case to a document and finds it from either end", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Pflegegrad appeal" });
    const document = await aDocument(householdId, "Bescheid 2026");

    await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    const fromCase = await getLinksFor(actor, householdId, { type: "case", id: kase.id });
    expect(fromCase).toHaveLength(1);
    expect(fromCase[0]).toMatchObject({ type: "document", id: document.id, label: "Bescheid 2026" });

    const fromDocument = await getLinksFor(actor, householdId, { type: "document", id: document.id });
    expect(fromDocument[0]).toMatchObject({ type: "case", id: kase.id, label: "Pflegegrad appeal" });
  });

  // The statement "these two are related" is symmetric, so linking A to B
  // and B to A must be the same row.
  it("stores one row however the pair is given", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");

    await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });
    await linkRecords(actor, householdId, {
      from: { type: "document", id: document.id },
      to: { type: "case", id: kase.id },
    });

    expect(await db.select().from(recordLinks).where(eq(recordLinks.householdId, householdId))).toHaveLength(1);
  });

  // Two people reaching the same conclusion about two records is not a
  // conflict worth interrupting either of them for.
  it("treats linking the same pair twice as a no-op, not an error", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");
    const pair = { from: { type: "case" as const, id: kase.id }, to: { type: "document" as const, id: document.id } };

    expect(await linkRecords(actor, householdId, pair)).not.toBeNull();
    expect(await linkRecords(actor, householdId, pair)).toBeNull();
  });

  it("refuses to link a record to itself", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });

    await expect(
      linkRecords(actor, householdId, {
        from: { type: "case", id: kase.id },
        to: { type: "case", id: kase.id },
      })
    ).rejects.toBeInstanceOf(LinkRuleError);
  });

  // The pair whose alphabetical and declared orders differ — the database
  // enforces canonical order with a CHECK, so this would be rejected if
  // the two definitions disagreed.
  it("links a task-shaped pair the database also accepts", async () => {
    const { householdId, actor } = await household();
    const expense = await recordExpense(actor, householdId, {
      description: "Taxi to the clinic",
      amount: "24,00",
      incurredOn: "2026-06-01",
    });
    const trip = await createTrip(actor, householdId, {
      title: "Vienna",
      startsOn: "2026-07-10",
      endsOn: "2026-07-17",
    });

    await expect(
      linkRecords(actor, householdId, {
        from: { type: "trip", id: trip.id },
        to: { type: "expense", id: expense.id },
      })
    ).resolves.not.toBeNull();
  });

  it("carries the household's own note about why they are related", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");

    await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
      note: "The refusal we are appealing",
    });

    const [link] = await getLinksFor(actor, householdId, { type: "case", id: kase.id });
    expect(link.note).toBe("The refusal we are appealing");
  });
});

describe("what a link must never reveal", () => {
  // The heart of it. A NORMAL case linked to a SENSITIVE document would
  // otherwise tell a child account that the document exists and what it
  // is called — most of what the sensitivity was protecting.
  it("hides a link whose far end the actor may not read", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid@example.test");

    const kase = await createCase(actor, householdId, {
      title: "Lukas at school",
      aboutPersonIds: [kid.personId],
    });
    const document = await aDocument(householdId, "Consultant's letter", "SENSITIVE");

    await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    // The owner sees the link.
    expect(await getLinksFor(actor, householdId, { type: "case", id: kase.id })).toHaveLength(1);

    // The child can see the case — it is about them — and learns nothing
    // at all about the document.
    const asChild = await getLinksFor(kid.actor, householdId, { type: "case", id: kase.id });
    expect(asChild).toEqual([]);
    expect(JSON.stringify(asChild)).not.toContain("Consultant");
  });

  it("refuses to create a link to something the actor cannot read", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid2@example.test");

    const kase = await createCase(actor, householdId, { title: "Lukas at school", aboutPersonIds: [kid.personId] });
    const document = await aDocument(householdId, "Consultant's letter", "SENSITIVE");

    // Reported as not found, not as forbidden: for the far end of a link,
    // a refusal that distinguishes the two is a way to test whether
    // something exists.
    await expect(
      linkRecords(kid.actor, householdId, {
        from: { type: "case", id: kase.id },
        to: { type: "document", id: document.id },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to remove a link whose far end the actor cannot read", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid3@example.test");

    const kase = await createCase(actor, householdId, { title: "Lukas at school", aboutPersonIds: [kid.personId] });
    const document = await aDocument(householdId, "Consultant's letter", "SENSITIVE");

    const link = await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    await expect(unlinkRecords(kid.actor, householdId, link!.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a record from another household", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");

    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    await expect(
      linkRecords(outsider, householdId, {
        from: { type: "case", id: kase.id },
        to: { type: "document", id: document.id },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a record that does not exist", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });

    await expect(
      linkRecords(actor, householdId, {
        from: { type: "case", id: kase.id },
        to: { type: "document", id: "00000000-0000-7000-8000-000000000000" },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("when a linked record goes away", () => {
  // The link table has no foreign key — a generic id cannot reference
  // seven tables — so a dangling row is possible and must not render as a
  // broken entry.
  it("drops a link to a deleted record instead of showing a gap", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");

    await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    await db.delete(documentReferences).where(eq(documentReferences.id, document.id));

    expect(await getLinksFor(actor, householdId, { type: "case", id: kase.id })).toEqual([]);
  });
});

describe("removing a link", () => {
  it("removes it from both ends", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");

    const link = await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    await unlinkRecords(actor, householdId, link!.id);

    expect(await getLinksFor(actor, householdId, { type: "case", id: kase.id })).toEqual([]);
    expect(await getLinksFor(actor, householdId, { type: "document", id: document.id })).toEqual([]);
  });

  it("reports a link that is not there", async () => {
    const { householdId, actor } = await household();
    await expect(
      unlinkRecords(actor, householdId, "00000000-0000-7000-8000-000000000000")
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not remove a link belonging to another household", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const document = await aDocument(householdId, "A document");
    const link = await linkRecords(actor, householdId, {
      from: { type: "case", id: kase.id },
      to: { type: "document", id: document.id },
    });

    await expect(
      unlinkRecords(actor, "00000000-0000-7000-8000-00000000ffff", link!.id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("a record can be the hub of several links", () => {
  it("gathers everything a case is related to", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Pflegegrad appeal" });
    const document = await aDocument(householdId, "Bescheid 2026");
    const expense = await recordExpense(actor, householdId, {
      description: "Solicitor's fee",
      amount: "150,00",
      incurredOn: "2026-06-01",
    });

    for (const to of [
      { type: "document" as const, id: document.id },
      { type: "expense" as const, id: expense.id },
    ]) {
      await linkRecords(actor, householdId, { from: { type: "case", id: kase.id }, to });
    }

    const links = await getLinksFor(actor, householdId, { type: "case", id: kase.id });
    expect(links.map((l) => l.type).sort()).toEqual(["document", "expense"]);
    expect(links.every((l) => l.href !== null)).toBe(true);
  });
});
