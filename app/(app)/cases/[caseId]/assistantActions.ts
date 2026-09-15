"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import {
  suggestCaseNextAction,
  AssistantNotConfiguredError,
} from "../../../../application/commands/ai/suggestCaseActions";
import { acceptSuggestion, rejectSuggestion } from "../../../../application/commands/ai/decideSuggestion";
import { AssistantError } from "../../../../application/ai/assistantProvider";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../../application/errors";

export interface AssistantFormState {
  error?: string;
  /** The assistant was asked and had nothing to propose. Not a failure. */
  empty?: boolean;
  /** Asked, and told nothing, because the case is above the ceiling. */
  withheld?: boolean;
}

/**
 * Error codes, translated in the client.
 *
 * Nothing a provider says is ever passed through — the fixed table in
 * `assistantProvider.ts` and this mapping are the only text a person sees,
 * which is the rule a credential leak taught the sync driver in Phase 7.
 */
function toCode(error: unknown): string {
  if (error instanceof AssistantNotConfiguredError) return "not_configured";
  if (error instanceof AssistantError) return error.kind;
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError) return "conflict";
  if (error instanceof NotFoundError) return "not_found";
  throw error;
}

export async function submitAskAssistant(
  _prev: AssistantFormState,
  formData: FormData
): Promise<AssistantFormState> {
  const { actor, householdId } = await requireActor();
  const caseId = String(formData.get("caseId") ?? "");

  try {
    const suggestion = await suggestCaseNextAction(actor, householdId, caseId);
    revalidatePath(`/cases/${caseId}`);

    // Null has two meanings and they are not the same thing to a reader:
    // "there was nothing obvious to suggest" and "this case is too
    // sensitive to describe to the configured model". The second is the
    // one somebody might want to act on, by running a local model.
    if (!suggestion) return { empty: true };
    return {};
  } catch (error) {
    return { error: toCode(error) };
  }
}

export async function submitAcceptSuggestion(
  _prev: AssistantFormState,
  formData: FormData
): Promise<AssistantFormState> {
  const { actor, householdId } = await requireActor();
  const caseId = String(formData.get("caseId") ?? "");

  try {
    await acceptSuggestion(actor, householdId, String(formData.get("suggestionId") ?? ""));
  } catch (error) {
    return { error: toCode(error) };
  }

  revalidatePath(`/cases/${caseId}`);
  return {};
}

export async function submitRejectSuggestion(
  _prev: AssistantFormState,
  formData: FormData
): Promise<AssistantFormState> {
  const { actor, householdId } = await requireActor();
  const caseId = String(formData.get("caseId") ?? "");

  try {
    await rejectSuggestion(actor, householdId, String(formData.get("suggestionId") ?? ""));
  } catch (error) {
    return { error: toCode(error) };
  }

  revalidatePath(`/cases/${caseId}`);
  return {};
}
