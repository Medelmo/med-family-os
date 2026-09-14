"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import {
  connectIntegration,
  replaceIntegrationCredential,
  setIntegrationEnabled,
  setSyncInterval,
  IntegrationRuleError,
} from "../../../../application/commands/integrations/connectionCommands";
import { runSync } from "../../../../application/commands/integrations/runSync";
import { CredentialCryptoError } from "../../../../infrastructure/crypto/secretBox";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../../application/errors";

export interface IntegrationFormState {
  error?: string;
  /** Counts from a completed sync, so the page can say what happened. */
  synced?: { status: string; imported: number; skipped: number };
}

function toErrorCode(error: unknown): string {
  if (error instanceof CredentialCryptoError) {
    // A misconfigured keyring is an operator problem, not a user one, and
    // deserves its own message rather than "check the details".
    return "keyring_unavailable";
  }
  if (error instanceof IntegrationRuleError) {
    switch (error.code) {
      case "DISABLED":
        return "disabled";
      case "NO_ADAPTER":
        return "no_adapter";
      case "NO_CREDENTIAL":
        return "no_credential";
      case "ALREADY_RUNNING":
        return "already_running";
      case "INTERVAL_TOO_SHORT":
      case "INTERVAL_INVALID":
        return "interval_invalid";
      default:
        return "invalid_input";
    }
  }
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError || error instanceof NotFoundError) return "conflict";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

function revalidateIntegrations() {
  revalidatePath("/settings/integrations");
  revalidatePath("/documents");
}

export async function submitConnect(
  _prev: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await connectIntegration(actor, householdId, {
      provider: String(formData.get("provider") ?? "PAPERLESS") as never,
      displayName: String(formData.get("displayName") ?? ""),
      baseUrl: String(formData.get("baseUrl") ?? ""),
      apiToken: String(formData.get("apiToken") ?? ""),
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateIntegrations();
  return {};
}

export async function submitToggleIntegration(
  _prev: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await setIntegrationEnabled(
      actor,
      householdId,
      String(formData.get("connectionId") ?? ""),
      Number(formData.get("expectedVersion") ?? 0),
      String(formData.get("enabled") ?? "") === "true"
    );
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateIntegrations();
  return {};
}

export async function submitReplaceToken(
  _prev: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await replaceIntegrationCredential(
      actor,
      householdId,
      String(formData.get("connectionId") ?? ""),
      String(formData.get("apiToken") ?? "")
    );
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateIntegrations();
  return {};
}

/**
 * Sets, or clears, how often this connection syncs by itself.
 *
 * This is the moment a household authorizes the application to talk to
 * somebody else's server unattended, which is why the permission check
 * lives in the command behind it and not in the scheduler: the scheduler
 * has no actor to check. An empty value clears the schedule, and the
 * connection goes back to manual only.
 */
export async function submitSetSchedule(
  _prev: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  const { actor, householdId } = await requireActor();

  const raw = String(formData.get("intervalMinutes") ?? "");
  const intervalMinutes = raw === "" ? null : Number(raw);

  if (intervalMinutes !== null && !Number.isFinite(intervalMinutes)) {
    return { error: "interval_invalid" };
  }

  try {
    await setSyncInterval(
      actor,
      householdId,
      String(formData.get("connectionId") ?? ""),
      Number(formData.get("expectedVersion") ?? 0),
      intervalMinutes
    );
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateIntegrations();
  return {};
}

/**
 * Runs a sync now.
 *
 * Returns the counts rather than relying on the page to re-read them,
 * because "did that do anything?" is the question a person asks
 * immediately after pressing the button — and CLAUDE.md §8 is explicit
 * that a toast is not proof a side effect completed. The counts come from
 * the persisted run, not from an optimistic guess.
 */
export async function submitRunSync(
  _prev: IntegrationFormState,
  formData: FormData
): Promise<IntegrationFormState> {
  const { actor, householdId } = await requireActor();

  try {
    const outcome = await runSync(actor, householdId, String(formData.get("connectionId") ?? ""));
    revalidateIntegrations();
    return { synced: { status: outcome.status, imported: outcome.itemsImported, skipped: outcome.itemsSkipped } };
  } catch (error) {
    return { error: toErrorCode(error) };
  }
}
