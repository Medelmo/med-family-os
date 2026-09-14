# Phase 0 Prompt for Claude

You are implementing Phase 0 of Med Family OS.

Read:
- CLAUDE.md
- docs/requirements/product-spec.md
- docs/domain/domain-model.md
- docs/domain/state-machines.md
- docs/architecture/target-architecture.md
- docs/architecture/module-boundaries.md
- docs/security/security-model.md
- docs/security/threat-model.md
- docs/design/design-system.md
- docs/design/screen-inventory.md
- docs/integrations/integration-contracts.md
- docs/implementation/roadmap.md

## Tasks

1. Inspect the repository.
2. Inspect the actual Docker host if access is available; otherwise document the exact missing facts.
3. Verify current stable versions from official sources.
4. Produce/validate:
   - requirements.md
   - domain-model.md
   - state-machines.md
   - erd.md
   - permissions.md
   - deployment-feasibility.md
   - home-assistant-integration.md
   - security-model.md
   - threat-model.md
   - backup-restore.md
   - technology-versions.md
   - risks.md
   - implementation-plan.md
5. Add ADRs for material decisions.
6. Do not implement broad application features.
7. Run consistency checks between domain, schema, permissions and screen inventory.
8. End with a concise recommendation and explicit unresolved questions.

## Important

Do not assume host hardware or reverse-proxy details. Do not invent them.

Do not start Phase 1 automatically.
