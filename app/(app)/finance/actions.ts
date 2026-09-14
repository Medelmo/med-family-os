"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import {
  archiveExpense,
  recordExpense,
  InvalidAmountError,
} from "../../../application/commands/finance/recordExpense";
import {
  createReimbursement,
  transitionReimbursement,
  ExpenseLinkError,
  IllegalReimbursementTransitionError,
} from "../../../application/commands/finance/reimbursementCommands";
import { setBudget } from "../../../application/commands/finance/setBudget";
import { parseAmountToMinor } from "../../../domain/finance/money";
import {
  importExpenses,
  previewExpenseImport,
  IMPORT_MAX_BYTES,
} from "../../../application/commands/finance/importExpenses";
import type { ImportPlan } from "../../../domain/finance/expenseImport";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../application/errors";
import type { ReimbursementCommand } from "../../../domain/finance/reimbursement";

export interface FinanceFormState {
  error?: string;
}

/**
 * Maps a thrown error to a stable code the client turns into a translated
 * message.
 *
 * The code, not the message, crosses the boundary: an exception message can
 * carry record detail, and CLAUDE.md §12 keeps that out of anything a user
 * sees. Anything unrecognised is rethrown rather than flattened into a
 * generic failure — an unexpected error should reach the error boundary and
 * the logs, not be quietly displayed as "invalid input".
 */
function toErrorCode(error: unknown): string {
  if (error instanceof IllegalReimbursementTransitionError) {
    switch (error.code) {
      case "FOLLOW_UP_REQUIRED":
        return "follow_up_required";
      case "COUNTERPARTY_REQUIRED":
        return "counterparty_required";
      case "REJECTION_REASON_REQUIRED":
        return "rejection_reason_required";
      case "NOTHING_TO_CLAIM":
        return "nothing_to_claim";
      case "AMOUNT_INVALID":
        return "amount_invalid";
      default:
        return "illegal_transition";
    }
  }
  if (error instanceof ExpenseLinkError) {
    switch (error.code) {
      case "CURRENCY_MISMATCH":
        return "currency_mismatch";
      case "ALREADY_CLAIMED":
        return "already_claimed";
      case "EXPENSE_ARCHIVED":
        return "expense_archived";
      default:
        return "claim_not_editable";
    }
  }
  if (error instanceof InvalidAmountError) return "amount_invalid";
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError || error instanceof NotFoundError) return "conflict";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

function revalidateFinance() {
  revalidatePath("/finance");
  revalidatePath("/finance/claims");
  revalidatePath("/attention");
}

export async function submitRecordExpense(
  _prev: FinanceFormState,
  formData: FormData
): Promise<FinanceFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await recordExpense(actor, householdId, {
      description: String(formData.get("description") ?? ""),
      amount: String(formData.get("amount") ?? ""),
      currency: String(formData.get("currency") ?? "EUR"),
      category: String(formData.get("category") ?? "OTHER") as never,
      incurredOn: String(formData.get("incurredOn") ?? ""),
      merchant: String(formData.get("merchant") ?? "").trim() || null,
      personId: String(formData.get("personId") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateFinance();
  return {};
}

export async function submitArchiveExpense(
  _prev: FinanceFormState,
  formData: FormData
): Promise<FinanceFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await archiveExpense(
      actor,
      householdId,
      String(formData.get("expenseId") ?? ""),
      Number(formData.get("expectedVersion") ?? 0)
    );
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateFinance();
  return {};
}

export async function submitSetBudget(_prev: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await setBudget(actor, householdId, {
      category: String(formData.get("category") ?? "OTHER") as never,
      amount: String(formData.get("amount") ?? ""),
      currency: String(formData.get("currency") ?? "EUR"),
      startsOn: String(formData.get("startsOn") ?? ""),
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateFinance();
  return {};
}

export async function submitCreateClaim(_prev: FinanceFormState, formData: FormData): Promise<FinanceFormState> {
  const { actor, householdId } = await requireActor();

  // getAll, not get: the form offers a checkbox per claimable expense, and
  // taking only the first would silently drop the rest of the claim.
  const expenseIds = formData.getAll("expenseIds").map(String).filter(Boolean);

  try {
    await createReimbursement(actor, householdId, {
      title: String(formData.get("title") ?? ""),
      counterparty: String(formData.get("counterparty") ?? "").trim() || null,
      currency: String(formData.get("currency") ?? "EUR"),
      expenseIds,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateFinance();
  return {};
}

export async function submitClaimTransition(
  _prev: FinanceFormState,
  formData: FormData
): Promise<FinanceFormState> {
  const { actor, householdId } = await requireActor();

  const claimId = String(formData.get("claimId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);
  const action = String(formData.get("action") ?? "");
  const followUpRaw = String(formData.get("followUpAt") ?? "").trim();
  const currency = String(formData.get("currency") ?? "EUR");

  // Amounts arrive as typed text and go through the same documented parser
  // as everything else (ADR-015 §2) rather than through parseFloat.
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const parsedAmount = amountRaw ? parseAmountToMinor(amountRaw, currency) : null;
  if (parsedAmount && !parsedAmount.ok) return { error: "amount_invalid" };

  let command: ReimbursementCommand;
  switch (action) {
    case "submit":
      command = {
        type: "SUBMIT",
        counterparty: String(formData.get("counterparty") ?? ""),
        externalReference: String(formData.get("externalReference") ?? "").trim() || null,
      };
      break;
    case "wait":
      command = {
        type: "WAIT",
        followUpAt: followUpRaw ? new Date(followUpRaw) : null,
        noFollowUpReason: String(formData.get("noFollowUpReason") ?? "").trim() || null,
      };
      break;
    case "approve":
      command = { type: "APPROVE", approvedAmountMinor: parsedAmount?.ok ? parsedAmount.amountMinor : null };
      break;
    case "part_payment":
      if (!parsedAmount?.ok) return { error: "amount_invalid" };
      command = { type: "RECORD_PART_PAYMENT", reimbursedAmountMinor: parsedAmount.amountMinor };
      break;
    case "full_payment":
      if (!parsedAmount?.ok) return { error: "amount_invalid" };
      command = { type: "RECORD_FULL_PAYMENT", reimbursedAmountMinor: parsedAmount.amountMinor };
      break;
    case "reject":
      command = { type: "REJECT", reason: String(formData.get("reason") ?? "") };
      break;
    case "complete":
      command = { type: "COMPLETE" };
      break;
    case "cancel":
      command = { type: "CANCEL", reason: String(formData.get("reason") ?? "").trim() || null };
      break;
    default:
      return { error: "invalid_input" };
  }

  try {
    await transitionReimbursement(actor, householdId, claimId, expectedVersion, command);
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateFinance();
  revalidatePath(`/finance/claims/${claimId}`);
  return {};
}

// --- CSV import -------------------------------------------------------

export interface ImportFormState {
  error?: string;
  /** The reviewable plan, and the exact text it was made from. */
  preview?: { csv: string; plan: ImportPlan };
  result?: { imported: number; skipped: number };
}

async function readUpload(formData: FormData): Promise<{ text: string } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "no_file" };
  if (file.size > IMPORT_MAX_BYTES) return { error: "file_too_large" };

  const text = await file.text();
  // A file the browser labelled as CSV can still be anything; the plan is
  // what decides, and it reports rather than guesses.
  return { text };
}

export async function submitPreviewImport(
  _prev: ImportFormState,
  formData: FormData
): Promise<ImportFormState> {
  const { actor, householdId } = await requireActor();

  const upload = await readUpload(formData);
  if ("error" in upload) return { error: upload.error };

  try {
    const plan = await previewExpenseImport(actor, householdId, upload.text);
    return { preview: { csv: upload.text, plan } };
  } catch (error) {
    return { error: toErrorCode(error) };
  }
}

export async function submitConfirmImport(
  _prev: ImportFormState,
  formData: FormData
): Promise<ImportFormState> {
  const { actor, householdId } = await requireActor();

  // The reviewed text, not the reviewed rows. importExpenses re-plans it
  // with the same pure function, so the preview and the write cannot
  // disagree, and nothing structural has to be trusted across the wire.
  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim()) return { error: "no_file" };
  if (csv.length > IMPORT_MAX_BYTES) return { error: "file_too_large" };

  try {
    const result = await importExpenses(actor, householdId, csv);
    revalidateFinance();
    return { result };
  } catch (error) {
    return { error: toErrorCode(error) };
  }
}
