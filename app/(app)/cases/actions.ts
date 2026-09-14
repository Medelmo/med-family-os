"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { createCase } from "../../../application/commands/cases/createCase";
import { transitionCase, IllegalCaseTransitionError } from "../../../application/commands/cases/transitionCase";
import { addCaseNote, setCaseNextAction } from "../../../application/commands/cases/caseContext";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../application/errors";
import type { CaseCommand } from "../../../domain/cases/case";

export interface CaseFormState {
  error?: string;
}

function toErrorCode(error: unknown): string {
  if (error instanceof IllegalCaseTransitionError) {
    return error.code === "FOLLOW_UP_REQUIRED"
      ? "follow_up_required"
      : error.code === "BLOCKING_REASON_REQUIRED"
        ? "blocking_reason_required"
        : "illegal_transition";
  }
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError || error instanceof NotFoundError) return "conflict";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

export async function submitCreateCase(_prev: CaseFormState, formData: FormData): Promise<CaseFormState> {
  const { actor, householdId } = await requireActor();
  const nextAction = String(formData.get("nextAction") ?? "").trim();

  try {
    await createCase(actor, householdId, {
      title: String(formData.get("title") ?? ""),
      nextAction: nextAction || null,
      priority: "NORMAL",
      aboutPersonIds: [],
      activate: true,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath("/cases");
  revalidatePath("/attention");
  return {};
}

export async function submitCaseTransition(_prev: CaseFormState, formData: FormData): Promise<CaseFormState> {
  const { actor, householdId } = await requireActor();

  const caseId = String(formData.get("caseId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);
  const action = String(formData.get("action") ?? "");
  const followUpRaw = String(formData.get("followUpAt") ?? "").trim();

  let command: CaseCommand;
  switch (action) {
    case "activate":
      command = { type: "ACTIVATE" };
      break;
    case "wait":
      command = {
        type: "WAIT",
        waitingFor: String(formData.get("waitingFor") ?? "").trim(),
        followUpAt: followUpRaw ? new Date(followUpRaw) : null,
        noFollowUpReason: String(formData.get("noFollowUpReason") ?? "").trim() || null,
        externalReference: String(formData.get("externalReference") ?? "").trim() || null,
      };
      break;
    case "block":
      command = { type: "BLOCK", reason: String(formData.get("blockedReason") ?? "") };
      break;
    case "resume":
      command = { type: "RESUME" };
      break;
    case "complete":
      command = { type: "COMPLETE" };
      break;
    case "cancel":
      command = { type: "CANCEL", reason: null };
      break;
    case "archive":
      command = { type: "ARCHIVE" };
      break;
    default:
      return { error: "invalid_input" };
  }

  try {
    await transitionCase(actor, householdId, caseId, expectedVersion, command);
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/attention");
  return {};
}

export async function submitCaseNote(_prev: CaseFormState, formData: FormData): Promise<CaseFormState> {
  const { actor, householdId } = await requireActor();
  const caseId = String(formData.get("caseId") ?? "");

  try {
    await addCaseNote(actor, householdId, { caseId, body: String(formData.get("body") ?? "") });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath(`/cases/${caseId}`);
  return {};
}

export async function submitCaseNextAction(_prev: CaseFormState, formData: FormData): Promise<CaseFormState> {
  const { actor, householdId } = await requireActor();
  const caseId = String(formData.get("caseId") ?? "");
  const nextAction = String(formData.get("nextAction") ?? "").trim();

  try {
    await setCaseNextAction(actor, householdId, {
      caseId,
      expectedVersion: Number(formData.get("expectedVersion") ?? 0),
      nextAction: nextAction || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/attention");
  return {};
}
