"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { bootstrapHousehold, BootstrapNotAllowedError } from "../../../application/commands/household/bootstrapHousehold";
import { signIn } from "../../../infrastructure/auth/auth";
import { logger } from "../../../infrastructure/logging/logger";

export interface SetupFormState {
  error?: string;
}

export async function submitSetup(_prevState: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const householdName = String(formData.get("householdName") ?? "");
  const ownerName = String(formData.get("ownerName") ?? "");
  const ownerEmail = String(formData.get("ownerEmail") ?? "");
  const ownerPassword = String(formData.get("ownerPassword") ?? "");

  try {
    await bootstrapHousehold({ householdName, ownerName, ownerEmail, ownerPassword });
  } catch (error) {
    if (error instanceof BootstrapNotAllowedError) {
      return { error: "already_set_up" };
    }
    if (error instanceof ZodError) {
      return { error: "invalid_input" };
    }
    logger.error({ err: error, event: "setup.failed" }, "household bootstrap failed");
    return { error: "unknown" };
  }

  // Sign the new owner in immediately rather than bouncing them to /login
  // right after they just typed the same credentials.
  await signIn("credentials", { email: ownerEmail, password: ownerPassword, redirect: false });
  // Straight into the welcome moment: the household's very first sight
  // of the application it just created (ADR-026).
  redirect("/welcome");
}
