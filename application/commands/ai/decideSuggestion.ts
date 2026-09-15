import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { aiSuggestions, cases } from "../../../db/schema";
import {
  applySuggestionCommand,
  isStale,
  type Suggestion,
  type SuggestionSource,
} from "../../../domain/ai/suggestion";
import { setCaseNextAction } from "../cases/caseContext";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import type { Actor } from "../../policies/authorize";
import { ConflictError, NotFoundError } from "../../errors";

/**
 * A person deciding about a suggestion (ADR-027).
 *
 * This is the arrow CLAUDE.md §11 draws last — *explicit confirmation ->
 * domain command* — and the thing to understand about it is that
 * **accepting does not apply the suggestion; it runs the ordinary
 * command.**
 *
 * `setCaseNextAction` is the same function the case detail form calls,
 * with the accepting person as the actor, going through the same policy
 * kernel, the same state machine, the same optimistic-concurrency check
 * and the same audit trail. If they may not change that case, accepting
 * fails exactly as typing it would have.
 *
 * So "AI cannot directly mutate sensitive records" is not enforced by a
 * rule about AI. There is simply no code path from a model's output to a
 * row — only a path from a person's decision to a row, and that path
 * already existed.
 */

export async function acceptSuggestion(
  actor: Actor,
  householdId: string,
  suggestionId: string,
  now: Date = new Date()
): Promise<Suggestion> {
  const suggestion = await load(actor, householdId, suggestionId);

  // Advice about a world that has moved on is worse than no advice: a
  // suggested next action for a case somebody has since resolved would
  // undo their work. Checked at the moment of acceptance, not only at
  // the moment of proposal, because the gap between the two is exactly
  // where the change happens.
  if (await sourcesChanged(suggestion.provenance.sources)) {
    await markStale(householdId, suggestion, now);
    throw new ConflictError("This was suggested about an earlier version of the case. Ask again.");
  }

  const payload = suggestion.payload as { caseId?: string; nextAction?: string };
  if (!payload.caseId || !payload.nextAction) {
    throw new ConflictError("This suggestion is no longer readable.");
  }

  // The real command, with the real actor. Anything it refuses — a case
  // they may not change, a version that moved — refuses the acceptance,
  // and does so with its own message rather than an AI-flavoured one.
  //
  // `expectedVersion` is the version the model was *shown*, taken straight
  // from the provenance. So the command's ordinary optimistic-concurrency
  // check is also the staleness check: accepting advice about a case that
  // has changed since fails on the same mechanism that stops two people
  // overwriting each other, rather than on a rule invented for AI.
  const caseSource = suggestion.provenance.sources.find((s) => s.type === "case" && s.id === payload.caseId);
  if (!caseSource) throw new ConflictError("This suggestion is no longer readable.");

  await setCaseNextAction(actor, householdId, {
    caseId: payload.caseId,
    expectedVersion: caseSource.version,
    nextAction: payload.nextAction,
  });

  const result = applySuggestionCommand(suggestion, {
    type: "ACCEPT",
    actorUserId: actor.userId,
    resultType: "case",
    resultId: payload.caseId,
  }, now);

  if (!result.ok) throw new ConflictError(result.rejection.message);

  const [row] = await db
    .update(aiSuggestions)
    .set(result.transition.patch)
    .where(eq(aiSuggestions.id, suggestionId))
    .returning();

  await recordAuditEvent({
    householdId,
    actorUserId: actor.userId,
    action: result.transition.auditAction,
    resourceType: "ai_suggestion",
    resourceId: suggestionId,
    metadata: {
      model: suggestion.provenance.model,
      promptVersion: suggestion.provenance.promptVersion,
      resultType: "case",
      resultId: payload.caseId,
    },
  });

  return row as unknown as Suggestion;
}

/**
 * Turning one down.
 *
 * Kept rather than deleted. What a household *declined* is part of the
 * record too — and a model that keeps proposing something they keep
 * refusing is a fact somebody should be able to see.
 */
export async function rejectSuggestion(
  actor: Actor,
  householdId: string,
  suggestionId: string,
  now: Date = new Date()
): Promise<Suggestion> {
  const suggestion = await load(actor, householdId, suggestionId);

  const result = applySuggestionCommand(suggestion, { type: "REJECT", actorUserId: actor.userId }, now);
  if (!result.ok) throw new ConflictError(result.rejection.message);

  const [row] = await db
    .update(aiSuggestions)
    .set(result.transition.patch)
    .where(eq(aiSuggestions.id, suggestionId))
    .returning();

  await recordAuditEvent({
    householdId,
    actorUserId: actor.userId,
    action: result.transition.auditAction,
    resourceType: "ai_suggestion",
    resourceId: suggestionId,
    metadata: { model: suggestion.provenance.model, promptVersion: suggestion.provenance.promptVersion },
  });

  return row as unknown as Suggestion;
}

async function load(actor: Actor, householdId: string, suggestionId: string): Promise<Suggestion> {
  // Household first, as everywhere: an id from a form is not evidence of
  // anything (the brief's "never trust object IDs from URLs").
  if (actor.householdId !== householdId) throw new NotFoundError("Suggestion not found.");

  const [row] = await db
    .select()
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.id, suggestionId), eq(aiSuggestions.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Suggestion not found.");
  return row as unknown as Suggestion;
}

/**
 * Whether anything the model was shown has changed since.
 *
 * Uses the `version` column every mutable aggregate carries (CLAUDE.md
 * §8), so this is an exact answer rather than a timestamp comparison —
 * and a case that has been deleted counts as changed, which is the
 * strongest form of change there is.
 */
async function sourcesChanged(sources: readonly SuggestionSource[]): Promise<boolean> {
  const caseIds = sources.filter((s) => s.type === "case").map((s) => s.id);
  if (caseIds.length === 0) return false;

  const rows = await db
    .select({ id: cases.id, version: cases.version })
    .from(cases)
    .where(inArray(cases.id, caseIds));

  const current = new Map(rows.map((row) => [`case:${row.id}`, row.version]));
  return isStale(sources, current);
}

async function markStale(householdId: string, suggestion: Suggestion, now: Date): Promise<void> {
  const result = applySuggestionCommand(suggestion, { type: "MARK_STALE" }, now);
  if (!result.ok) return;

  await db.update(aiSuggestions).set(result.transition.patch).where(eq(aiSuggestions.id, suggestion.id));

  await recordAuditEvent({
    householdId,
    actorUserId: null,
    action: result.transition.auditAction,
    resourceType: "ai_suggestion",
    resourceId: suggestion.id,
  });
}
