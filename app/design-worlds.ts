/**
 * The registry ADR-029 promises: one table of truth for which design
 * worlds exist, read by the cookie validator, the `<html data-design>`
 * attribute, `generateViewport`'s status-bar colour, and the settings
 * picker's swatches. Nothing here is a component — see `design-worlds.css`
 * for the actual token values each id selects.
 */

export const DESIGN_IDS = [
  "hud",
  "paper",
  "bento",
  "terminal",
  "aurora",
  "clinical",
  "kraft",
  "slate",
  "atlas",
  "ledger",
] as const;

export type DesignId = (typeof DESIGN_IDS)[number];

// The Holographic HUD (ADR-026) — no CSS rule exists for this id; it is
// simply what tokens.css's bare `:root` already renders. See ADR-029 §1.
export const DEFAULT_DESIGN: DesignId = "hud";

// A per-browser preference, not a household setting — ADR-029 §3, mirroring
// `LOCALE_COOKIE` in i18n/request.ts. No security meaning: readable by
// client code so the picker can show the current choice.
export const DESIGN_COOKIE = "med-family-os-design";

export function isSupportedDesign(value: string | undefined | null): value is DesignId {
  return !!value && (DESIGN_IDS as readonly string[]).includes(value);
}

export interface DesignWorld {
  id: DesignId;
  /** Suffix appended to "design" for this world's translation keys. */
  nameKey: string;
  descriptionKey: string;
  /** Four representative hex values, background first, for the picker. */
  swatches: readonly [string, string, string, string];
  /**
   * "auto" answers `prefers-color-scheme` the way the HUD always has;
   * a sealed world instead names its one fixed appearance and status-bar
   * colour (ADR-029 §2, §4).
   */
  appearance: "auto" | "light" | "dark";
  themeColor: string;
}

export const DESIGN_WORLDS: readonly DesignWorld[] = [
  {
    id: "hud",
    nameKey: "designHud",
    descriptionKey: "designHudHint",
    swatches: ["#05080d", "#5ee7ff", "#7c8bff", "#dceff7"],
    appearance: "auto",
    themeColor: "#04070c",
  },
  {
    id: "paper",
    nameKey: "designPaper",
    descriptionKey: "designPaperHint",
    swatches: ["#efeee8", "#1b2430", "#2c4a7c", "#7c5a3a"],
    appearance: "light",
    themeColor: "#efeee8",
  },
  {
    id: "bento",
    nameKey: "designBento",
    descriptionKey: "designBentoHint",
    swatches: ["#fbfaf7", "#6c5ce7", "#2fae8b", "#23262b"],
    appearance: "light",
    themeColor: "#fbfaf7",
  },
  {
    id: "terminal",
    nameKey: "designTerminal",
    descriptionKey: "designTerminalHint",
    swatches: ["#0a0a09", "#e0a23d", "#e9e4d6", "#2a2620"],
    appearance: "dark",
    themeColor: "#0a0a09",
  },
  {
    id: "aurora",
    nameKey: "designAurora",
    descriptionKey: "designAuroraHint",
    swatches: ["#0c0a14", "#4fd8c4", "#c07bff", "#f1eefa"],
    appearance: "dark",
    themeColor: "#0c0a14",
  },
  {
    id: "clinical",
    nameKey: "designClinical",
    descriptionKey: "designClinicalHint",
    swatches: ["#f4f7f8", "#0e7c86", "#2e9e6d", "#10262e"],
    appearance: "light",
    themeColor: "#f4f7f8",
  },
  {
    id: "kraft",
    nameKey: "designKraft",
    descriptionKey: "designKraftHint",
    swatches: ["#fff7e6", "#2c6bd9", "#e8503a", "#f2b705"],
    appearance: "light",
    themeColor: "#fff7e6",
  },
  {
    id: "slate",
    nameKey: "designSlate",
    descriptionKey: "designSlateHint",
    swatches: ["#101114", "#6e7bff", "#33c481", "#e7e8ea"],
    appearance: "dark",
    themeColor: "#101114",
  },
  {
    id: "atlas",
    nameKey: "designAtlas",
    descriptionKey: "designAtlasHint",
    swatches: ["#f7f4ec", "#b8894a", "#3e6e68", "#1f3a3d"],
    appearance: "light",
    themeColor: "#f7f4ec",
  },
  {
    id: "ledger",
    nameKey: "designLedger",
    descriptionKey: "designLedgerHint",
    swatches: ["#0e0b08", "#c9a24b", "#ede6d8", "#8a9a8f"],
    appearance: "dark",
    themeColor: "#0e0b08",
  },
] as const;

export function designWorld(id: DesignId): DesignWorld {
  return DESIGN_WORLDS.find((world) => world.id === id) ?? DESIGN_WORLDS[0];
}
