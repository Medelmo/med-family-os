# Architecture Audit — Med Family OS

Date: 2026-09-14
Scope: full repository as supplied (`CLAUDE.md`, `docs/**`, and the small set
of non-stub source files: `application/policies/authorize.ts`,
`domain/shared/types.ts`, `tests/security/authorization.spec.ts`,
`package.json`, `docker-compose.yml`, `Dockerfile`, `.env.example`,
`next.config.ts`, `tsconfig.json`).

This is the Phase 0 architecture-validation pass required by
`docs/implementation/roadmap.md` ("Phase 0 — Architecture package only") and
CLAUDE.md §19/§23. It supersedes `docs/research/deep-audit.md` as the
current source of truth — that document is retained for history but its
findings are folded into this one, cross-referenced, and in most cases
already resolved during this pass (see "Fixed during this pass" below).

Every `app/`, `application/`, `domain/`, `features/`, `infrastructure/`,
`integrations/`, `components/`, `db/`, `tests/` directory except the four
files named above contains only a `.gitkeep` placeholder. **This repository
currently has no working Next.js application, no database schema, and no
installed dependencies.** That is expected for a Phase 0 architecture
package and is not itself a finding — it is the starting condition for every
finding below.

---

## Fixed during this pass

These were concrete, well-contained defects rather than open design
questions, so they were corrected directly instead of only being logged:

1. **`application/policies/authorize.ts` — fail-open authorization (Critical).**
   `canAccess` had no action check for `VIEWER` (a read-only role per
   `docs/permissions.md`) and treated an unscoped `HOUSEHOLD`/`NORMAL`
   resource as open to `CHILD`, contradicting CLAUDE.md §5 ("Children
   default to highly restricted access and never inherit adult access").
   Fixed to fail closed: `VIEWER` is read-only everywhere; `CHILD` requires
   explicit scoping (`ownerUserId`, `allowedUserIds`, or `personScopeIds`)
   for every action, including read. Regression tests added in
   `tests/security/authorization.spec.ts` covering both bugs plus the
   BOLA/cross-household, PRIVATE-visibility, and allow-list cases named in
   `docs/security/threat-model.md`.
2. **`.env.example` / `docker-compose.yml` — undeployable as shipped (High).**
   `docker-compose.yml` requires `POSTGRES_PASSWORD` (`${POSTGRES_PASSWORD:?set in .env}`)
   but `.env.example` never declared it, and `DATABASE_URL`'s embedded
   password had no guaranteed relationship to it. `docker compose up` would
   fail on a fresh checkout. Fixed: `.env.example` now declares
   `POSTGRES_PASSWORD` and keeps it textually in sync with `DATABASE_URL`,
   with a comment explaining why they must match.
3. **`tsc --noEmit` failed out of the box (High).** Installing dependencies
   and running the typecheck script that `package.json` already declares
   (`pnpm typecheck`) surfaced seven real compiler errors, all from
   `next@16.3.5`'s bundled type declarations referencing a global
   `URLPattern` (and `URLPatternInput`/`URLPatternOptions`) that neither
   TypeScript 5.9.3's bundled `lib.dom.d.ts` nor `@types/node@22.20.2`
   declare yet — a version-skew gap between these three pinned dependencies,
   not a mistake in this repository's own code. Fixed with a minimal ambient
   declaration shim at `types/url-pattern.d.ts` (documented as a stopgap to
   delete once the upstream packages catch up). Verified: `tsc --noEmit`
   now exits 0.
4. **Five undecided infrastructure choices (High), resolved as ADRs.**
   The scaffold *named* requirements (mature auth, i18n from day one, rate
   limiting, structured/redacted logging) without picking a library, and the
   Case state machine existed in two irreconcilable shapes (the repo's own
   7-state model vs. a simpler 5-state description that appears in generic
   prompt material outside this repository). Each is now a decision, not an
   open question:
   - [ADR-006](../architecture/adr/ADR-006-authentication.md) — Auth.js v5, Credentials provider, Argon2id, database sessions.
   - [ADR-007](../architecture/adr/ADR-007-case-state-machine.md) — retain the 7-state Case model (`docs/domain/state-machines.md`) with WAITING/BLOCKED kept distinct.
   - [ADR-008](../architecture/adr/ADR-008-i18n.md) — `next-intl`.
   - [ADR-009](../architecture/adr/ADR-009-rate-limiting.md) — `rate-limiter-flexible` on Postgres, no Redis.
   - [ADR-010](../architecture/adr/ADR-010-logging.md) — `pino` with a declarative redaction list.

---

## 1. Current architecture

Modular monolith (ADR-001): Next.js App Router (UI + route handlers/server
actions) → application layer (commands/queries/policies) → ports →
PostgreSQL adapter, notification adapter, Paperless/Nextcloud/Calendar/Home
Assistant/AI adapters. Deployed as a two-service Docker Compose project
(`app`, `db`) on the user's existing Docker host, with Postgres on an
internal-only network and the app reachable only through an external reverse
proxy. This shape is sound for a single-household workload and is endorsed
without change — see `docs/architecture/target-architecture.md` and
ADR-001/002/003/004.

## 2. Application boundaries

`features/*` own vertical behavior (domain rules, commands/queries, UI,
tests); `components/ui` holds shared presentation; `infrastructure/*` holds
DB/auth/logging/storage; `integrations/*` holds provider-specific adapters
only (`docs/architecture/module-boundaries.md`). The rule "no module imports
another module's database schema directly" is stated but has no enforcement
mechanism yet (no lint rule, no dependency-cruiser config, nothing in
`package.json`). **Gap (Medium):** add an import-boundary lint rule
(`eslint-plugin-boundaries` or `dependency-cruiser`) in Phase 1 so the rule
is machine-checked, not just documented — module boundaries erode silently
otherwise once more than one feature exists.

## 3. Domain boundaries

`docs/domain/domain-model.md` enumerates a coherent aggregate set (Household,
Person, UserAccount, HouseholdMembership, Task, Case, Deadline,
CalendarEvent, Reminder, Organization, Contact, DocumentReference, Expense,
Reimbursement, Budget, Trip, Asset, Warranty, Note, AuditEvent,
IntegrationConnection, SyncRun, OutboxEvent) with a clear ownership-vs-
visibility distinction and a three-tier sensitivity model. This is accepted
as-is. One addition is needed:

**Gap (Medium): no explicit `Notification` or `AIActionProposal` aggregate
in `docs/domain/domain-model.md`**, even though both are named as
first-class domain concepts in this session's own operating instructions and
are required by `docs/architecture/module-boundaries.md`'s
`features/notifications` and CLAUDE.md §11's AI workflow
(`AI suggestion -> visible provenance -> human review -> explicit confirmation -> domain command`).
Without a stored `AIActionProposal`, "visible provenance" has nowhere to
live. **Recommended fix (do in Phase 2/Phase 8 domain work, not now):** add
both aggregates to `domain-model.md` before Phase 2 (Notification) and
Phase 8 (AIActionProposal) implementation begins.

## 4. Data ownership

Every household-owned row carries `householdId` (enforced convention, not
yet a DB constraint — no schema exists). `docs/domain/erd.md` correctly
specifies UTC timestamps, `DATE` for date-only fields, integer-minor-unit
money with ISO currency, explicit foreign keys, and "no cascade delete
across audit history." Accepted as-is. Enforcement is a Phase 1 concern
(migrations + `NOT NULL householdId` + CHECK constraints where practical).

## 5. Authentication model

Previously undecided (see "Fixed during this pass" — ADR-006). Auth.js v5 +
Credentials + Argon2id + database sessions. Not yet implemented — no
`infrastructure/auth` code exists beyond the empty directory. **This is the
first concrete piece of work in Phase 1** per CLAUDE.md §17 Phase 1 scope.

## 6. Authorization model

Hybrid RBAC + resource policy (`docs/security/security-model.md`,
`docs/permissions.md`). The generic base policy (`application/policies/authorize.ts`)
had the fail-open defect fixed above. One structural limitation remains and
is **not** fixable by editing this one function — flagging it now so Phase 1
feature work doesn't assume `canAccess` alone is sufficient:

**Finding (High): a single generic `canAccess(actor, action, resource)` cannot
encode every row of `docs/permissions.md`.**
- *Problem:* The permissions matrix has resource-type-specific rules —
  Finance is "none by default" for CHILD *regardless of sensitivity*, Audit
  is "security-relevant own activity only" for ADULT (not full household
  access), Cases require explicit assignment even for ADULT in some
  household configurations implied by the product spec's "waiting" model.
  `ResourceContext` has no `resourceType` field, so the base policy can only
  reason about `visibility`/`sensitivity`/`ownerUserId`/`allowedUserIds`/`personScopeIds`.
- *Why it matters:* If Phase 1+ feature code calls `canAccess` directly and
  assumes it fully enforces the matrix, Finance/Audit access will be
  under-restricted for roles the matrix explicitly excludes.
- *Consequence if unaddressed:* A CHILD could be granted Finance access by
  simply not setting `sensitivity` above `NORMAL` on an expense record,
  since nothing currently forbids that at the schema or policy layer.
- *Recommended solution:* (a) treat `canAccess` as the **base** gate only;
  each `features/*` module adds a thin resource-type-aware wrapper (e.g.
  `authorizeFinanceAccess`, `authorizeAuditAccess`) that layers matrix rules
  `canAccess` cannot express — starting with "Finance and Audit records are
  never constructed with `sensitivity: NORMAL`" as a domain invariant
  checked in the write-side validator, not just documented; (b) add
  adversarial tests per feature module mirroring
  `tests/security/authorization.spec.ts`, one suite per resource type, as
  each feature is built.
- *Affected files:* `application/policies/authorize.ts` (base, already
  fixed), future `features/finance/policy.ts`, `features/cases/policy.ts`,
  etc.
- *Implementation order:* alongside each feature module in Phases 2–6, not
  as a separate up-front task — building it before any feature exists would
  be speculative.

## 7. Integration model

`docs/integrations/integration-contracts.md` and
`docs/architecture/target-architecture.md` correctly scope Paperless/
Nextcloud/Calendar/Home Assistant as reference/link/read-only adapters
(anti-goal: don't become a second document/file archive), each requiring
timeout, retry-with-backoff, idempotency, structured errors, auditability,
credential rotation, sync health. Accepted as-is; no adapter code exists yet
(Phase 7). One addition worth making explicit before Phase 7 starts:

**Gap (Low):** no document specifies webhook signature verification
mechanics per provider (HMAC scheme, header name, replay window) — only the
generic requirement ("webhook spoofing" / "webhook replay" mitigations in
`docs/security/threat-model.md`). Defer to Phase 7 when the actual provider
webhook contracts are read from their current documentation; inventing the
mechanics now would risk being wrong by the time Phase 7 starts.

## 8. Background-job model

ADR-004 (transactional outbox) is the right choice for a single-Postgres
deployment: outbox rows are written in the same transaction as the domain
change, and a worker processes them with retries. No worker implementation
exists yet (expected — Phase 2 for reminders, Phase 7 for integrations).
**Gap (Medium):** neither `docs/architecture/target-architecture.md` nor any
ADR states *how* the outbox worker runs in this specific deployment (a
`setInterval` loop inside the `app` container? a separate Compose service? a
Postgres `LISTEN/NOTIFY` trigger?). `docker-compose.yml` lists only `app`
and `db` with `backup worker` as "optional" — no outbox worker service is
named at all. **Recommended:** decide in Phase 2 when the outbox is first
implemented, not now (deciding it today without a concrete workload would be
guessing); likely answer is an in-process interval inside `app` given the
single-instance modular-monolith deployment target, with a documented
follow-up if multi-instance deployment is ever considered.

## 9. Notification model

`docs/research/deep-audit.md` already correctly identified "a due date is
not a reminder system" and recommended reminder records + outbox + provider
delivery state. This session's operating instructions add "quiet hours,"
"escalation," and "deduplication" requirements not yet reflected in any repo
doc. **Gap (Medium):** no `docs/domain/domain-model.md` entry defines the
`Reminder`/`Notification` delivery-state fields (sent/failed/deferred,
dedup key, quiet-hours suppression). Recommended: fold into the Phase 2
domain-model update alongside the `Notification` aggregate gap from §3.

## 10. AI boundaries

ADR-005 (AI is advisory) plus CLAUDE.md §12/§11's
`suggestion -> provenance -> human review -> confirmation -> domain command`
workflow is a strong, unambiguous boundary and is accepted as-is. The only
gap is structural (§3/§9 above): there is nowhere to persist "provenance"
without an `AIActionProposal` aggregate. No AI code should be written before
Phase 8 per the roadmap; nothing here requires action now.

## 11. Storage model

PostgreSQL only (ADR-002), Drizzle ORM, `postgres.js` driver — appropriate
choices, already reflected in `package.json`. **Gap (High, Phase 1 blocker):**
no `drizzle.config.ts` exists, so `db:generate`/`db:migrate`/`db:check` in
`package.json` cannot run. This is correctly out of scope for Phase 0 (it's
Phase 1 "Foundation" work per `docs/implementation/roadmap.md`) but is
flagged here so Phase 1 does not silently skip it.

## 12. Failure modes

`docs/architecture/target-architecture.md` §"Failure behavior" covers
Postgres unavailability, container recreation, host reboot, and integration
unavailability adequately for Phase 0. Accepted as-is.

## 13. Security risks

See `docs/security/threat-model.md` (BOLA, child escalation, SSRF, webhook
replay, AI overreach, backup compromise) — this is a good abuse-case list
and is accepted as the baseline. This pass's concrete addition is the
authorization fail-open fix in §6/"Fixed during this pass." One more
concrete gap found:

**Finding (Medium): no CSRF strategy is written down for non-Server-Action
routes.** Next.js Server Actions get built-in Origin-header verification,
but `GET /api/ha/summary` and any future REST-style route handlers using
cookie-based session auth (rather than the HA bearer token) need an explicit
CSRF decision. `docs/security/security-model.md` lists "CSRF defenses
appropriate to architecture" as a requirement but does not say what that
architecture implies. **Recommended:** document in Phase 1 (alongside
ADR-006 auth implementation) that (a) `/api/ha/summary` is bearer-token
authenticated, not cookie/session authenticated, so it is not a CSRF target;
(b) any future cookie-authenticated route handler that mutates state must
either go through a Server Action instead, or implement double-submit-cookie
CSRF tokens explicitly. This doesn't need a new ADR — it's a direct
consequence of ADR-006 and can be a short addendum there when Phase 1
implements it.

## 14. Privacy risks

`docs/security/privacy-and-retention.md` is thorough (retention defaults,
anonymization over hard-delete, export manifest requirements). Accepted as-
is.

## 15. Concurrency risks

`docs/domain/erd.md`/CLAUDE.md require optimistic concurrency (`version`
column, already present in `HouseholdScoped` in `domain/shared/types.ts`).
No command layer exists yet to enforce version-check-on-write; this is
correctly Phase 1+ work, not a Phase 0 gap.

## 16. Sync risks

Covered by the integration contracts and ADR-004 outbox; no code exists yet
(Phase 7). No Phase 0 action needed.

## 17. Backup/recovery risks

`docs/backup/backup-restore.md` sets RPO 24h / RTO 4h as *initial* targets
pending host inspection, and correctly refuses to invent host-specific
backup destination/retention facts it doesn't have
(`docs/architecture/deployment-feasibility.md`). **This is a genuine
blocker, not a documentation gap:** Phase 0's own exit criteria in
`docs/implementation/roadmap.md` include "deployment plan verified against
host," and that verification requires running the inspection checklist
(`docker version`, `docker info`, CPU/RAM/storage, existing reverse proxy,
existing backup system, existing Postgres services) **against the actual
target host**, which this session has no access to. See "Unresolved
questions requiring the user" below — this cannot be resolved by further
reading or reasoning about the repository.

## 18. UX risks

`docs/design/design-system.md`, `screen-inventory.md`, and
`implementation-handoff.md` are internally consistent and specific
(spacing/type/radius tokens, required responsive states per screen,
mobile-table-becomes-cards rule). Accepted as-is; no code exists yet to
audit against them (Phase 1+ per screen).

## 19. Accessibility risks

WCAG 2.2 AA is the stated target with concrete acceptance items in
`docs/qa/acceptance.md` (keyboard-only flows, focus visibility, screen-
reader labels, automated + manual checks). Accepted as-is; `package.json`
already includes `@playwright/test` with a `test:a11y` script, but the
target file (`tests/e2e/accessibility.spec.ts`) doesn't exist yet and no
`@axe-core/playwright` dependency is declared. **Gap (Medium, Phase 1
entry requirement):** add `@axe-core/playwright` when the first E2E tests
are written — flagged here so it isn't forgotten when Phase 1 sets up the
test harness, since `test:a11y` currently points at a nonexistent file.

## 20. Observability gaps

Resolved for the "which library" question (ADR-010, pino). Still open,
correctly deferred to Phase 1: what gets logged for each subsystem's
health/latency/failure/retry/queue-depth/sync-state per CLAUDE.md §20 — this
needs to be designed against real subsystems as they're built, not
speculated about now.

## 21. Testing gaps

`tests/{unit,integration,e2e,fixtures}` are empty stub directories; only
`tests/security/authorization.spec.ts` has real content (now expanded, see
"Fixed during this pass"). **Gap (High, Phase 1 entry requirement):** no
`vitest.config.ts`, no `playwright.config.ts` exist. `package.json`'s
`test`/`test:e2e`/`test:a11y` scripts will not run correctly without them
(Vitest can run config-less for trivial cases, which is why the existing
spec file was plausible as "working" — but Playwright requires a config to
find `tests/e2e/`). Recommended to add both at the start of Phase 1, before
any feature test is written, not as an afterthought.

**Verified empirically this pass:** `pnpm install` + `npx vitest run` was
actually executed (not just read about) — all 13 tests in
`tests/security/authorization.spec.ts` pass, confirming the §6 authorization
fix. `npx eslint .` was also attempted and fails immediately: **no
`eslint.config.js` exists**, and `eslint-config-next` (or any ruleset) is
not declared in `package.json`'s `devDependencies` even though `"lint":
"eslint ."` is already a script. **Gap (High, Phase 1 entry requirement),
added to the table below.**

## 22. Deployment risks

`docs/architecture/deployment.md` and `deployment-feasibility.md` correctly
withhold host-specific facts (CPU/RAM/storage/reverse-proxy/network) that
cannot be verified from the repository alone, and this session likewise has
no access to the target Docker host, so those facts remain unresolved (see
§17 and "Unresolved questions" below). **Fixed in this pass:** the concrete,
verifiable deployment defect (`.env.example`/`docker-compose.yml`
`POSTGRES_PASSWORD` mismatch) that *was* fully resolvable from the
repository alone.

`Dockerfile` references `pnpm-lock.yaml*` (glob, tolerates absence at
`COPY` time) but `pnpm install --frozen-lockfile` needs one to exist.
**Resolved this pass:** `pnpm` was not installed in this environment (only
`npm` and Node 24 were present), so `corepack enable && corepack use
pnpm@10` was run, followed by `pnpm install`, which generated and left
`pnpm-lock.yaml` committed-ready in the repository root. This also served as
the environment in which the `tsc --noEmit` (§"Fixed during this pass" item
3), `vitest run` (13/13 passing, including the new authorization regression
tests), and `eslint` (fails — see §21) checks below were actually executed,
not just reasoned about.

## 23. Technical debt

None yet — there is effectively no implementation to accrue debt in. Noted
for completeness per the requested audit structure.

## 24. Ambiguous requirements

1. **Outbox worker hosting** (§8) — genuinely undecided, correctly deferred
   to Phase 2.
2. **CSRF mechanics for non-Server-Action routes** (§13) — resolved above as
   a direct consequence of ADR-006, deferred to Phase 1 implementation.
3. **Whether `Notification` and `AIActionProposal` are aggregates in their
   own right or fields on existing entities** (§3/§9) — resolved as: they
   are aggregates, to be added to `docs/domain/domain-model.md` in Phase 2
   and Phase 8 respectively, because both need independent lifecycle
   (delivery state; confirmation state) that doesn't belong on the entities
   they reference.

## 25. Contradictions

1. **Case state machine** (§"Fixed during this pass" item 3) — resolved via
   ADR-007: the repository's own `docs/domain/state-machines.md` (7-state,
   WAITING/BLOCKED distinct) is authoritative over the simpler 5-state
   description that appears in this session's generic operating
   instructions (outside the repository). The repo's version is more
   precise and was already the product of a prior audit pass
   (`docs/research/deep-audit.md` item 1); the generic instruction text is
   template material, not a repository artifact, and does not override a
   documented, reasoned ADR.
2. **No other content contradictions found** between `docs/requirements/`,
   `docs/domain/`, `docs/architecture/`, `docs/security/`, `docs/design/`,
   and `docs/implementation/`. The corpus is small and was written as one
   coherent pass (per `docs/research/deep-audit.md`'s own account), which is
   consistent with what this reading pass found.

## 26. Recommended corrections — summary table

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | `canAccess` fail-open for VIEWER/CHILD | Critical | **Fixed this pass** |
| 2 | `.env.example`/`docker-compose.yml` `POSTGRES_PASSWORD` mismatch | High | **Fixed this pass** |
| 3 | `tsc --noEmit` fails out of the box (Next/TS/@types/node URLPattern version skew) | High | **Fixed this pass** (`types/url-pattern.d.ts` shim) |
| 4 | No chosen auth library | High | **Resolved: ADR-006** |
| 5 | Case state machine contradiction | High | **Resolved: ADR-007** |
| 6 | No chosen i18n library | Medium | **Resolved: ADR-008** |
| 7 | No chosen rate-limiting mechanism | Medium | **Resolved: ADR-009** |
| 8 | No chosen structured-logging library | Medium | **Resolved: ADR-010** |
| 9 | Generic `canAccess` can't express per-resource-type matrix rules (Finance/Audit) | High | Documented (§6); implement per feature module in Phases 2–6 |
| 10 | No `Notification`/`AIActionProposal` aggregates in domain model | Medium | Documented (§3/§9); add in Phase 2/Phase 8 |
| 11 | No module-boundary lint enforcement | Medium | Documented (§2); add in Phase 1 |
| 12 | No `drizzle.config.ts`/`vitest.config.ts`/`playwright.config.ts`/lockfile | High | Documented (§11/§21/§22); Phase 1 entry requirement |
| 13 | No `eslint.config.js` and no lint ruleset declared, despite an existing `lint` script | High | Documented (§21); Phase 1 entry requirement |
| 14 | `test:a11y` points at a nonexistent spec file; `@axe-core/playwright` not declared | Medium | Documented (§19); Phase 1 entry requirement |
| 15 | Outbox worker hosting undecided | Medium | Accepted — decide in Phase 2 with real workload |
| 16 | CSRF mechanics for non-Server-Action routes unwritten | Medium | Documented (§13); implement with ADR-006 in Phase 1 |
| 17 | Host capacity/reverse-proxy/backup-target facts unknown | Critical (blocks production deployment, not Phase 0 exit) | **Unresolved — requires user/host access** |

Severity key: Critical = blocks safe operation or is actively exploitable;
High = must be resolved before the phase that depends on it starts; Medium =
should be resolved before the dependent phase ends; Low = track, non-
blocking; Accepted = intentional, documented trade-off.

---

## Unresolved questions requiring the user

These cannot be resolved by reading the repository or by engineering
judgment — they require information only the user has, per
`docs/architecture/deployment-feasibility.md`'s own inspection checklist:

1. Can the target Docker host run `docker version`, `docker compose
   version`, `docker info` for me (or can you paste the output), so CPU/RAM/
   storage/existing-network facts can replace the current "unknown" status
   in §17/§22?
2. What reverse proxy is already running on that host (Caddy/Traefik/nginx
   proxy manager/other), and what hostname should `APP_URL` use?
3. Where should encrypted backups be written (existing backup target on the
   homelab, or does one need to be introduced)?
4. Is remote access intended (VPN vs. reverse-proxy-exposed), or LAN-only?

None of these block Phase 1 foundation work (auth, household model, schema,
design system, CI-equivalent local quality gates), which does not require a
live deployment target. They **do** block finalizing `docs/architecture/deployment-feasibility.md`
from "recommendation" to "verified," which is a named Phase 0 exit
criterion — so Phase 0 is functionally complete for everything reasonable to
resolve without host access, with this one item explicitly carried forward
rather than guessed at.

---

## Recommended implementation order (unchanged from `docs/research/deep-audit.md`, reaffirmed)

1. Phase 0 validation — **this document** (complete, modulo the host-access
   item above).
2. Phase 1 — Foundation: app shell, Auth.js (ADR-006), household model,
   Drizzle schema + `drizzle.config.ts`, `vitest.config.ts`/
   `playwright.config.ts`, policy engine (base `canAccess` fixed; per-
   feature wrappers begin here), audit foundation, health/readiness
   endpoints, `pnpm-lock.yaml`.
3. Phase 2 — Attention engine: Inbox, Tasks, Deadlines, Today, Attention,
   outbox + `Notification`/`Reminder` aggregates, outbox worker hosting
   decision.
4. Phase 3 — Cases/context (state machine per ADR-007).
5. Phase 4 — Calendar/family.
6. Phase 5 — Finance (Finance/Audit `sensitivity` invariant from §6 enforced
   here).
7. Phase 6 — Travel/assets.
8. Phase 7 — Integrations (webhook signature mechanics researched per
   provider at this point, per §7).
9. Phase 8 — AI (`AIActionProposal` aggregate added here, per §3/§10).

Per CLAUDE.md §19/§23: **do not begin Phase 1 automatically.** This audit
and the Phase 0 fixes above are the complete Phase 0 deliverable; Phase 1
starts only on explicit instruction.

---

## Phase 1 — Foundation (implemented)

Authorized to proceed autonomously. Delivered the full "vertical slice 1"
from `docs/implementation/implementation-plan.md`: **Authentication ->
household -> person -> policy -> audit**, plus the Phase 1 entry
requirements §11/§19/§21/§22 above flagged as blockers.

### What was built

- **Config**: `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`,
  `drizzle.config.ts`, `types/url-pattern.d.ts` shim, `tsconfig.json`
  `skipLibCheck: true` (see finding below).
- **Schema** (`db/schema/`): `enums`, `auth` (users + session_revocation,
  no Auth.js Adapter tables — see ADR-006 correction), `household`
  (household + household_membership with a unique (householdId, userId)
  index), `person`, `audit`. Migration generated and applied against a live
  PostgreSQL 18.6 container (`db/migrations/0000_ambiguous_the_call.sql`).
- **Domain** (`domain/family/`): `Household`, `Person`,
  `HouseholdMembership` types, plus `wouldLeaveHouseholdWithoutOwner` — a
  domain invariant guarding against a household ending up with zero active
  OWNERs (unit-tested).
- **Application**: `bootstrapHousehold` (first-run setup, ADR-012),
  `addHouseholdMember`, `getHouseholdMembers`, `isSetupComplete`,
  `recordAuditEvent`, `application/errors.ts`
  (`AuthorizationError`/`ConflictError`/`NotFoundError`), and
  `application/policies/household.ts` — the first concrete instance of the
  "feature-level policy wrapper on top of the base `canAccess`" pattern
  this audit's §6 called for.
- **Infrastructure**: `infrastructure/db/client.ts` (Drizzle +
  postgres.js), `infrastructure/auth/{auth.config,auth,password}.ts`
  (Auth.js v5, Argon2id, JWT + explicit revocation table — ADR-006),
  `infrastructure/logging/logger.ts` (pino, ADR-010),
  `infrastructure/rate-limit/limiter.ts` (rate-limiter-flexible on a
  dedicated `pg.Pool`, ADR-009).
- **UI**: `app/tokens.css` (design tokens as CSS custom properties,
  light/dark/system, ADR-011), `components/ui/{Button,TextField,Card}`,
  `components/app-shell/AppShell` (a top bar, not yet the full
  Sidebar/MobileBottomNav — documented as an intentional Phase 1 scope call
  in the component's own file), `/setup` (first-run bootstrap),
  `/login`, `/dashboard`, `/family` (list + OWNER/ADMIN add-member form).
- **i18n**: `next-intl` wired without URL routing (ADR-008), `messages/{en,de}.json`
  with real, hand-written (not machine-translated) copy for every string
  actually used.
- **Reliability**: `app/api/health` (liveness) and `app/api/ready`
  (readiness, checks `select 1`), per the Phase 1 roadmap item.
- **New ADRs**: 006 (authentication, revised mid-implementation — see
  below), 007 (case state machine), 008 (i18n), 009 (rate limiting, revised
  mid-implementation), 010 (logging), 011 (styling), 012 (no public
  registration).

### Corrections made *during* implementation (verified against real library behavior, not assumed)

Consistent with this document's own opening methodology — read source, run
the actual tool, don't guess — four more issues surfaced only once real
code was written and actually executed, each fixed on the spot:

1. **ADR-006 was wrong as first written.** `@auth/core`'s own source
   (`lib/utils/assert.js`) rejects database session strategy combined with
   a Credentials-only provider list (`UnsupportedStrategy`). Revised to JWT
   strategy with an explicit `session_revocation` table checked in the
   `jwt` callback — see the ADR's own "Correction" section for the full
   account, including the general lesson ("read the actual library source
   for a hard API constraint before committing to an architecture that
   depends on it") recorded there for future ADRs.
2. **ADR-009's rate limiter needed a different DB client than assumed.**
   `RateLimiterPostgres` speaks the `pg` (node-postgres) query interface,
   not `postgres.js`'s tagged-template API that Drizzle uses. Fixed with a
   small dedicated `pg.Pool`, documented in the ADR; the limiter's table is
   self-managed by the library, not part of the Drizzle schema.
3. **A real `canAccess` composition bug, caught by its own test suite.**
   `application/policies/household.ts`'s first draft of
   `authorizePersonAccess` passed `personScopeIds: [resource.personId]`
   unconditionally — but that field is a *universal* restriction in the
   base `canAccess` (checked before any role branch), so it silently
   confined ADULT/VIEWER to only their own person row instead of the
   household-scoped/read access `docs/permissions.md` actually grants
   them. `tests/unit/application/household-policy.spec.ts` caught this
   immediately (2 failing assertions); fixed by branching CHILD's
   self-scope restriction out from the household-scoped default.
4. **Two Person-sensitivity docs contradicted each other.** Classifying
   `Person` as `SENSITIVE` (matching `domain-model.md`'s own "personal data
   -> SENSITIVE" rule) combined with the fixed `canAccess`'s "CHILD is
   blocked from any non-NORMAL resource" would make a child unable to see
   their own profile — contradicting `docs/permissions.md`'s "Child People
   access: self/allowed". Resolved by classifying `Person`'s core identity
   fields as NORMAL and documenting the reasoning directly in
   `docs/domain/domain-model.md` (a person's *name* isn't sensitive
   content; sensitive content *about* a person lives on the aggregate that
   carries it).
5. **`tsconfig.json` was missing `skipLibCheck: true`.** Without it,
   `tsc --noEmit` fails on internal type-export inconsistencies inside
   `@auth/core`'s and `drizzle-orm`'s own `.d.ts` files (e.g. MySQL/
   SingleStore/Gel dialect type errors having nothing to do with this
   Postgres-only project) — noise every real-world Next.js project
   suppresses by default (it's in `create-next-app`'s own template) and
   this scaffold's tsconfig had never had a dependency large enough to
   surface the gap until Phase 1 added one.
6. **Next.js 16.3.5 deprecates the `middleware.ts` file convention in
   favor of `proxy.ts`.** Discovered from the dev server's own startup
   warning during the live smoke test below (an example of why "run it,
   don't just typecheck it" matters — this would never surface from
   `tsc`/`vitest` alone). Verified via Next.js's own build source
   (`PROXY_FILENAME`/`MIDDLEWARE_LOCATION_REGEXP` in `next/dist/lib/constants.js`)
   that it's a pure filename rename with an identical default-export
   convention, then applied it (`git mv middleware.ts proxy.ts`) and
   re-verified the warning was gone.

### Verification performed (not just claimed)

- `pnpm typecheck` — clean.
- `pnpm lint` — clean (after also fixing a real `eslint.config.js` bug:
  `FlatCompat(...).extends("next/core-web-vitals", ...)` crashed with
  "Converting circular structure to JSON" from a circular self-reference
  inside `eslint-plugin-react`'s flat config; fixed by importing
  `eslint-config-next`'s native flat-config exports directly instead of
  going through the legacy-compat shim).
- `pnpm test` (Vitest) — **31/31 passing**, across 4 files: the original
  authorization suite (13, expanded from 3), a new domain unit suite (5),
  a new policy unit suite (9), and a new **integration suite (4)** that
  runs `bootstrapHousehold`/`addHouseholdMember`/`getHouseholdMembers`
  against a real PostgreSQL 18.6 container, truncating tables between
  cases.
- **Live browser smoke test** against `pnpm dev` + the same live database:
  `/` correctly redirects to `/setup` on an empty database; the setup form
  creates a household and signs the owner in; `/dashboard` shows the
  correct greeting and member count; `/family` lists members and lets the
  OWNER add a CHILD member with no login; sign-out redirects to `/login`
  and actually revokes the session row (verified by the immediate
  `/dashboard` -> `/login` redirect on the next request); an unauthenticated
  direct visit to `/dashboard` redirects to `/login`; a wrong password is
  rejected with a translated German/English-ready error message and does
  not leak whether the account exists.
- `docker compose up -d db` + `pnpm db:migrate` — applied cleanly; schema
  inspected directly in the generated SQL before applying.
- A local-only `docker-compose.override.yml` (gitignored) was needed to
  reach the `db` container from the host during development — and revealed
  a genuine Docker behavior worth recording: **`internal: true` on a
  Compose network blocks published ports from binding at all**, not just
  outbound internet access as the flag name might suggest (verified
  empirically: `docker port` stayed empty even after `--force-recreate`
  until the override also set `internal: false`). This doesn't affect the
  shipped `docker-compose.yml` — the override never ships — but is worth
  knowing for anyone else who tries to add a dev-only port-forward the
  "obvious" way.

### What remains for Phase 1 (not done in this pass, by design)

- Full `Sidebar`/`MobileBottomNav` per `docs/design/design-system.md` —
  deferred until more than 2 nav destinations exist (documented in
  `components/app-shell/AppShell.module.css`).
- E2E (Playwright) and accessibility (`@axe-core/playwright`) tests — the
  config now exists (`playwright.config.ts`) but no spec files were
  written yet; Vitest + a live browser smoke test covered this pass's
  verification instead.
- Module-boundary lint enforcement (§2) — not added; still a Medium
  finding for whenever more than one `features/*` module exists to have
  boundaries between.
- `docs/architecture/deployment-feasibility.md`'s host-facts gap (§17) —
  still open, still requires the user's own environment access.

### Git

This repository had no version control (`git init` had never been run).
Initialized it partway through Phase 1, specifically so the
`middleware.ts` -> `proxy.ts` codemod (`@next/codemod@canary`) could run
safely with `--force` and a reviewable diff, rather than either skipping a
real verification tool or risking an unreviewable destructive rewrite on
an unversioned tree. `.gitignore` was already correct (verified `.env`,
`node_modules`, and the dev-only Compose override are excluded before the
first commit).
