# ADR-028: The supplied robot face, integrated rather than reinterpreted

**Status:** Accepted
**Date:** 2026-09-15
**Phase:** Design — the assistant's visual identity

Supersedes the hand-drawn `Android` figure introduced by ADR-026, which is
deleted. ADR-026 otherwise stands: the Holographic HUD, the tokens, the
spoken German greeting and the welcome moment are unchanged.

## Context

ADR-026 shipped an assistant drawn as an SVG figure in this repository —
plates, traces, a pulsing core, two eyes that blinked. It was ours, it
matched the tokens, and it was line art.

The household then supplied `ai-family-robot-face.zip`: a rendered
photographic character (the "Cyber Guardian"), an SVG overlay calibrated
against it, an eighteen-state parameter table, and integration notes. The
brief accompanying it was unusually specific, and twice over:

> Do NOT redesign, simplify, replace, or reinterpret the robot face. Do NOT
> create another SVG/illustration from scratch.

The package's own notes say the same thing from the other side: *"Do not
redraw this character with CSS/SVG from scratch."*

This is a real constraint and not a stylistic preference. The overlay's
every coordinate — eyes at `cx` 590 and 946, `cy` 606, the mouth mask at
`x` 540 — is calibrated against that specific artwork. Redrawing the
character invalidates all of it, and the result is a glow on a cheekbone.

## Decision

### 1. The artwork and the geometry are copied, not re-derived

`public/assets/robot-guardian.png` is the supplied file. The SVG overlay in
`components/ai-face/RobotFace.tsx` reproduces the package's paths and
ellipses unchanged, in the package's own `0 0 1536 1536` viewBox. The
eighteen state configurations in `robotStates.ts` carry the package's
numeric parameters verbatim.

Three things were adapted, each for a reason local to this application:

- **Global CSS became a CSS Module.** ADR-011 forbids global class names.
  Values are the package's; only the selectors moved.
- **SVG filter ids were namespaced** (`mfosCyanGlow`, `mfosSoftGlow`).
  Filter ids are document-global, and a second SVG on the page defining
  `cyanGlow` would silently change the face.
- **The plate is pinned dark in both themes** (`--face-plate: #020407`).
  The artwork is a feathered cutout and every overlay fill is near-black,
  all authored against a near-black ground. Composited over the light
  theme's `--color-bg-deep` the character becomes grey smoke and the mouth
  mask reads as a bar laid across the face. It carries its own ground, as a
  photograph does.

### 2. One controller, held in one place

`AIFaceProvider` owns mode, state and the speech flags. `useAIFace()` is
the only way to change them. The brief asks that animation logic not be
scattered through unrelated screens; this makes that structural rather than
a convention — there is nowhere else to put it.

Three modes, arbitrated in `resolveDisplayState`:

- `fixed` — exactly the state given, until told otherwise. Nothing
  overrides it, not even speech.
- `random` — an ambient walk, each state scheduling the next with its own
  duration so the changes do not land on a grid.
- `auto` — a priority ladder: `error`/`alert` → speaking → listening →
  thinking → the explicit state. The explicit state is the floor, not the
  ceiling, so an application that set `celebrating` keeps it until
  something genuinely more urgent is true.

### 3. Random mode cannot select a state that reads as status

The package shipped `alert` and `error` in its random pool. Its own notes
explain why that is wrong: *"Never use random mode to communicate errors,
deadlines, or other important information because it can select an
emotionally misleading state."*

This is the one place the package's data was changed. `sad`, `angry` and
`worried` are out for the same reason at lower intensity — beside a list of
a household's deadlines, they read as a reaction to the content. The
default pool is the seven ambient states, and a test asserts the absence.

### 4. The face reflects rows that already exist

On Today the state comes from the day's own query — items past their date
give `alert`, an occupied day gives `focused`, a clear one gives `happy`.
On the welcome screen it follows `speech.status`. No event bus was invented
to feed it, because the brief asked that none be: *"Do not invent
application events that do not exist."*

Today deliberately does not use random mode, for the reason in §3.

### 5. No caption beside it, and no new dependency

An early version put a sentence next to the face restating the day. A
Playwright run caught it sitting directly above the page's own empty state
saying the same thing twice. It was redundant by construction: every item
the face reacts to is listed below it with its date, so the face is an
ambient cue with an accessible name, not a sole carrier of meaning. That is
what WCAG 1.4.1 asks for, and the `aria-label` provides the rest.

Rive was considered and rejected — the brief says not to adopt it merely to
adopt it, and an SVG overlay driven by `requestAnimationFrame` already does
what the eighteen states need. `next/image` was likewise rejected for the
artwork: it needs `sharp` in the container to optimise three static files
whose sizes are known at build time. Plain `srcset` with pre-generated
384/768/1254 variants does the same work for nothing.

## Consequences

- The character can be replaced by a Rive runtime later without touching a
  caller: the state names, the three modes and `useAIFace()` are the
  contract, and the package's notes ask for exactly that stability.
- The 2.5 MB original is only fetched where it is actually displayed large.
  Today's 108px placement fetches 0.37 MB.
- Nothing animates under `prefers-reduced-motion` or while the tab is
  hidden. The face keeps its state, its glow and its expression, and holds
  still — reduced, not removed.
- `components/assistant/Android.tsx` and its stylesheet are deleted, and
  `welcome.androidLabel` with them. `useSpeech` and `voicePreference` from
  ADR-026 are unchanged and still in use.
