# Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Authorization leakage | Critical | centralized policies + adversarial tests |
| Domain sprawl | High | phase boundaries + anti-goals |
| Integration coupling | High | provider ports/adapters |
| Backup not restorable | Critical | restore drills |
| Notification reliability | High | outbox + delivery state |
| Waiting items become forgotten | High | follow-up model + attention rules |
| Duplicate external data | Medium | references + sync identity |
| Child data exposure | Critical | sensitivity + relationship policy |
| AI hallucination | High | advisory-only workflow |
| Mobile UX degradation | High | mobile-first design tests |
| Host capacity unknown | Medium | inspect actual homelab |
| Figma drift | Medium | design tokens + implementation review |
| Generic `canAccess` cannot encode resource-specific rows of `docs/permissions.md` (e.g. Finance = none-by-default for CHILD regardless of sensitivity, Audit = own-activity-only for ADULT) | High | Fixed default-deny base policy (see [ARCHITECTURE_AUDIT.md](../audit/ARCHITECTURE_AUDIT.md) §Authorization); Phase 1 must layer feature-level policies (`authorizeTaskAccess`, `authorizeFinanceAccess`, ...) on top of this base, and Finance/Audit records must never be classified `sensitivity: NORMAL` |
| No `vitest.config.ts` / `playwright.config.ts` / `drizzle.config.ts` / `eslint.config.js` in the repo | High | `pnpm-lock.yaml` was generated during Phase 0 validation (`pnpm install`, verified `tsc --noEmit` and `vitest run` both pass — see [ARCHITECTURE_AUDIT.md](../audit/ARCHITECTURE_AUDIT.md)). The four config files remain a Phase 1 entry requirement before any schema/test/lint work begins |
| `app/` contains only route-group placeholder folders (no root `layout.tsx`/`page.tsx`) | High | expected for Phase 0; `next build`/`next dev` will not run until Phase 1 foundation work adds them |
