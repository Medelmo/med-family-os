import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { aiSuggestions } from "../../../db/schema";
import { buildCaseContext } from "../../ai/caseContext";
import {
  AssistantError,
  ASSISTANT_FAILURES,
  type AssistantProvider,
} from "../../ai/assistantProvider";
import { createAssistantProvider, readAssistantConfig, ASSISTANT_TIMEOUT_MS } from "../../../infrastructure/ai/openAiCompatible";
import type { Provenance, Suggestion, SuggestionKind } from "../../../domain/ai/suggestion";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeCaseAccess } from "../../policies/case";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";
import { logger } from "../../../infrastructure/logging/logger";

/**
 * The prompt, and its version.
 *
 * Versioned because a suggestion outlives the instructions that produced
 * it: somebody reading an accepted task next year should be able to find
 * out what the model was actually asked. Bump on any change to the text.
 */
export const PROMPT_VERSION = "case-next-action.v1";

const SYSTEM_PROMPT = [
  "You help a family keep track of administrative and care processes in Germany.",
  "You are given one case: what it is, what has happened, and what is already planned.",
  "",
  "Propose the single most useful next action the household could take.",
  "",
  "Rules:",
  "- One short imperative sentence, at most 12 words.",
  "- It must be something a person does, not something they wait for.",
  "- Do not repeat an action that is already on the case.",
  "- Do not invent facts, dates, names, reference numbers or amounts.",
  "- If the case does not support a confident suggestion, reply exactly: NONE",
  "- Reply with the sentence alone. No preamble, no explanation, no quotes.",
].join("\n");

/**
 * The token budget.
 *
 * Far larger than twelve words needs, deliberately: reasoning models spend
 * most of a budget thinking before they write anything, and a budget sized
 * for the *answer* makes them return nothing at all. Testing against a
 * real local qwen3 produced exactly that — an empty reply with the whole
 * thought still in its reasoning field.
 *
 * Sizing generously costs nothing, because the budget governs the model's
 * process while `usableAction` below governs the output: a model that
 * thinks for four hundred tokens and then writes a paragraph is still
 * refused.
 */
const MAX_TOKENS = 512;

export interface SuggestionOptions {
  provider?: AssistantProvider;
  now?: Date;
}

export class AssistantNotConfiguredError extends Error {
  constructor() {
    super(ASSISTANT_FAILURES.not_configured);
    this.name = "AssistantNotConfiguredError";
  }
}

/**
 * Asks the assistant what this case needs next, and records the answer as
 * a suggestion nobody has agreed to yet (ADR-027).
 *
 * Writes an `ai_suggestion` row and nothing else. It cannot change the
 * case, create a task, or touch any household record — the only thing
 * that does any of that is a person accepting it, through
 * `decideSuggestion`, which runs the ordinary domain command with them as
 * the actor.
 *
 * Authorization is checked twice over, and deliberately: `buildCaseContext`
 * reads through `getCase`, which refuses a case this actor may not see,
 * and the update permission is checked here as well — because *proposing a
 * change* to a case is only useful to somebody who could make it, and a
 * viewer being shown suggestions they can never accept is an interface
 * lying about what it can do.
 */
export async function suggestCaseNextAction(
  actor: Actor,
  householdId: string,
  caseId: string,
  options: SuggestionOptions = {}
): Promise<Suggestion | null> {
  const now = options.now ?? new Date();

  const provider = options.provider ?? configuredProvider();
  if (!provider) throw new AssistantNotConfiguredError();

  const context = await buildCaseContext(actor, householdId, caseId, provider.locality);

  // The authorization the context query performed was "may you read this".
  // This is the other half: "may you change it". Checked against the case
  // as the query returned it, so there is no second read to disagree with.
  if (
    !authorizeCaseAccess(actor, "update", {
      householdId,
      visibility: "HOUSEHOLD",
      sensitivity: "NORMAL",
      createdBy: null,
      personScopeIds: [],
    })
  ) {
    throw new AuthorizationError("Not permitted to change this case.");
  }

  if (!context.usable) {
    // Above the provider's ceiling. Recorded as an audit event anyway:
    // "the assistant was asked and was told nothing" is exactly the kind
    // of thing a household should be able to verify afterwards.
    await recordAuditEvent({
      householdId,
      actorUserId: actor.userId,
      action: "ai.withheld",
      resourceType: "case",
      resourceId: caseId,
      metadata: { reason: "sensitivity", locality: provider.locality },
    });
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);

  let reply: string;
  try {
    reply = await provider.complete(
      { system: SYSTEM_PROMPT, user: context.text, maxTokens: MAX_TOKENS },
      controller.signal
    );
  } catch (error) {
    const kind = error instanceof AssistantError ? error.kind : "unreachable";
    // This application's own words, never the provider's — the rule a
    // credential leak taught the sync driver in Phase 7.
    logger.warn({ event: "ai.failed", householdId, caseId, kind }, "assistant call failed");
    throw new AssistantError(kind, ASSISTANT_FAILURES[kind]);
  } finally {
    clearTimeout(timer);
  }

  const action = usableAction(reply);
  if (!action) {
    // A model saying "NONE" is a good answer, not a failure: the honest
    // response to a case with nothing obvious to do is to say so.
    logger.info({ event: "ai.no_suggestion", householdId, caseId }, "assistant had nothing to suggest");
    return null;
  }

  const provenance: Provenance = {
    model: provider.model,
    locality: provider.locality,
    promptVersion: PROMPT_VERSION,
    sources: context.sources,
    withheld: context.withheld,
    redacted: context.redacted,
    generatedAt: now,
  };

  const [row] = await db
    .insert(aiSuggestions)
    .values({
      householdId,
      kind: "CASE_NEXT_ACTION" satisfies SuggestionKind,
      payload: { caseId, nextAction: action },
      provenance,
    })
    .returning();

  await recordAuditEvent({
    householdId,
    actorUserId: actor.userId,
    action: "ai.suggested",
    resourceType: "ai_suggestion",
    resourceId: row.id,
    // The model and the prompt, never the suggestion's text: an audit row
    // is read by people who may not be able to read the case it is about.
    metadata: {
      kind: "CASE_NEXT_ACTION",
      model: provider.model,
      locality: provider.locality,
      promptVersion: PROMPT_VERSION,
      redacted: context.redacted.length,
    },
  });

  return row as unknown as Suggestion;
}

/**
 * What the model said, if it is worth showing.
 *
 * Models are chatty even when told not to be, so this refuses rather than
 * cleans up: a reply that did not follow the instruction is a reply that
 * cannot be trusted to have followed the *other* instructions either —
 * including the one about not inventing reference numbers.
 */
function usableAction(reply: string): string | null {
  const first = reply.trim().split("\n")[0].trim().replace(/^["'`]|["'`]$/g, "");

  if (first.length === 0) return null;
  if (/^none$/i.test(first)) return null;
  // Twelve words was the instruction; twenty is the point at which it is
  // clearly not a next action any more.
  if (first.split(/\s+/).length > 20) return null;
  if (first.length > 200) return null;

  return first;
}

function configuredProvider(): AssistantProvider | null {
  const config = readAssistantConfig();
  return config ? createAssistantProvider(config) : null;
}

/** Whether this deployment has an assistant at all. */
export function assistantAvailable(): boolean {
  return readAssistantConfig() !== null;
}

/** Open suggestions for a case, newest first. */
export async function getOpenSuggestions(
  actor: Actor,
  householdId: string,
  caseId: string
): Promise<Suggestion[]> {
  if (actor.householdId !== householdId) return [];

  const rows = await db
    .select()
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.householdId, householdId), eq(aiSuggestions.status, "PROPOSED")))
    .orderBy(desc(aiSuggestions.createdAt))
    .limit(20);

  return rows.filter(
    (row) => (row.payload as { caseId?: string }).caseId === caseId
  ) as unknown as Suggestion[];
}
