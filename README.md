# Med Family OS

Private, self-hosted household operating system for **attention, workflows, context, planning, and family coordination**.

This repository is an implementation-ready architecture package derived from the original scaffold and strengthened after a deep product, domain, security, deployment, integration, and UX review.

**Running it:** see [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md) — local development, first sign-in, hosting on a Docker VM, and the recommended configuration.

## What changed

The original scaffold had a good domain-first direction, but it left several critical decisions implicit. This version makes them explicit:

- attention/inbox as the primary interaction model
- unified work-item abstraction without collapsing domain semantics
- first-class ownership, visibility, sensitivity and household scope
- explicit resource-level authorization and policy tests
- state-transition rules instead of free-form status changes
- recurring items modeled safely
- notifications/reminders as a provider-backed subsystem
- external integrations as sync/import/link boundaries
- provenance, verification and freshness for external facts
- document references rather than a second document archive
- audit/event history for sensitive changes
- archival, retention, soft-delete and export rules
- idempotency and sync cursors for integrations
- outbox pattern for reliable side effects
- optimistic concurrency/versioning
- robust backup/restore and disaster-recovery acceptance criteria
- explicit threat model and abuse cases
- design system + complete screen inventory
- responsive/mobile-first information architecture
- reduced-motion, keyboard and WCAG 2.2 AA requirements
- AI is advisory only and never writes sensitive records without confirmation
- phased implementation with quality gates

## Source of truth

Read `CLAUDE.md` first. It is the execution contract for Claude Code.

Then read:

1. `docs/requirements/product-spec.md`
2. `docs/architecture/target-architecture.md`
3. `docs/domain/domain-model.md`
4. `docs/security/security-model.md`
5. `docs/design/design-system.md`
6. `docs/design/screen-inventory.md`
7. `docs/implementation/roadmap.md`

## Figma

The intended Figma deliverable is specified in `docs/design/figma-build-spec.md` and `docs/design/figma-page-map.md`.

A Figma design file could not be created in this run because the connected Figma workspace rejected new-file creation for the available seat/permission. The package therefore contains the complete design specification and machine-readable screen definitions so the design can be recreated without making product decisions.

## Core product principle

> The app should answer: **“What needs my attention, and what context do I need to act?”**

It is not a generic CRUD database and not a second copy of Paperless, Nextcloud, Obsidian, Vaultwarden, Immich, or Home Assistant.
