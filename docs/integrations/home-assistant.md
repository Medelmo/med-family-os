# Home Assistant

Home Assistant is a presentation layer.

Use the Webpage card/dashboard to embed `/ha` where appropriate. Browser security can prevent embedding; do not weaken security globally.

Recommended:
- same trusted local HTTPS origin if possible
- read-only scoped token
- minimal projection
- links back to the full app for authorized users

Never expose database credentials.

## As built

`GET /api/ha/summary` and the `/ha` page are implemented. See ADR-018 for
the reasoning; the short version:

- **Counts and dates only, never free text.** Every title in this app is
  user-authored, so "no health details" cannot be enforced against one.
  The response is structurally incapable of carrying a title, a name, a
  destination or an amount, and a test asserts it with sensitive records
  in the database.
- **Counts span every item**, sensitive ones included. A count discloses
  nothing, and a badge that under-reported would be worse than none.
- **The endpoint takes a bearer token in a header**, minimum 32
  characters, compared in constant time, and is disabled entirely when no
  token is configured. Never a query parameter — that puts a secret in the
  proxy log, the browser history and every screenshot.
- **The page takes a session**, not a token, for the same reason.
- **Embedding may be blocked by the browser.** The CSP does not name Home
  Assistant's origin in `frame-ancestors`. Permitting one known origin is
  a per-deployment decision, taken deliberately, and is not made here —
  this document already says not to weaken security globally.

Response shape:

```json
{
  "generatedAt": "2026-09-14T18:46:02.826Z",
  "todayIso": "2026-09-14",
  "overdue": 2,
  "dueToday": 0,
  "critical": 0,
  "waiting": 4,
  "eventsToday": 0,
  "nextDeadlineOn": null,
  "nextTripStartsOn": "2027-03-10"
}
```
