import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { DEFAULT_DESIGN, DESIGN_COOKIE, designWorld, isSupportedDesign } from "./design-worlds";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Med Family OS",
  description: "Private, self-hosted household operating system.",
};

/**
 * Reads the design-world cookie, falling back to the Holographic HUD
 * default — the one path `RootLayout` and `generateViewport` both need,
 * kept in one place so they cannot disagree (ADR-029 §3).
 */
async function activeDesign() {
  const store = await cookies();
  const value = store.get(DESIGN_COOKIE)?.value;
  return isSupportedDesign(value) ? value : DEFAULT_DESIGN;
}

/**
 * A function rather than a static export, so it can read the cookie: the
 * status bar has to match whichever world is active. The Holographic HUD
 * keeps its original two-media-query answer; every sealed world (ADR-029
 * §2) returns its own single, fixed colour from the same registry the
 * picker's swatches come from.
 */
export async function generateViewport(): Promise<Viewport> {
  const world = designWorld(await activeDesign());

  if (world.appearance === "auto") {
    return {
      themeColor: [
        { media: "(prefers-color-scheme: dark)", color: "#04070c" },
        { media: "(prefers-color-scheme: light)", color: "#eef4f8" },
      ],
    };
  }

  return { themeColor: world.themeColor };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const design = await activeDesign();

  return (
    <html lang={locale} data-design={design} className={fontVariables}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
