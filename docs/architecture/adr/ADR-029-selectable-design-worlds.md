# ADR-029: Selectable design worlds

**Status:** Accepted
**Date:** 2026-09-19
**Phase:** Design — applies across every screen

Extends ADR-026, which it does not replace: the Holographic HUD stays
exactly as it is, and becomes one of ten choices rather than the only one.

## Context

Five visual worlds were built as working comparisons before ADR-026 was
decided; ten more were built afterwards, as a second round, to check
whether the household still preferred the HUD once it had lived with it —
or wanted something else on a bright kitchen tablet, at 9pm doing admin,
or for a child's corkboard view. The answer was not "pick one": the
household asked to keep all ten, switchable per person, applied instantly.

That request is only answerable cheaply because of a decision ADR-026
already made and proved: *"Every custom property that existed before still
exists... nothing in the application reads a colour literal, so replacing
the palette replaced the design."* A second, third, or tenth palette
replaces it again, by the same mechanism, for the same reason.

## Decision

### 1. A world is a value substitution, not a new mechanism

Nine new blocks in `app/design-worlds.css`, each selected by
`[data-design="<id>"]` on the root element, redefine the exact custom
properties ADR-026 named — `--color-bg`, `--color-surface`, `--color-info`,
`--glow-rim`, `--radius-lg`, `--font-display`, and the rest. No component
stylesheet changes. This was verified before writing a single new rule: a
repo-wide search found exactly two hex literals outside `tokens.css` — the
`<meta name="theme-color">` value in `layout.tsx` (now generated from the
same registry, §4) and `RobotFace.module.css`'s pinned plate colour, which
ADR-028 already fixes deliberately in every theme and is explicitly out of
scope for the same reason (§5). Every panel, button, badge and chip in the
application was already drawing from tokens; a tenth palette is as cheap
as the second one was.

The Holographic HUD is not reproduced as a `[data-design="hud"]` block.
It **is** the bare `:root` / `[data-theme]` rules already in
`tokens.css` — `hud` is the id used for the cookie and the picker, but no
new CSS rule exists for it, which is what guarantees the default
appearance is provably unchanged rather than merely intended to be.

### 2. Ten worlds, nine of them sealed to one appearance

| id | Name | Appearance | Signature move |
|---|---|---|---|
| `hud` | Holographic HUD | auto (light + dark) | unchanged from ADR-026 |
| `paper` | Paper & Ink | light only | broadsheet ledger, double-ruled rows |
| `bento` | Bento Bright | light only | soft bento tiles, pastel category tint |
| `terminal` | Terminal Zero | dark only | phosphor-amber table, zero chrome |
| `aurora` | Aurora Glass | dark only | one restrained bloom, translucent glass |
| `clinical` | Clinical Calm | light only | patient-portal legibility, left colour bar |
| `kraft` | Kraft & Type | light only | flat felt-tip colour, hard offset shadow |
| `slate` | Slate Ops | dark only | dense, undramatic, Linear-grade dark |
| `atlas` | Atlas Light | light only | waypoint line borrowed from Trips |
| `ledger` | Midnight Ledger | dark only | right-aligned rows, gold on umber |

ADR-026's own alternatives-considered section rejected a single-theme
commitment: *"somebody reading medical paperwork in a bright kitchen needs
a screen they can see."* That reasoning does not disappear here — it is
answered differently now that there are ten choices instead of one. A
household that wants a bright, outdoor-readable mode and a moody, low-glare
one at night gets both by picking two worlds (Clinical Calm by day, Slate
Ops after the kids are down), rather than by asking each of nine new,
smaller worlds to carry a second full theme nobody asked *that specific
world* to have. The Holographic HUD alone keeps its original light/dark
duality, unchanged, because it is the one world built to be the
household's everyday default in both conditions. This is recorded as a
deliberate scope line, not an oversight — see Alternatives.

### 3. A world is a per-browser preference, exactly like language

`med-family-os-design`, a cookie, following ADR-008/026's
`med-family-os-locale` pattern for the identical reason stated there: the
same person may want Terminal Zero on a personal laptop and Bento Bright
on the kitchen tablet, and a column on the user record would fight them
for it. `httpOnly: false` for the same reason the locale cookie is: the
value is a ten-item enum with no security meaning, and the picker reads it
back to show what is currently selected.

Applied server-side, in `RootLayout`, from the cookie — not a
blocking client script. Locale already reads a cookie in the same
component; the same read adds `data-design` to the same `<html>` tag,
so there is no flash of the previous world on load, and no new
client-side theming runtime.

### 4. `generateViewport` replaces the static `viewport` export

The phone status bar colour has to match whichever world is active. Next.js
can only do that from a function that reads the request, so the previously
static `export const viewport` became `export async function
generateViewport()`, reading the same cookie. The Holographic HUD keeps
its two-media-query answer (dark bar in dark mode, light bar in light
mode); every sealed world returns its own single, fixed colour, taken from
the same `DESIGN_WORLDS` registry the picker UI reads its swatches from —
one table of truth, not two hand-kept lists.

### 5. Fourteen more type families, self-hosted, loaded lazily by use

`app/fonts.ts` adds `next/font/google` instances for Source Serif 4, Source
Sans 3, Manrope, JetBrains Mono, Sora, Work Sans, Public Sans, Big
Shoulders Display, Archivo, Inter, Fraunces, Karla, Newsreader and Nunito
Sans, for the same reason ADR-026 §6 gives for the original three:
self-hosted, so a stylesheet is never fetched from Google on a cold load
and the app keeps working with the house's internet down. All seventeen
families' CSS variables are present on `<html>` regardless of which world
is active, but a browser does not fetch a `@font-face` source until
something on the rendered page is actually set in it — so a household that
never opens the switcher never downloads the other nine worlds' type, and
opening Kraft & Type once is the only thing that ever fetches Big
Shoulders Display.

### 6. What stays out of scope

- **`RobotFace` (ADR-028).** Pinned dark in every theme already, by design
  — a supplied, calibrated photographic asset, not a themed panel. It does
  not change across worlds for the same reason it does not change between
  light and dark today.
- **Bespoke background art per world** (the aurora's multiple gradient
  blobs, the atlas route-line, the neubrutalist hard-offset shadow drawn as
  a second box-shadow layer with a wider spread). The comparison artifact
  this ADR follows from was free to add page-specific structural CSS per
  concept; shipped code is not, because that would mean nine new pieces of
  component-level CSS instead of nine rows of token values, multiplying the
  regression surface `data-design` was chosen specifically to avoid. Each
  world's identity is carried entirely by colour, the `--glow-*` /
  `--radius-*` shadow-and-corner recipe, and type — which is already enough
  signal to tell them apart at a glance, as the accessibility suite below
  confirms by contrast, not by eye.

## Consequences

- `app/design-worlds.ts` is the single registry — ids, the cookie name, the
  validator, and the swatch/theme-colour metadata the picker and
  `generateViewport` both read. Adding an eleventh world later is one
  block in `design-worlds.css`, one row in this table, and zero component
  changes, exactly as ADR-026 predicted for itself.
- `/settings/appearance` is open to every role, like `/settings/language`
  and for the same reason: which visual world you read the household's
  attention list in is not an administrative decision.
- The existing accessibility suite is extended rather than duplicated:
  the same axe pass that already runs against Today now runs once per
  world (ten runs, one cookie each), so a future world that fails contrast
  fails CI the same way a future locale with un-translated strings would.
- Choosing a world is instant and free to reverse — there is deliberately
  no "are you sure" step, because nothing it touches is destructive,
  sensitive, or shared beyond the browser that chose it.

## Alternatives considered

- **Every world gets its own light and dark pass.** Rejected for this
  round: it doubles the palette-authoring and contrast-verification work
  for a need already met by switching worlds instead of switching themes
  within one. Revisit if a specific sealed world turns out to be the
  household's actual daily default and the missing half becomes a real
  complaint rather than a hypothetical one.
- **A user-table column instead of a cookie.** Rejected for the same
  reason ADR-008 rejected it for locale: this is a property of the browser
  someone is sitting at.
- **Bespoke per-world component CSS**, to reproduce the comparison
  artifact's structural flourishes exactly (route-lines, hard-offset
  double shadows, right-aligned ledger rows). Rejected for this round as
  disproportionate to the token-only mechanism that makes nine worlds as
  cheap as one; nothing here forecloses adding one later as its own small,
  reviewed change to a single world.
