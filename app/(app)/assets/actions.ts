"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import {
  addMaintenanceRecord,
  addWarranty,
  createAsset,
  disposeAsset,
  AssetRuleError,
} from "../../../application/commands/assets/assetCommands";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../application/errors";

export interface AssetFormState {
  error?: string;
}

/** See app/(app)/finance/actions.ts for why the code, not the message, crosses this boundary. */
function toErrorCode(error: unknown): string {
  if (error instanceof AssetRuleError) {
    switch (error.code) {
      case "AMOUNT_INVALID":
        return "amount_invalid";
      case "PROVIDER_REQUIRED":
        return "provider_required";
      case "WARRANTY_DATES_OUT_OF_ORDER":
        return "warranty_dates_out_of_order";
      case "MAINTENANCE_IN_FUTURE":
        return "maintenance_in_future";
      case "NEXT_DUE_BEFORE_PERFORMED":
        return "next_due_before_performed";
      case "ALREADY_DISPOSED":
        return "already_disposed";
      default:
        return "invalid_input";
    }
  }
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError || error instanceof NotFoundError) return "conflict";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

function revalidateAsset(assetId?: string) {
  revalidatePath("/assets");
  revalidatePath("/attention");
  if (assetId) revalidatePath(`/assets/${assetId}`);
}

export async function submitCreateAsset(_prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await createAsset(actor, householdId, {
      name: String(formData.get("name") ?? ""),
      category: String(formData.get("category") ?? "OTHER") as never,
      location: String(formData.get("location") ?? "").trim() || null,
      manufacturer: String(formData.get("manufacturer") ?? "").trim() || null,
      identifier: String(formData.get("identifier") ?? "").trim() || null,
      purchasedOn: String(formData.get("purchasedOn") ?? "").trim() || null,
      purchasePrice: String(formData.get("purchasePrice") ?? "").trim() || null,
      personId: String(formData.get("personId") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateAsset();
  return {};
}

export async function submitAddWarranty(_prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const { actor, householdId } = await requireActor();
  const assetId = String(formData.get("assetId") ?? "");

  try {
    await addWarranty(actor, householdId, assetId, {
      provider: String(formData.get("provider") ?? ""),
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? ""),
      reference: String(formData.get("reference") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateAsset(assetId);
  return {};
}

export async function submitAddMaintenance(_prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const { actor, householdId } = await requireActor();
  const assetId = String(formData.get("assetId") ?? "");

  try {
    await addMaintenanceRecord(actor, householdId, assetId, {
      performedOn: String(formData.get("performedOn") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      performedBy: String(formData.get("performedBy") ?? "").trim() || null,
      cost: String(formData.get("cost") ?? "").trim() || null,
      nextDueOn: String(formData.get("nextDueOn") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateAsset(assetId);
  return {};
}

export async function submitDisposeAsset(_prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const { actor, householdId } = await requireActor();
  const assetId = String(formData.get("assetId") ?? "");

  try {
    await disposeAsset(actor, householdId, assetId, Number(formData.get("expectedVersion") ?? 0), {
      disposedOn: String(formData.get("disposedOn") ?? ""),
      note: String(formData.get("note") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateAsset(assetId);
  return {};
}
