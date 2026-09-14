# Med Family OS — Deep Architecture Audit

## Executive assessment

The supplied scaffold has a strong instinct: modular monolith, explicit homelab ownership, PostgreSQL, server-side authorization, first-class cases, and restrained integrations. It is not yet a complete product architecture, however. It is primarily a requirements outline.

The strongest upgrade is to make **attention + next action + policy + provenance + reliable side effects** the backbone of the system.

## Weak spots found

### 1. Task/case status was defined, but operational follow-up was underspecified
A WAITING state without `waitingFor`, `waitingSince`, `followUpAt`, `nextAction`, and accountable party produces forgotten work.

**Fix:** explicit next-action/follow-up model and deterministic attention rules.

### 2. Roles were too coarse
OWNER/ADMIN/ADULT/CHILD/VIEWER is useful, but insufficient for real household data.

**Fix:** hybrid RBAC + resource/relationship policy with household, visibility, sensitivity, person scope and allowed-user constraints.

### 3. Domain lifecycle lacked formal transitions
Free-form status updates can create impossible states.

**Fix:** state machines with command-level transition rules and tests.

### 4. Integrations lacked synchronization semantics
The original design named providers but did not fully specify cursors, idempotency, conflict handling, retries or deletion behavior.

**Fix:** provider adapters with sync runs, checkpoints, external IDs, retry classification and observability.

### 5. Reminders/notifications were missing as a durable subsystem
A due date is not a reminder system.

**Fix:** reminder records + transactional outbox + provider delivery state.

### 6. External facts lacked provenance
Travel accessibility is explicitly called out as needing verification, but provenance/freshness should be generalized.

**Fix:** source, verification date, confidence and freshness for externally sourced facts.

### 7. Concurrency was not explicit
Household apps are frequently edited from phones and desktops simultaneously.

**Fix:** optimistic concurrency and conflict handling.

### 8. Data lifecycle was incomplete
Archive/delete/retention/export implications were not consistently defined.

**Fix:** lifecycle contract for every aggregate and documented deletion semantics.

### 9. Security needed a threat model
The original security list was good but did not explicitly enumerate BOLA, child escalation, SSRF, webhook replay, AI context leakage and backup theft.

**Fix:** explicit threat model + adversarial tests.

### 10. Dashboard risked becoming a generic information wall
The original dashboard list was correct but could become statistics-heavy.

**Fix:** attention-first home, Today, Inbox and Waiting views.

### 11. Design was not part of the engineering contract
The scaffold had no complete navigation, component system, responsive rules or screen inventory.

**Fix:** design-system specification, complete screen inventory and Figma build specification.

### 12. Phase 0 did not enforce consistency across artifacts
Architecture, permissions, data model and UI could drift.

**Fix:** Phase-0 consistency check as an exit criterion.

## Product architecture now recommended

The product is organized around:
- Inbox for capture/triage
- Today for execution
- Attention for prioritization
- Cases for real-world processes
- Context objects (people, organizations, documents, assets, trips, finance)
- Search for retrieval
- deterministic projections instead of duplicated truth

## Security architecture now recommended

Use:
- household tenancy boundary
- RBAC
- resource-level policies
- visibility
- sensitivity
- person scope
- explicit child restrictions
- audit events
- scoped Home Assistant credential
- policy-filtered AI retrieval
- adversarial authorization tests

## Reliability architecture now recommended

Use:
- PostgreSQL transactions
- optimistic concurrency
- transactional outbox
- idempotency keys
- provider sync checkpoints
- explicit sync health
- backup + restore drills

## Deployment conclusion

Use a separate Docker Compose project on the existing Docker host by default.

Do not create a VM/LXC without evidence. Do not expose PostgreSQL directly. Keep reverse proxy external.

Host-specific CPU/RAM/storage/reverse-proxy facts were not present in the uploaded repository, so the package intentionally does not invent them.

## Figma/design conclusion

The repository now contains a complete design specification covering:
- foundations
- components
- app shell
- attention
- workflows
- family
- finance
- travel
- assets
- integrations
- responsive states
- accessibility
- prototype flows

An editable Figma architecture/ERD artifact was generated in FigJam. A full editable Design-file UI could not be reliably created with the available Figma seat permissions in this run; the design package therefore remains explicit and implementation-ready rather than pretending that unverified UI frames were created.

## Recommended implementation order

1. Phase 0 validation
2. Foundation + auth + policy
3. Attention engine
4. Cases/context
5. Calendar/reminders
6. Finance
7. Travel/assets
8. Integrations
9. AI

This avoids the common failure mode of building many CRUD pages before the system can reliably answer “what needs my attention?”
