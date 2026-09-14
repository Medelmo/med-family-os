import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// ADR-008: next-intl without URL-based i18n routing. Locale is a per-user
// preference (a Settings toggle, per screen-inventory.md "Settings"), not a
// URL concern — nothing in this app's routes should encode language, so
// there is no app/[locale]/ segment. Read from a cookie for now; Phase 1
// has no Settings UI yet to write it, so this always resolves to the
// default until that lands.
export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";
export const LOCALE_COOKIE = "med-family-os-locale";

function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
