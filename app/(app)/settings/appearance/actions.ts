"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { DESIGN_COOKIE, isSupportedDesign } from "../../../design-worlds";
import { requireActor } from "../../../../infrastructure/auth/currentActor";

export interface AppearanceFormState {
  saved?: boolean;
  error?: string;
}

/**
 * Sets the design world this browser renders the app in (ADR-029).
 *
 * A cookie rather than a column, for the same reason `submitLanguage`
 * gives: which world you see is a property of the browser you are sitting
 * at, not of your household record — the same person may want Terminal
 * Zero on a laptop and Bento Bright on the kitchen tablet.
 *
 * `httpOnly: false` deliberately, as with the locale cookie: the value is
 * a ten-item enum with no security meaning, and the picker reads it back
 * to show what is currently selected.
 */
export async function submitDesign(
  _prev: AppearanceFormState,
  formData: FormData
): Promise<AppearanceFormState> {
  // Signed in, even though this writes nothing sensitive — see
  // submitLanguage's identical note.
  await requireActor();

  const requested = String(formData.get("design") ?? "");
  if (!isSupportedDesign(requested)) {
    return { error: "unsupported" };
  }

  const store = await cookies();
  store.set(DESIGN_COOKIE, requested, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });

  // Every panel on every page reads these tokens, so the whole tree is
  // stale in the same way a locale change makes it stale.
  revalidatePath("/", "layout");
  return { saved: true };
}
