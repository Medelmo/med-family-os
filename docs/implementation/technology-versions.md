# Technology Versions

Verified against official sources during architecture review.

| Technology | Decision |
|---|---|
| Next.js | 16.3.x line; pin exact latest secure patch during implementation |
| React | 19.2.x |
| PostgreSQL | 18.x; use current secure patch |
| TypeScript | verify exact current stable at implementation time |
| Playwright | verify exact current stable at implementation time |
| Node.js | use the current LTS compatible with selected Next.js version |
| Docker Compose | current Compose Specification |

Important: do not copy a stale patch number into production. Before `npm install`, query official release notes and pin current secure patch versions in `package.json`/lockfile.

Next.js 16.3 was announced in August 2026; PostgreSQL 18.6 is the current supported major release as of the review date.
