# ADR-011 Styling: CSS Modules + design-token CSS custom properties, no Tailwind

Status: Accepted

## Decision
Style components with plain CSS Modules (`*.module.css`, built into
Next.js, no extra dependency) plus a single `app/tokens.css` defining every
value from `docs/design/design-system.md` (spacing, radius, typography,
semantic colors) as CSS custom properties. No Tailwind, no CSS-in-JS
library.

## Context
`docs/design/design-system.md` specifies concrete tokens (spacing 4/8/12/…
/48, radius 6/10/14, a five-step type scale, five semantic colors) but does
not name a styling technology, and `package.json` had no styling dependency
declared. CLAUDE.md §14 ("Prefer simple architecture over premature
abstraction... do not add infrastructure merely for fashion") and §16
("do not add a dependency without documenting why it is needed") both argue
against reaching for Tailwind or a CSS-in-JS runtime by default.

CSS Modules are chosen over Tailwind specifically because the design system
is **token-driven, not utility-driven**: `docs/design/design-system.md`
defines a small, closed set of values (9 spacing steps, 3 radii, 5 colors),
which maps directly onto CSS custom properties and needs no utility-class
generation layer. Tailwind would add real value if the design vocabulary
were large/exploratory; here it would mostly reproduce the token file as
class names with an extra build step and an extra dependency to keep in
sync with `docs/design/design-system.md`.

CSS-in-JS (styled-components, vanilla-extract, etc.) is rejected for the
same "no infrastructure merely for fashion" reason — Next.js's built-in CSS
Modules support requires zero additional dependency and has zero runtime
cost, which matters for CLAUDE.md §26's "must remain responsive on older
mid-range Android devices" / low-power self-hosted deployment target.

## Consequences
- `app/tokens.css` is the single source of truth for token values; a
  component must reference `var(--space-4)` etc., never a hardcoded pixel
  value, so a `docs/design/design-system.md` token change is a one-file
  edit.
- Every new UI component in `components/ui/` ships as
  `ComponentName.tsx` + `ComponentName.module.css` side by side.
- Dark/light/system theme (CLAUDE.md §23) is implemented as an alternate
  custom-property set under a `[data-theme="dark"]` attribute selector and
  a `prefers-color-scheme` media query, not a second token file.
- If the component surface grows large enough that CSS Modules' lack of a
  shared utility vocabulary becomes a real velocity problem, revisit this
  ADR then, with the actual pain point in hand — not speculatively now.
