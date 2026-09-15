import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

// ADR-008: next-intl without URL-based i18n routing. Locale is a per-user
// preference (a Settings toggle, per screen-inventory.md "Settings"), not a
// URL concern — nothing in this app's routes should encode language, so
// there is no app/[locale]/ segment.
export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";
export const LOCALE_COOKIE = "med-family-os-locale";

export function isSupportedLocale(value: string | undefined | null): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The best supported locale for an `Accept-Language` header.
 *
 * Added because the cookie had nothing to write it: ADR-008 noted "Phase 1
 * has no Settings UI yet", and the consequence was that a German household
 * got an English application with no way to say otherwise. Settings can now
 * write the cookie — and until somebody does, the browser's own stated
 * preference is a better guess than a hard-coded default.
 *
 * Parsed rather than matched loosely: `de-AT` and `de-CH` are German, and
 * quality values decide between competing entries. A header this app does
 * not understand at all falls through to the default rather than throwing.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isSupportedLocale(base)) return base;
  }

  return null;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale: SupportedLocale;

  if (isSupportedLocale(cookieLocale)) {
    // An explicit choice always wins.
    locale = cookieLocale;
  } else {
    const headerList = await headers();
    locale = localeFromAcceptLanguage(headerList.get("accept-language")) ?? DEFAULT_LOCALE;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
