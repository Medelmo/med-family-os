import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

/**
 * The three type roles from tokens.css, self-hosted by next/font.
 *
 * Self-hosted rather than linked: this is an application a household runs
 * on their own machine, and a stylesheet fetched from fonts.googleapis.com
 * on every cold load is both a request to a third party on every page view
 * and a dependency on the house having internet at all. `next/font`
 * downloads the files at build time and serves them from the same origin,
 * which also removes the layout shift a late webfont causes.
 */
const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Med Family OS",
  description: "Private, self-hosted household operating system.",
};

/**
 * `themeColor` matches the application ground, so the phone's own status
 * bar continues the interface instead of capping it with a white strip.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#04070c" },
    { media: "(prefers-color-scheme: light)", color: "#eef4f8" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${chakra.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
