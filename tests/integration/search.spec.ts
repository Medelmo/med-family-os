import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { documentReferences } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { createCase } from "../../application/commands/cases/createCase";
import { archiveExpense, recordExpense } from "../../application/commands/finance/recordExpense";
import { createTrip } from "../../application/commands/travel/tripCommands";
import { search } from "../../application/queries/search/search";
import type { Actor } from "../../application/policies/authorize";

/**
 * Global search, against a real database — because almost everything worth
 * testing here is PostgreSQL's behaviour, not ours: what a generated
 * `tsvector` actually contains, what `websearch_to_tsquery` does with
 * input a person would really type, and whether the GIN index is being
 * used at all.
 *
 * The tests that matter most are at the bottom: search must never be a way
 * to discover a record the reader may not open.
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

async function member(actor: Actor, householdId: string, role: "ADULT" | "CHILD", email: string, name: string) {
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

const labels = (hits: { label: string }[]) => hits.map((h) => h.label);

describe("finding things", () => {
  it("finds a case by a word in its title", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Pflegegrad appeal" });
    await createCase(actor, householdId, { title: "Broadband contract" });

    const { hits } = await search(actor, householdId, "pflegegrad");

    expect(labels(hits)).toEqual(["Pflegegrad appeal"]);
    expect(hits[0]).toMatchObject({ type: "case", href: expect.stringContaining("/cases/") });
  });

  it("searches across every type in one list", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Vienna clinic referral" });
    await createTrip(actor, householdId, { title: "Vienna", startsOn: "2026-07-10", endsOn: "2026-07-17" });
    await recordExpense(actor, householdId, {
      description: "Train to Vienna",
      amount: "89,90",
      incurredOn: "2026-07-10",
    });

    const { hits } = await search(actor, householdId, "vienna");

    expect(hits.map((h) => h.type).sort()).toEqual(["case", "expense", "trip"]);
  });

  // The searchable text is more than the title: an expense's merchant and a
  // case's description are exactly what somebody half-remembers.
  it("searches the fields around the title too", async () => {
    const { householdId, actor } = await household();
    await recordExpense(actor, householdId, {
      description: "Prescription",
      merchant: "Apotheke am Markt",
      amount: "12,40",
      incurredOn: "2026-05-02",
    });

    expect(labels((await search(actor, householdId, "apotheke")).hits)).toEqual(["Prescription"]);
  });

  it("gives each hit a line that tells two similar records apart", async () => {
    const { householdId, actor } = await household();
    await recordExpense(actor, householdId, {
      description: "Apotheke",
      amount: "12,40",
      incurredOn: "2026-05-02",
    });

    const [hit] = (await search(actor, householdId, "apotheke")).hits;
    expect(hit.detail).toBe("2026-05-02");
  });

  it("ranks a title match above a match buried in a note", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Rollstuhl", description: "Wheelchair replacement" });
    await createCase(actor, householdId, { title: "Flat move", description: "Ask about the Rollstuhl ramp" });

    const { hits } = await search(actor, householdId, "rollstuhl");

    // Both match; the one whose title is the word comes first because its
    // tsvector is shorter, so the term carries more of it.
    expect(labels(hits)[0]).toBe("Rollstuhl");
    expect(hits).toHaveLength(2);
  });
});

describe("what people actually type", () => {
  it("returns nothing for an empty query without running a search", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "A case" });

    const result = await search(actor, householdId, "   ");
    expect(result).toMatchObject({ hits: [], emptyQuery: true });
  });

  // `to_tsquery` raises a syntax error on all of these, which from a search
  // box means the page 500s because somebody typed. This is the whole
  // reason the query uses `websearch_to_tsquery` instead.
  it.each(["a & | b", 'unclosed "quote', "trailing &", "!!!", "-", "(((", "\\"])(
    "does not throw on %j",
    async (query) => {
      const { householdId, actor } = await household();
      await expect(search(actor, householdId, query)).resolves.toBeDefined();
    }
  );

  it("understands a quoted phrase", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Pflegegrad appeal" });
    await createCase(actor, householdId, { title: "Appeal about the Pflegegrad" });

    // A phrase is adjacency, so only the first one matches.
    expect(labels((await search(actor, householdId, '"pflegegrad appeal"')).hits)).toEqual(["Pflegegrad appeal"]);
  });

  it("understands exclusion", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Vienna clinic" });
    await createCase(actor, householdId, { title: "Vienna holiday" });

    expect(labels((await search(actor, householdId, "vienna -holiday")).hits)).toEqual(["Vienna clinic"]);
  });

  // Documented, not aspirational: the generated columns use the `simple`
  // configuration (ADR-022), which folds case but not diacritics, and
  // `unaccent` is not installed. "Muller" therefore does not find "Müller".
  // Worth knowing before somebody reports it as a bug.
  it("matches umlauts exactly, not folded", async () => {
    const { householdId, actor } = await household();
    await recordExpense(actor, householdId, {
      description: "Zahnarzt",
      merchant: "Dr. Müller",
      amount: "89,90",
      incurredOn: "2026-04-01",
    });

    expect(labels((await search(actor, householdId, "müller")).hits)).toEqual(["Zahnarzt"]);
    expect(labels((await search(actor, householdId, "MÜLLER")).hits)).toEqual(["Zahnarzt"]);
    expect((await search(actor, householdId, "muller")).hits).toEqual([]);
  });
});

describe("what search must never reveal", () => {
  // The heart of it. A search that returns the title of something you may
  // not open tells you it exists and what it is called, which is most of
  // what a sensitivity level protects.
  it("does not let a child find a SENSITIVE record by its exact title", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid@example.test", "Lukas");

    await aDocument(householdId, "Consultant's letter", "SENSITIVE");

    expect((await search(actor, householdId, "consultant")).hits).toHaveLength(1);

    const asChild = await search(kid.actor, householdId, "consultant");
    expect(asChild.hits).toEqual([]);
    expect(JSON.stringify(asChild)).not.toContain("Consultant");
  });

  it("does not let a child find an unscoped household record", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid2@example.test", "Lukas");

    // NORMAL and HOUSEHOLD, but about nobody in particular — adult-shared
    // by default, and a child does not inherit it.
    await createTrip(actor, householdId, { title: "Vienna", startsOn: "2026-07-10", endsOn: "2026-07-17" });

    expect((await search(kid.actor, householdId, "vienna")).hits).toEqual([]);
  });

  // The regression this feature found: a case's person scope lives in a
  // join table, and the record resolver was not loading it — so an adult
  // outside the scope could reach through a link, and would now have
  // reached through search, to a case the cases list hides from them.
  it("does not let an adult find a case scoped to someone else", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid3@example.test", "Lukas");
    const other = await member(actor, householdId, "ADULT", "adult@example.test", "Bea");

    await createCase(actor, householdId, {
      title: "Schulbegleitung application",
      aboutPersonIds: [kid.personId],
    });

    expect((await search(actor, householdId, "schulbegleitung")).hits).toHaveLength(1);
    expect((await search(other.actor, householdId, "schulbegleitung")).hits).toEqual([]);
  });

  it("does not reach into another household", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Pflegegrad appeal" });

    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    expect((await search(outsider, "00000000-0000-7000-8000-00000000ffff", "pflegegrad")).hits).toEqual([]);
    // And the household id in the argument is not a way in either: the
    // policy kernel compares it against the actor's own.
    expect((await search(outsider, householdId, "pflegegrad")).hits).toEqual([]);
  });

  it("does not report how many results were withheld", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid4@example.test", "Lukas");
    await aDocument(householdId, "Consultant's letter", "SENSITIVE");

    const asChild = await search(kid.actor, householdId, "consultant");

    // "3 results you may not see" is itself the disclosure.
    expect(Object.keys(asChild).sort()).toEqual(["emptyQuery", "hits", "query", "truncated"]);
    expect(asChild.truncated).toBe(false);
  });
});

describe("records that are no longer current", () => {
  it("does not find an archived expense", async () => {
    const { householdId, actor } = await household();
    const expense = await recordExpense(actor, householdId, {
      description: "Apotheke",
      amount: "12,40",
      incurredOn: "2026-05-02",
    });

    expect((await search(actor, householdId, "apotheke")).hits).toHaveLength(1);

    await archiveExpense(actor, householdId, expense.id, expense.version);

    expect((await search(actor, householdId, "apotheke")).hits).toEqual([]);
  });
});
