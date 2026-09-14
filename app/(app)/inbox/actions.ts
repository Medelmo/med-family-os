"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { captureInboxItem } from "../../../application/commands/inbox/captureInboxItem";
import { discardInboxItem, triageInboxItemToTask } from "../../../application/commands/inbox/triageInboxItem";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../application/errors";

export interface InboxFormState {
  error?: string;
}

function toErrorCode(error: unknown): string {
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError || error instanceof NotFoundError) return "conflict";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

export async function submitCapture(_prev: InboxFormState, formData: FormData): Promise<InboxFormState> {
  const { actor, householdId } = await requireActor();
  try {
    await captureInboxItem(actor, householdId, { capturedText: String(formData.get("capturedText") ?? "") });
  } catch (error) {
    return { error: toErrorCode(error) };
  }
  revalidatePath("/inbox");
  return {};
}

export async function submitTriageToTask(_prev: InboxFormState, formData: FormData): Promise<InboxFormState> {
  const { actor, householdId } = await requireActor();
  const dueOnRaw = String(formData.get("dueOn") ?? "").trim();
  const nextActionRaw = String(formData.get("nextAction") ?? "").trim();

  try {
    await triageInboxItemToTask(actor, householdId, {
      inboxItemId: String(formData.get("inboxItemId") ?? ""),
      expectedVersion: Number(formData.get("expectedVersion") ?? 0),
      title: String(formData.get("title") ?? ""),
      priority: "NORMAL",
      dueOn: dueOnRaw ? new Date(dueOnRaw) : null,
      nextAction: nextActionRaw || null,
      aboutPersonIds: [],
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath("/inbox");
  revalidatePath("/tasks");
  return {};
}

export async function submitDiscard(_prev: InboxFormState, formData: FormData): Promise<InboxFormState> {
  const { actor, householdId } = await requireActor();
  try {
    await discardInboxItem(actor, householdId, {
      inboxItemId: String(formData.get("inboxItemId") ?? ""),
      expectedVersion: Number(formData.get("expectedVersion") ?? 0),
      reason: null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }
  revalidatePath("/inbox");
  return {};
}
