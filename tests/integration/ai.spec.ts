import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { aiSuggestions, auditEvents, cases } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { createCase } from "../../application/commands/cases/createCase";
import { addCaseNote, setCaseNextAction } from "../../application/commands/cases/caseContext";
import {
  suggestCaseNextAction,
  getOpenSuggestions,
} from "../../application/commands/ai/suggestCaseActions";
import { acceptSuggestion, rejectSuggestion } from "../../application/commands/ai/decideSuggestion";
import type { AssistantProvider } from "../../application/ai/assistantProvider";
import { AssistantError } from "../../application/ai/assistantProvider";
import { getCase } from "../../application/queries/cases/getCases";
import { AuthorizationError, ConflictError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * The advisory pipeline (ADR-027), against a real database.
 *
 * CLAUDE.md §11 in one line — *AI suggestion -> visible provenance ->
 * human review -> explicit confirmation -> domain command* — and the tests
 * that matter are the ones about the arrows that must never be short-cut:
 * a model cannot be shown what its reader cannot see, cannot be shown
 * anything above the ceiling its locality allows, and cannot write
 * anything at all.
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

async function member(actor: Actor, householdId: string, role: "ADULT" | "CHILD" | "VIEWER", email: string) {
  const person = await addHouseholdMember(actor, householdId, {
    displayName: "Lukas",
    role,
    account: { email, temporaryPassword: "another correct horse battery" },
  });
  return {
    actor: { userId: person.accountUserId!, householdId, role, personIds: [person.id] } as Actor,
    personId: person.id,
  };
}

/** A provider that answers with whatever it is told to, and records the prompt. */
function stubProvider(
  reply: string,
  locality: "LOCAL" | "REMOTE" = "LOCAL"
): AssistantProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    model: "test-model:1b",
    locality,
    prompts,
    async complete(request) {
      prompts.push(request.user);
      return reply;
    },
  };
}

const failing = (): AssistantProvider => ({
  model: "test-model:1b",
  locality: "LOCAL",
  async complete(): Promise<string> {
    throw new AssistantError("unreachable", "should never be shown to anyone");
  },
});

describe("proposing", () => {
  it("records a suggestion with full provenance, and changes nothing else", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Pflegegrad Widerspruch" });

    const provider = stubProvider("Bescheid bei der Pflegekasse anfordern");
    const suggestion = await suggestCaseNextAction(actor, householdId, kase.id, { provider });

    expect(suggestion).not.toBeNull();
    expect(suggestion!.status).toBe("PROPOSED");
    expect(suggestion!.payload).toMatchObject({ caseId: kase.id, nextAction: "Bescheid bei der Pflegekasse anfordern" });

    // Provenance is the whole point: which model, where it ran, which
    // prompt, and what it was shown at which version.
    expect(suggestion!.provenance).toMatchObject({
      model: "test-model:1b",
      locality: "LOCAL",
      promptVersion: expect.stringMatching(/^case-next-action\./),
      sources: [{ type: "case", id: kase.id, version: kase.version }],
    });

    // And the case itself is untouched. A proposal is not a change.
    const after = await getCase(actor, householdId, kase.id);
    expect(after.nextAction).toBeNull();
    expect(after.version).toBe(kase.version);
  });

  it("shows the model the case, and never the people it is about", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid@example.test");
    const kase = await createCase(actor, householdId, {
      title: "Schulbegleitung",
      description: "Antrag läuft",
      aboutPersonIds: [kid.personId],
    });

    const provider = stubProvider("Antrag nachfassen");
    await suggestCaseNextAction(actor, householdId, kase.id, { provider });

    const prompt = provider.prompts[0];
    expect(prompt).toContain("Schulbegleitung");
    // Names add nothing to "what should happen next" and are the most
    // identifying thing in the record.
    expect(prompt).not.toContain("Lukas");
  });

  it("never lets a secret in a note reach the prompt", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Portal access" });
    await addCaseNote(actor, householdId, {
      caseId: kase.id,
      body: "Login is api_key=sk-live-9f8e7d6c5b4a and Passwort: hunter2-really",
    });

    const provider = stubProvider("Zugang prüfen");
    const suggestion = await suggestCaseNextAction(actor, householdId, kase.id, { provider });

    const prompt = provider.prompts[0];
    expect(prompt).not.toContain("sk-live-9f8e7d6c5b4a");
    expect(prompt).not.toContain("hunter2-really");
    expect(prompt).toContain("[redacted:");
    // And the fact that something was removed is part of the provenance.
    expect(suggestion!.provenance.redacted.length).toBeGreaterThan(0);
  });

  /**
   * The rule the whole design turns on.
   *
   * A case defaults to NORMAL, so this raises it and asks a *remote*
   * model. Nothing about the case — not its title, not that it exists —
   * may be described.
   */
  it("tells a remote model nothing at all about a SENSITIVE case", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Consultant referral" });
    await db.update(cases).set({ sensitivity: "SENSITIVE" }).where(eq(cases.id, kase.id));

    const remote = stubProvider("should never be asked", "REMOTE");
    const suggestion = await suggestCaseNextAction(actor, householdId, kase.id, { provider: remote });

    expect(suggestion).toBeNull();
    // Not "asked and got nothing" — never asked at all.
    expect(remote.prompts).toEqual([]);

    // And it is recorded, because "the assistant was asked and was told
    // nothing" is exactly what a household should be able to verify.
    const [withheld] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.householdId, householdId), eq(auditEvents.action, "ai.withheld")));
    expect(withheld).toBeDefined();
    expect(withheld.metadata).toMatchObject({ reason: "sensitivity", locality: "REMOTE" });
  });

  it("does let a local model see a SENSITIVE case", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Consultant referral" });
    await db.update(cases).set({ sensitivity: "SENSITIVE" }).where(eq(cases.id, kase.id));

    const local = stubProvider("Termin bestätigen", "LOCAL");
    const suggestion = await suggestCaseNextAction(actor, householdId, kase.id, { provider: local });

    expect(suggestion).not.toBeNull();
    expect(local.prompts[0]).toContain("Consultant referral");
  });

  it("tells nothing to any provider about a HIGHLY_SENSITIVE case", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Psychology report" });
    await db.update(cases).set({ sensitivity: "HIGHLY_SENSITIVE" }).where(eq(cases.id, kase.id));

    for (const locality of ["LOCAL", "REMOTE"] as const) {
      const provider = stubProvider("never", locality);
      expect(await suggestCaseNextAction(actor, householdId, kase.id, { provider })).toBeNull();
      expect(provider.prompts).toEqual([]);
    }
  });

  it("refuses a case the actor may not read, before asking anything", async () => {
    const { householdId, actor } = await household();
    const kid = await member(actor, householdId, "CHILD", "kid2@example.test");
    const kase = await createCase(actor, householdId, { title: "Adult-only case" });

    const provider = stubProvider("never");
    await expect(
      suggestCaseNextAction(kid.actor, householdId, kase.id, { provider })
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(provider.prompts).toEqual([]);
  });

  it("refuses a household the actor is not in", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    const provider = stubProvider("never");
    await expect(suggestCaseNextAction(outsider, householdId, kase.id, { provider })).rejects.toThrow();
    expect(provider.prompts).toEqual([]);
  });

  // A model saying "there is nothing obvious here" is a good answer.
  it.each([["NONE"], ["none"], [""], ["   "]])("stores nothing when the model replies %j", async (reply) => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });

    expect(
      await suggestCaseNextAction(actor, householdId, kase.id, { provider: stubProvider(reply) })
    ).toBeNull();
    expect(await db.select().from(aiSuggestions)).toEqual([]);
  });

  // A reply that ignored the format ignored the *other* instructions too,
  // including the one about not inventing reference numbers.
  it("refuses a reply that did not follow the instruction", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });
    const rambling = "Certainly! Here is what I would suggest for this case, ".repeat(6);

    expect(
      await suggestCaseNextAction(actor, householdId, kase.id, { provider: stubProvider(rambling) })
    ).toBeNull();
  });

  it("never repeats what the provider said when it fails", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "A case" });

    const error = await suggestCaseNextAction(actor, householdId, kase.id, {
      provider: failing(),
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AssistantError);
    expect(error.message).not.toContain("should never be shown");
    expect(error.message).toMatch(/could not be reached/i);
  });
});

describe("deciding", () => {
  async function proposed() {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Pflegegrad Widerspruch" });
    const suggestion = await suggestCaseNextAction(actor, householdId, kase.id, {
      provider: stubProvider("Bescheid anfordern"),
    });
    return { householdId, actor, kase, suggestion: suggestion! };
  }

  /**
   * The last arrow. Accepting does not write the suggestion — it runs the
   * ordinary domain command with the accepting person as the actor.
   */
  it("applies the change through the real command, attributed to the person", async () => {
    const { householdId, actor, kase, suggestion } = await proposed();

    const decided = await acceptSuggestion(actor, householdId, suggestion.id);

    expect(decided.status).toBe("ACCEPTED");
    expect(decided.decidedBy).toBe(actor.userId);
    expect(decided.resultId).toBe(kase.id);

    const after = await getCase(actor, householdId, kase.id);
    expect(after.nextAction).toBe("Bescheid anfordern");
    // The version moved because a real write happened — through the same
    // optimistic-concurrency path as typing it by hand.
    expect(after.version).toBe(kase.version + 1);
  });

  it("records who accepted, and what produced it", async () => {
    const { householdId, actor, suggestion } = await proposed();
    await acceptSuggestion(actor, householdId, suggestion.id);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.householdId, householdId), eq(auditEvents.action, "ai.suggestion_accepted")));

    expect(event.actorUserId).toBe(actor.userId);
    expect(event.metadata).toMatchObject({ model: "test-model:1b", resultType: "case" });
    // The audit trail is read by people who may not be able to read the
    // case, so it names the model and never the suggestion's text.
    expect(JSON.stringify(event.metadata)).not.toContain("Bescheid");
  });

  it("keeps a rejection rather than deleting it", async () => {
    const { householdId, actor, kase, suggestion } = await proposed();

    const decided = await rejectSuggestion(actor, householdId, suggestion.id);
    expect(decided.status).toBe("REJECTED");
    expect(decided.decidedBy).toBe(actor.userId);

    // Still there — what a household declined is part of the record.
    expect(await db.select().from(aiSuggestions)).toHaveLength(1);
    // And nothing was applied.
    expect((await getCase(actor, householdId, kase.id)).nextAction).toBeNull();
  });

  it("refuses to decide the same suggestion twice", async () => {
    const { householdId, actor, suggestion } = await proposed();
    await acceptSuggestion(actor, householdId, suggestion.id);

    await expect(acceptSuggestion(actor, householdId, suggestion.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(rejectSuggestion(actor, householdId, suggestion.id)).rejects.toBeInstanceOf(ConflictError);
  });

  /**
   * Advice about a world that has moved on is worse than no advice: a
   * suggested next action for a case somebody has since dealt with would
   * undo their work.
   */
  it("refuses advice about a case that has changed since, and marks it stale", async () => {
    const { householdId, actor, kase, suggestion } = await proposed();

    // Somebody gets there first.
    await setCaseNextAction(actor, householdId, {
      caseId: kase.id,
      expectedVersion: kase.version,
      nextAction: "Already handled by a human",
    });

    await expect(acceptSuggestion(actor, householdId, suggestion.id)).rejects.toBeInstanceOf(ConflictError);

    const [row] = await db.select().from(aiSuggestions).where(eq(aiSuggestions.id, suggestion.id));
    expect(row.status).toBe("STALE");

    // And the human's own work survived untouched.
    expect((await getCase(actor, householdId, kase.id)).nextAction).toBe("Already handled by a human");
  });

  it("refuses a suggestion from another household", async () => {
    const { householdId, suggestion } = await proposed();
    const outsider: Actor = {
      userId: "00000000-0000-7000-8000-000000000001",
      householdId: "00000000-0000-7000-8000-00000000ffff",
      role: "OWNER",
      personIds: [],
    };

    await expect(acceptSuggestion(outsider, householdId, suggestion.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists only the open suggestions for a case", async () => {
    const { householdId, actor, kase, suggestion } = await proposed();

    expect(await getOpenSuggestions(actor, householdId, kase.id)).toHaveLength(1);

    await rejectSuggestion(actor, householdId, suggestion.id);
    expect(await getOpenSuggestions(actor, householdId, kase.id)).toEqual([]);
  });
});
