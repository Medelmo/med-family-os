# Home Assistant

Home Assistant is a presentation layer.

Use the Webpage card/dashboard to embed `/ha` where appropriate. Browser security can prevent embedding; do not weaken security globally.

Recommended:
- same trusted local HTTPS origin if possible
- read-only scoped token
- minimal projection
- links back to the full app for authorized users

Never expose database credentials.
