"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "../../../infrastructure/auth/auth";

export interface LoginFormState {
  error?: string;
}

export async function submitLogin(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "invalid_credentials" };
    }
    throw error;
  }

  // The welcome moment, not the app root. Signing in is a user gesture,
  // which is what lets the greeting actually be spoken (ADR-026).
  redirect("/welcome");
}
