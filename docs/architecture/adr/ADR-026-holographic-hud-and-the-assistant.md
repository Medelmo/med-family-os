# ADR-026: The Holographic HUD, and an assistant that greets you by name

**Status:** Accepted
**Date:** 2026-09-15
**Phase:** Design — applies across every screen

Replaces the visual language chosen in ADR-011, which it keeps the
mechanics of (CSS Modules, design tokens, no Tailwind) and none of the
appearance.

## Context

The household asked for an interface that is "modern, pretty and
futuristic", and for a welcome screen carrying a moving face in the manner
of a film AI — greeting them by name, aloud, in German.

The incumbent design was deliberately calm and neutral: grey surfaces,
system font stack, 10px radii, no gradients. Good engineering, and
visually anonymous. Five complete visual worlds were built as working
comparisons, each rendering the same two screens with a live animated
face; **Holographic HUD** was chosen.

## Decision

### 1. Token names are the contract; only the values changed

Every custom property that existed before still exists. That single
constraint is why twenty-five stylesheets across twenty-seven screens
inherited an entirely new visual world without being edited: nothing in
the application reads a colour literal, so replacing the palette replaced
the design.

New names were *added* — `--color-signal`, `--glow-rim`, `--track-label`,
`--dur-base`, and the rest — but nothing was renamed or removed.

### 2. Dark is now primary, and the light theme was rebuilt rather than inverted

The bare `:root` carries the dark palette; light is a deliberate
translation stamped by `[data-theme="light"]` and by a
`prefers-color-scheme: light` block for the un-stamped default.

Not an inversion, because an inversion would be unreadable: `#5ee7ff` on
white is 1.4:1. The light theme uses a deep teal of the same hue family at
5.3:1, glows become shadows, and the grid drops to a fifth of its opacity.
What carries across is the *structure* — the same hairlines, tracking,
tight radii and geometry.

### 3. The world is three layers, painted once

A fixed engineering grid, a signal bloom from the top edge, and a fixed
scanline overlay at 2.2% white on a 3px pitch — all on `body`, so every
panel in the application is a pane of lit glass floating over one
continuous ground rather than a card on a page. Panels are translucent
with a `backdrop-filter`, edged with a rim light instead of a grey border,
and lit along the top by a fading hairline.

`prefers-reduced-transparency` turns every translucent surface solid and
keeps everything else, because translucency over texture is genuinely hard
for some people to read.

### 4. Three type roles, and body copy is not the display face

Chakra Petch is the instrument face — squared terminals, narrow, legible
at the wide tracking a HUD label needs. It sets headings, buttons, labels
and navigation. **It does not set paragraphs.** A technical display face
at 14px in a sentence about a child's care is showing off at the reader's
expense, so IBM Plex Sans carries everything a person actually reads, and
IBM Plex Mono carries anything that lines up in a column.

All three are self-hosted through `next/font`: a self-hosted household
application should not fetch a stylesheet from Google on every cold load,
and should keep working with the house's internet down.

### 5. The assistant is a greeting and a status light, and says so

The android on the welcome screen has no intelligence behind it and no
access to anything. CLAUDE.md §11 keeps AI advisory and human-confirmed;
a face that looked like it was thinking about a household's medical
records while having no part in them would be a lie told in pixels. Its
chest core is the same mark that sits in the top bar, so "the system is
up" has one symbol across the application.

It is drawn as structured SVG rather than an image because every part that
moves has to move independently — each eyelid, each band of the vocal
grille, each live trace. The blink runs 93% of its cycle open with 50ms
between the two lids, because humans do not blink symmetrically and that
fraction is the difference between a face and two lights going off
together.

### 6. The voice is the browser's own engine

No audio files. Three reasons, all of which matter to a self-hosted
household application: there is no third party to call, it works offline,
and it can say a person's actual name — which a recording cannot, and
which is the entire point of "Willkommen Mohamed".

Two things reliably go wrong, and both are handled as first-class states
rather than silence:

- **Browsers refuse to speak before a page has been interacted with.** Not
  a bug to defeat — it is what stops every tab talking at you. Signing in
  *is* that interaction, which is why the welcome moment sits immediately
  after the login form and usually speaks on its own. Where it is still
  refused, the status is `blocked` and one button fixes it.
- **Voice lists load asynchronously and are empty on a cold start.** An
  empty list is a "not yet", with a retry on `voiceschanged` and a bounded
  1.5s wait, never a "this device has no voice".

### 7. The welcome screen is a moment, not a page

It says one thing and leaves: it continues on its own once the greeting
has been spoken, and can be left at any time with any key, any tap, or the
Continue button. It is reached only by signing in, so it is never
something anybody has to click past to get to work.

Three things run together and each works without the other two — the
android animates, the line types itself, the voice says it. A device with
no voice still shows the words. A browser blocking audio says so. A
request for reduced motion delivers the line whole, immediately, with the
android still and its mouth resting half-open rather than shut.

### 8. Motion is reduced, not removed

`prefers-reduced-motion` stills the grid, the atmosphere, the blink and
the float — and keeps all of them on screen. Somebody asking for less
motion is asking for things to stop moving, not for the interface to lose
half its meaning.

## Consequences

- **`ADR-008`'s missing half was built.** A per-user locale in a cookie
  with "no Settings UI yet to write it" meant the German half of a
  bilingual application was unreachable from inside it. There is now a
  language page open to every role — what language you read in is not an
  administrative decision — and an unset cookie negotiates from
  `Accept-Language`, so a German browser gets a German application without
  being asked.
- Sign-in and first-run now redirect to `/welcome` rather than `/`.
- Current page is marked by a lit rail in a *position* as well as a
  colour, so it survives a monochrome screen (WCAG 1.4.1). The same is
  true of every error and status in the redesign.
- All 215 existing E2E tests pass unchanged, including every axe check
  against the new palette — the contrast targets were designed to, not
  discovered afterwards.

## Alternatives considered

- **Keeping light as primary and adding a dark HUD.** Rejected: the world
  is built on emitted light, and deriving it from a paper default would
  have made every glow an afterthought.
- **A rendered image or video for the assistant.** Rejected: it could not
  blink on demand, could not react to the voice actually starting and
  stopping, and would not restyle with the theme.
- **Speaking through a cloud TTS service.** Rejected outright. Sending a
  household member's name to a third party to be pronounced is the exact
  shape of thing this application exists not to do.
- **A single-theme commitment.** Tempting, and rejected: somebody reading
  medical paperwork in a bright kitchen needs a screen they can see.
