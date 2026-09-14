# ADR-010 Structured logging: pino with a fixed redaction list

Status: Accepted

## Decision
Use `pino` for structured JSON logging, with a fixed `redact` path list
covering credentials, session tokens, and known-sensitive domain fields, and
a per-request correlation ID propagated via `AsyncLocalStorage`.

## Context
`docs/security/security-model.md` requires request correlation IDs, redacted
logs, and no secrets in logs; CLAUDE.md §20 requires structured logging with
health/latency/failure/retry/sync-state visibility per subsystem. No logging
library was previously chosen.

`pino` is used because its `redact` option is declarative (a list of JSON
paths, not per-call-site discipline), which is a meaningfully safer default
than "remember not to log the password field" scattered across the
codebase — a single misplaced `console.log(user)` cannot leak a hashed
password or session token if the field is redacted at the logger level.

## Consequences
- Add `pino` (and `pino-pretty` as a dev-only dependency) to `package.json`
  in Phase 1.
- The redaction list must be extended whenever a new sensitive field is
  added to the domain model (e.g. a new HIGHLY_SENSITIVE field) — this is a
  standing review item for every schema change, not a one-time setup.
- Never log full request/response bodies for routes that touch SENSITIVE or
  HIGHLY_SENSITIVE resources; log resource IDs and action outcomes instead.
- The correlation ID is attached in middleware and threaded through
  application-layer calls so a single household-reported bug can be traced
  across the request without exposing user-identifying data in the ID
  itself (use a random ID, not the user ID or email).
