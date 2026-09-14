"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { linkRecords, unlinkRecords, LinkRuleError } from "../../../../application/commands/links/linkRecords";
import { AuthorizationError, NotFoundError } from "../../../../application/errors";

export interface LinkFormState {
  error?: string;
}

function toErrorCode(error: unknown): string {
  if (error instanceof LinkRuleError) {
    return error.code === "SELF_LINK" ? "self_link" : "invalid_input";
  }
  if (error instanceof AuthorizationError) return "not_authorized";
  // A record the actor cannot read is reported as not found by the
  // command, on purpose: distinguishing the two would make the refusal a
  // way to test whether something exists.
  if (error instanceof NotFoundError) return "not_found";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

export async function submitLinkRecord(_prev: LinkFormState, formData: FormData): Promise<LinkFormState> {
  const { actor, householdId } = await requireActor();

  const caseId = String(formData.get("caseId") ?? "");
  const target = String(formData.get("target") ?? "");
  const [type, id] = target.split(":");

  try {
    await linkRecords(actor, householdId, {
      from: { type: "case", id: caseId },
      to: { type: type as never, id },
      note: String(formData.get("note") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath(`/cases/${caseId}`);
  return {};
}

export async function submitUnlinkRecord(_prev: LinkFormState, formData: FormData): Promise<LinkFormState> {
  const { actor, householdId } = await requireActor();
  const caseId = String(formData.get("caseId") ?? "");

  try {
    await unlinkRecords(actor, householdId, String(formData.get("linkId") ?? ""));
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidatePath(`/cases/${caseId}`);
  return {};
}
