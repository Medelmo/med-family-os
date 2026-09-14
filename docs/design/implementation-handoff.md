# Design-to-Code Handoff

## Primary shell

Desktop:
- left sidebar 248px
- top bar 64px
- content max-width 1440px
- 24px outer padding
- primary content column + optional context rail

Mobile:
- top bar 56px
- bottom nav 64px
- drawers instead of side panels
- sticky primary action where needed

### Which destinations go where

The sidebar carries every destination. The bottom bar carries four plus
`More`, and that count is fixed — a bar that grows with the app is how the
nav ended up overflowing a 375px viewport once there were eight links.

The four are the ones that answer "what needs my attention?", which
`docs/requirements/product-spec.md` names as the reason the app exists:
**Today, Inbox, Attention, Notifications**. Everything else is a reference
view you open when you already know what you are looking for, so it lives
on `/more`: Tasks, Cases, Calendar, Family, and whatever later phases add.

Rules that follow from this:

- The split lives in `components/app-shell/navItems.ts` and nowhere else,
  so the sidebar, the bottom bar and `/more` cannot disagree.
- A new destination defaults to `primary: false`. Promoting one means
  demoting another.
- A bottom-bar label that does not fit one line at 375px gets an explicit
  `shortLabelKey` rather than being left to wrap — "Notifications" and its
  German "Mitteilungen" both wrapped and then clipped against the 64px
  bar, so they render as "Alerts"/"Meldungen" there.
- `/more` is a page, not a sheet: no JavaScript, linkable, and it survives
  the layout being resized past the breakpoint.
- Which layout applies is a CSS media query, never a server-side user-agent
  guess, so resizing a window stays correct.

## Dashboard layout

1. Header: greeting + global search + quick capture
2. Attention strip: critical/overdue
3. Today column
4. Deadlines column
5. Waiting/follow-up
6. Family events
7. Upcoming trip
8. Recent activity

## Detail pages

Use a consistent structure:
- breadcrumb
- title + state + priority
- primary next action
- metadata
- contextual tabs
- timeline
- linked records
- audit/history

## Mobile

Never horizontally scroll primary content.

Tables become:
- stacked cards
- compact key/value rows
- filter drawer

Do not shrink desktop tables until text is unreadable.
