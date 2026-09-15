"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isSupportedLocale } from "../../../../i18n/request";
import { requireActor } from "../../../../infrastructure/auth/currentActor";

export interface LanguageFormState {
  saved?: boolean;
  error?: string;
}

/**
 * Sets the language this person sees, and hears (ADR-008, ADR-026).
 *
 * A cookie rather than a column: language is a property of the browser
 * somebody is sitting at, not of their household record — the same person
 * may want German on the kitchen tablet and English on a work laptop, and
 * a stored preference would fight them for it.
 *
 * `httpOnly: false` deliberately. The value is a two-letter language tag
 * with no security meaning whatsoever, and client code reads it to keep
 * the speech voice in step with the interface. Everything that *is*
 * sensitive stays in the session cookie, which is httpOnly and is not
 * this.
 */
export async function submitLanguage(
  _prev: LanguageFormState,
  formData: FormData
): Promise<LanguageFormState> {
  // Signed in, even though this writes nothing sensitive: an unauthenticated
  // endpoint that sets a cookie is a small door, and there is no reason to
  // leave one open.
  await requireActor();

  const requested = String(formData.get("locale") ?? "");
  if (!isSupportedLocale(requested)) {
    return { error: "unsupported" };
  }

  const store = await cookies();
  store.set(LOCALE_COOKIE, requested, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });

  // Every page's strings change, so the whole tree is stale.
  revalidatePath("/", "layout");
  return { saved: true };
}
