# Quality Gates

Before a phase is complete:

## Functional
- critical flows work
- state transitions reject invalid operations
- empty/loading/error states exist

## Security
- authorization tests pass
- cross-household tests pass
- child escalation tests pass
- no sensitive data in HA
- no secrets in logs

## Accessibility
- keyboard-only critical flows
- focus visibility
- screen reader labels
- WCAG 2.2 AA automated checks where possible
- manual review of complex widgets

## Reliability
- database unavailable behavior
- integration unavailable behavior
- retry behavior
- idempotency

## Data
- migration up/down strategy where appropriate
- export tested
- backup/restore tested for release-critical changes

## UI
- desktop/tablet/mobile
- 390px mobile baseline
- 1440px desktop baseline
- no clipped/overlapping content
