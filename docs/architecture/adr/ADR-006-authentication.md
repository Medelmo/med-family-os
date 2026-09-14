# ADR-006 Authentication: Auth.js with Credentials provider, JWT sessions, explicit revocation table

Status: Accepted (revised — see "Correction" below)

## Decision
Use Auth.js (`next-auth` v5) with the Credentials provider and Argon2id
password hashing (`@node-rs/argon2`). No Auth.js Adapter is configured; the
`users` table is queried directly in `authorize()`. Sessions use Auth.js's
**JWT strategy** (its own mature, signed/encrypted JWE — not hand-rolled),
with an explicit `session_revocation` table checked on every request so
sessions remain revocable despite being JWT-based.

## Correction
This ADR originally specified database-backed sessions via
`@auth/drizzle-adapter`. Before writing the implementation, `@auth/core`'s
source (`lib/utils/assert.js`, installed at
`node_modules/@auth/core/lib/utils/assert.js`) was read to confirm the
adapter's exact contract, and it explicitly rejects that combination:

```js
const dbStrategy = options.session?.strategy === "database";
const onlyCredentials = !options.providers.some(p => p.type !== "credentials");
if (dbStrategy && onlyCredentials) {
  return new UnsupportedStrategy("Signing in with credentials only supported if JWT strategy is enabled");
}
```

A Credentials-only configuration (no OAuth/email provider) cannot use
`session: { strategy: "database" }` — Auth.js throws `UnsupportedStrategy`
at startup. This is a hard library constraint, not a preference, so the
original decision was revised rather than worked around. Recorded here
instead of silently editing the "Decision" section so the reasoning stays
visible: **read the actual library source for a hard API constraint before
committing to an architecture that depends on it** applies to every future
ADR involving a specific library's behavior, not just this one.

## Context
CLAUDE.md and the security model require a mature authentication solution;
password hashing and session protocols must not be hand-rolled. The scaffold
declared `AUTH_SECRET` in `.env.example` but pinned no auth dependency in
`package.json` — this was an unresolved decision, not an implementation gap.

OAuth/social login is unnecessary for a private single-household deployment
with no external identity provider; Credentials is sufficient and keeps the
attack surface small — but choosing Credentials-only is exactly what forces
JWT strategy per the constraint above.

Revocability (lost phone, departing household member) is still required
(`docs/security/security-model.md`). Since Auth.js won't give it to us via
adapter-backed database sessions here, it is implemented explicitly:
- On sign-in, the `jwt` callback mints a random session ID (`sid`) and
  writes a row to `session_revocation` (`id`, `userId`, `createdAt`,
  `lastUsedAt`, `revokedAt`).
- On every subsequent request, the `jwt` callback checks that row; if
  `revokedAt` is set (or the row is gone), the token is invalidated.
- "Sign out everywhere" / admin-initiated revocation is: set `revokedAt` on
  the relevant `session_revocation` row(s). No JWT decryption/parsing is
  involved in revocation — only a plain row update.

This is a standard, documented pattern for revocable JWT sessions in
Auth.js (a server-side denylist consulted in the `jwt` callback); it does
not require implementing any cryptography — Auth.js still performs all
JWE signing/encryption/rotation.

## Consequences
- Add `next-auth@5.0.0-beta.32`, `@node-rs/argon2` to `package.json` in
  Phase 1. `@auth/drizzle-adapter` is **not** used (no adapter is
  configured) and should not be re-added without revisiting this ADR.
- `db/schema/auth.ts` defines `users` (with `passwordHash`) and
  `sessionRevocations` only — no `accounts`/`sessions`/`verificationTokens`
  adapter tables, since nothing consumes them without an adapter.
- Sign-out-everywhere and session listing (screen inventory item 9,
  Audit/security activity) query `session_revocation`, not an Auth.js
  adapter session table.
- Rate limiting (ADR-009) applies to the credentials sign-in route.
- If a future phase adds an OAuth provider alongside Credentials, database
  strategy becomes available again (the `onlyCredentials` guard no longer
  applies) — revisit whether to migrate to adapter-backed sessions at that
  point instead of carrying both mechanisms.
