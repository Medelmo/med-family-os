import {
  Archivo,
  Big_Shoulders,
  Chakra_Petch,
  Fraunces,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Karla,
  Manrope,
  Newsreader,
  Nunito_Sans,
  Public_Sans,
  Sora,
  Source_Sans_3,
  Source_Serif_4,
  Work_Sans,
} from "next/font/google";

/**
 * Every type family the ten design worlds draw on (ADR-026, ADR-029),
 * self-hosted rather than linked — ADR-026 §6: a self-hosted household
 * application should not fetch a stylesheet from Google on every cold
 * load, and should keep working with the house's internet down.
 * `next/font` downloads each file once at build time and serves it from
 * this origin.
 *
 * All seventeen `--font-*` variables below are present on `<html>`
 * regardless of which world is active, but a browser does not fetch a
 * `@font-face` source until something rendered on the page is actually set
 * in it — so a world's fonts are lazily fetched exactly once, the first
 * time that world is chosen, never before.
 */
export const chakra = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Paper & Ink
export const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-source-serif",
  display: "swap",
});

export const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source-sans",
  display: "swap",
});

// Bento Bright
export const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

// Terminal Zero
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Aurora Glass
export const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-sora",
  display: "swap",
});

export const workSans = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-work-sans",
  display: "swap",
});

// Clinical Calm
export const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

// Kraft & Type. Google no longer ships "Big Shoulders Display" as its own
// family — it is the `opsz` (optical size) axis of the variable Big
// Shoulders family. `axes` can only be requested alongside `weight:
// "variable"`, which next/font's static-generation pipeline doesn't fit
// (fixed weights everywhere else), so this uses the default optical size
// at the two heaviest static weights instead.
export const bigShoulders = Big_Shoulders({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-big-shoulders",
  display: "swap",
});

export const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

// Slate Ops
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

// Atlas Light
export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

export const karla = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-karla",
  display: "swap",
});

// Midnight Ledger
export const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-newsreader",
  display: "swap",
});

export const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-nunito-sans",
  display: "swap",
});

const allFonts = [
  chakra,
  plexSans,
  plexMono,
  sourceSerif,
  sourceSans,
  manrope,
  jetbrainsMono,
  sora,
  workSans,
  publicSans,
  bigShoulders,
  archivo,
  inter,
  fraunces,
  karla,
  newsreader,
  nunitoSans,
];

export const fontVariables = allFonts.map((font) => font.variable).join(" ");
