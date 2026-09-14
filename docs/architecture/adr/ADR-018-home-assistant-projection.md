# ADR-018: The Home Assistant projection carries no free text

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations), Home Assistant

## Context

CLAUDE.md §10 defines the Home Assistant surface precisely. It permits
`GET /api/ha/summary` and a `/ha` page containing:

> overdue count, critical items, waiting items, today, next deadlines,
> family events, upcoming trip

and forbids:

> passwords, secrets, health details, children's sensitive data, document
> contents, detailed financial transactions

with "a narrowly scoped read-only credential" and no database access.

`docs/integrations/home-assistant.md` adds that Home Assistant is a
presentation layer, embedded via a Webpage card, and that browser security
may prevent embedding — "do not weaken security globally".

## Decision

### 1. The projection is narrower than §10 allows: counts and dates only

No titles. No names. No destinations. No amounts. No free text of any kind.

The reason is that §10's ban cannot otherwise be enforced. **Every title in
this application is user-authored.** A household that writes "Lukas —
oncology follow-up" as a task title, or names a case "Benefits appeal for
Ada", has no way to know that string will later be rendered on a tablet in
the hallway where visitors, carers and the children themselves can read
it. There is no classifier that can reliably decide whether a free-text
field contains a health detail, and a rule that depends on one would fail
quietly and in exactly the cases that matter most.

So the surface is structurally incapable of carrying the thing §10
forbids: `HouseholdGlance` contains integers and date strings, and an
integration test asserts that every value in it is a number, a date-shaped
string, or null — with several deliberately sensitive records in the
database at the time.

The household loses some glanceability and gains a guarantee. The board
links into the real app for anyone who is actually signed in.

### 2. Counts include sensitive items

A count carries no content. "Three things need attention" reveals nothing
about what they are, and a badge that quietly under-reported because two of
them were medical would defeat the point of having a badge.

This is the line: **aggregate over everything, disclose nothing.**

### 3. Two different doors, authenticated two different ways

- **`GET /api/ha/summary`** — for a machine. A scoped bearer token in an
  `Authorization` header, compared in constant time, refusing tokens
  shorter than 32 characters, and **failing closed when unconfigured**: an
  unset token disables the endpoint (503) rather than opening it.
- **`/ha`** — for a tablet. An ordinary session.

The tempting third option — a token in the dashboard card's URL — is
refused. A secret in a URL ends up in the reverse proxy's access log, the
browser's history and every screenshot of the dashboard, which is how a
"read-only" credential stops being confined to the people who were meant
to have it. `bearerTokenFrom` reads the header only, and a test asserts it
never reads a query parameter.

The endpoint is in the proxy's public-route list, because a machine asking
for JSON should not be answered with a 307 to an HTML sign-in page. That
makes the token check the *only* thing in front of it, which is why that
file is short and does nothing else.

### 4. It answers for the household, singular

CLAUDE.md §0 says this app is for one household. A token that could be
pointed at a household id would be an enumeration surface for no benefit.
If a deployment somehow has more than one, the endpoint returns 409 rather
than guessing which one the wall tablet meant.

### 5. Today's event count reuses the calendar's own expansion

`countEventsToday` calls the same pure `expandOccurrences` the calendar
page uses. A second expansion written for this endpoint could drift, and a
recurring event that counted differently on the wall tablet than in the
app would be worse than not showing it at all.

## Consequences

- `/ha` sits outside the `(app)` route group: no sidebar, no bottom bar,
  no sign-out button. A dashboard card is a few hundred pixels of glance,
  and navigation chrome inside it is wasted space nobody can use from
  across the room. It is deliberately **not** in the app's navigation
  either — it is a target for an embed, not a destination people browse
  to.
- The board stamps when it was computed. A tablet that stopped refreshing
  at 3am otherwise looks identical to one that is up to date.
- `.env.example` now states the 32-character minimum and how to generate a
  token. The previous placeholder was shorter than the code accepts, which
  would have produced a 503 that looked like a bug rather than the refusal
  it is.
- Embedding may still be blocked by the browser: the app's CSP does not
  set `frame-ancestors` to permit Home Assistant's origin, and
  `docs/integrations/home-assistant.md` is explicit that security must not
  be weakened globally to fix that. Permitting one known origin is a
  deliberate, per-deployment decision and is **not** made here.
- Rate limiting is not applied to this endpoint. The token is the control,
  and the surface is a LAN. Worth revisiting if the app is ever exposed
  beyond one.
