# Med Family OS — Claude Code Master Instructions

## 0. Mission

Build a private, self-hosted household operating system for one household.

The app is the family's **attention, workflow, context and planning layer**. It is not a replacement for specialist homelab services.

### System ownership boundaries

| Capability | System of record |
|---|---|
| Passwords/secrets | Vaultwarden |
| Documents/OCR | Paperless-ngx |
| File sync | Syncthing |
| Cloud files | Nextcloud |
| Photos | Immich |
| Knowledge notes | Obsidian |
| Smart home | Home Assistant |
| Infrastructure | Proxmox / Uptime Kuma / existing monitoring |
| Media | Jellyfin/Emby |
| Family/life workflows | Med Family OS |

Never copy an entire external system into this app simply because an integration is possible.

---

# 1. Non-negotiable working rules

1. **Read this file and the docs listed below before changing code.**
2. Work in phases. Do not skip a phase.
3. Never call a feature complete because it renders or compiles.
4. Every write path requires validation, authorization, persistence, error handling and tests.
5. Every sensitive resource requires an explicit authorization policy.
6. Never trust client-side hiding as authorization.
7. Never store passwords or long-lived external secrets in ordinary domain tables.
8. Never use custom cryptography.
9. Never silently overwrite concurrent edits.
10. External integrations must be idempotent and observable.
11. AI output is advisory until a human confirms it.
12. Do not expose sensitive data through Home Assistant.
13. Do not recreate Paperless, Nextcloud or Obsidian.
14. Prefer simple architecture over premature abstraction.
15. Do not introduce microservices.
16. Do not add a dependency without documenting why it is needed.
17. Before changing architecture, update an ADR.
18. Before changing the data model, update the domain model and migration plan.
19. Before changing UX/navigation, update the design spec.
20. After each phase: typecheck, lint, unit/integration tests, E2E tests where applicable, accessibility checks, security review, docs update.

---

# 2. Required reading order

1. `docs/requirements/product-spec.md`
2. `docs/domain/domain-model.md`
3. `docs/domain/state-machines.md`
4. `docs/architecture/target-architecture.md`
5. `docs/architecture/module-boundaries.md`
6. `docs/security/security-model.md`
7. `docs/security/threat-model.md`
8. `docs/design/design-system.md`
9. `docs/design/screen-inventory.md`
10. `docs/integrations/integration-contracts.md`
11. `docs/implementation/roadmap.md`

---

# 3. Product model

The application has two layers:

### Domain layer

Authoritative concepts:
- household
- user account
- person
- relationship
- organization
- contact
- task
- case
- deadline
- calendar event
- reminder
- document reference
- expense
- reimbursement
- budget
- trip
- trip item
- asset
- warranty
- maintenance record
- note
- audit event
- integration connection
- sync run
- attachment reference

### Experience layer

Views are projections over domain records:
- Inbox
- Today
- Attention
- Calendar
- Cases
- Tasks
- Family
- Documents
- Finance
- Trips
- Assets
- Search
- Settings
- HA view

Do not create domain tables merely because a UI card exists.

---

# 4. Core interaction model

## 4.1 Inbox

Anything that requires triage can enter Inbox.

Inbox items must be classifiable into:
- task
- case
- event
- document reference
- note
- expense
- trip item
- discard/archive

Triage must be fast and keyboard accessible.

## 4.2 Attention

Attention is computed, not manually maintained.

An item can be surfaced because it is:
- overdue
- due soon
- high/critical priority
- blocked
- waiting too long
- missing a required next action
- awaiting user confirmation
- stale integration data
- warranty nearing expiry
- reimbursement unresolved
- trip preparation incomplete

Attention rules are configurable and tested.

## 4.3 Today

Today combines:
- tasks
- deadlines
- calendar events
- reminders
- relevant case events
- travel items

It must not become a statistics dashboard.

---

# 5. Authorization model

Use a hybrid **RBAC + relationship/resource policy** model.

Roles:
- OWNER
- ADMIN
- ADULT
- CHILD
- VIEWER

But roles alone are insufficient.

Every protected resource also has:
- householdId
- ownerUserId where applicable
- personScope
- visibility: PRIVATE | HOUSEHOLD | SHARED
- sensitivity: NORMAL | SENSITIVE | HIGHLY_SENSITIVE
- optional allowedUserIds

Policy checks must answer:
1. Is the user authenticated?
2. Are they a member of the household?
3. Does their role permit the operation?
4. Does the resource visibility permit access?
5. Is the resource in their allowed person scope?
6. Is the sensitivity level allowed?
7. Is the action itself allowed?

Children default to highly restricted access and never inherit adult access.

Authorization tests must cover BOLA/IDOR attempts.

---

# 6. Data lifecycle

Every durable domain record must define:
- creation
- update
- state transitions
- archive behavior
- delete behavior
- retention
- export behavior
- audit behavior

Prefer archive over destructive deletion for operational records.

For hard deletion, require an explicit policy and audit trail.

Sensitive data deletion must account for:
- primary row
- attachments
- search indexes
- caches
- integration copies
- exports

---

# 7. Dates and time

Use:
- `DATE` for date-only concepts
- UTC instants for moments
- explicit IANA timezone for household/calendar interpretation

Never infer a timezone from the browser for stored domain meaning.

Recurring events must store recurrence rules and a timezone.

DST transitions must have tests.

---

# 8. Concurrency and writes

Every mutable aggregate uses optimistic concurrency:
- version number or equivalent
- conflict detection
- user-friendly conflict UI

For external side effects:
- write domain change
- record outbox event
- process side effect
- retry safely
- mark success/failure

Never rely on a UI toast as proof that a side effect completed.

---

# 9. Integrations

Integrations are provider adapters.

Each adapter must define:
- capabilities
- authentication
- rate limits
- sync direction
- cursor/checkpoint
- idempotency key
- retry policy
- error classification
- observability
- data mapping
- deletion behavior

The core domain must not depend on Paperless/Nextcloud/Home Assistant-specific data types.

---

# 10. Home Assistant

Expose only a dedicated read-only projection:

`GET /api/ha/summary`

and a deliberately simplified `/ha` page.

The HA surface may include:
- overdue count
- critical items
- waiting items
- today
- next deadlines
- family events
- upcoming trip

Never expose:
- passwords
- secrets
- health details
- children's sensitive data
- document contents
- detailed financial transactions

Use a narrowly scoped read-only credential. Do not give HA database access.

---

# 11. AI

AI is optional and cannot be required for core operation.

Allowed future capabilities:
- summarize a case
- summarize a document
- extract candidate structured data
- suggest tasks
- identify candidate deadlines
- answer questions over authorized data

Workflow:

`AI suggestion -> visible provenance -> human review -> explicit confirmation -> domain command`

AI cannot directly mutate sensitive records.

Never send passwords to AI.

---

# 12. Security baseline

Target OWASP ASVS 5.0.0.

Required:
- secure authentication/session implementation
- secure cookies
- CSRF defenses appropriate to architecture
- strict server-side authorization
- schema validation
- safe rendering
- secure headers
- rate limiting on authentication and abuse-sensitive endpoints
- safe file handling
- dependency and container scanning
- audit logging
- secret management
- safe errors
- request correlation IDs
- security event logging
- backup encryption where appropriate
- restore testing

Use a mature authentication solution; do not implement password hashing/session protocols yourself.

---

# 13. Accessibility

Target WCAG 2.2 AA.

Required:
- keyboard navigation
- visible focus
- focus not obscured
- semantic landmarks
- accessible names
- error identification
- accessible authentication
- adequate target sizes
- no color-only state communication
- reduced motion
- screen reader support
- accessible dialogs
- accessible tables
- accessible comboboxes
- logical heading hierarchy

---

# 14. Internationalization

Initial languages:
- German
- English

Architecture-ready for:
- French
- Arabic / RTL

No user-facing strings hard-coded in components.

Dates, times, numbers and currencies must use locale-aware formatting.

---

# 15. Architecture

Use a modular monolith:

- Next.js App Router
- React
- TypeScript
- PostgreSQL
- Drizzle ORM
- Zod
- Vitest
- Playwright
- Docker Compose

Keep domain logic independent of React and infrastructure.

Preferred dependency direction:

`UI -> application -> domain`

`infrastructure -> application/domain ports`

`integrations -> application/domain ports`

Domain must not import UI, ORM or provider SDKs.

---

# 16. Repository rules

Feature modules own their vertical behavior.

Example:

`features/tasks/`
- domain rules
- application commands/queries
- UI
- tests

Shared UI lives in `components/ui`.

Cross-cutting infrastructure lives in `infrastructure/`.

Database schema/migrations live in `db/`.

---

# 17. Phase model

### Phase 0 — Architecture / feasibility
No broad production feature implementation.

Deliver:
- requirements
- domain model
- state machines
- ERD
- permissions
- deployment feasibility
- security model
- threat model
- backup/restore
- technology versions
- integration contracts
- risks
- implementation plan
- ADRs

### Phase 1 — Foundation
- app shell
- authentication
- household membership
- people
- policy engine
- database/migrations
- design system
- audit foundation
- health/readiness endpoints
- CI quality gates

### Phase 2 — Attention engine
- Inbox
- Tasks
- Deadlines
- Today
- Attention
- reminders/outbox

### Phase 3 — Cases/context
- Cases
- organizations
- contacts
- notes
- timeline
- document references

### Phase 4 — Calendar/family
- calendar
- recurring events
- people relationships
- shared family views

### Phase 5 — Finance
- expenses
- budgets
- reimbursements
- CSV import/export

### Phase 6 — Travel/assets
- trips
- packing
- accessibility verification
- assets
- warranties
- maintenance

### Phase 7 — Integrations
- Paperless
- Nextcloud
- Home Assistant
- calendar providers

### Phase 8 — AI / advanced automation
Only after authorization, audit and provenance foundations are proven.

---

# 18. Definition of done

A feature is done only when:
- domain behavior is specified
- state transitions are tested
- migrations exist
- validation exists
- authorization exists
- errors/loading/empty states exist
- responsive UI exists
- accessibility is tested
- unit/integration/E2E tests exist at appropriate levels
- audit implications are covered
- backup/export implications are considered
- docs are updated
- no known critical/high security issue remains

---

# 19. Claude operating prompt

When asked to implement a phase:

1. Inspect current repository and previous phase artifacts.
2. Restate the exact phase boundary internally.
3. Identify files/modules affected.
4. Check domain and ADR consistency.
5. Implement the smallest coherent increment.
6. Add migrations.
7. Add authorization tests before or alongside UI.
8. Add unit/integration tests.
9. Add E2E tests for critical user journeys.
10. Run typecheck, lint, tests, build.
11. Run accessibility checks.
12. Review security.
13. Update documentation.
14. Produce a change summary and unresolved risks.
15. Do not begin the next phase.

If a requirement is ambiguous, choose the safest reversible option and record an ADR rather than inventing hidden behavior.

---

# 20. Current execution target

If the user says **"Start Phase 0"**, produce only the Phase-0 artifacts.

If the user says **"Implement Phase N"**, implement only Phase N and stop.

The current repository is an architecture package, not permission to implement the entire application in one pass.
