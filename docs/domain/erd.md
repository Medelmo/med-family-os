# ERD

```mermaid
erDiagram
  HOUSEHOLD ||--o{ HOUSEHOLD_MEMBERSHIP : has
  USER_ACCOUNT ||--o{ HOUSEHOLD_MEMBERSHIP : joins
  HOUSEHOLD ||--o{ PERSON : contains
  PERSON ||--o{ RELATIONSHIP : participates
  PERSON ||--o{ TASK_PERSON : linked
  TASK ||--o{ TASK_PERSON : links
  HOUSEHOLD ||--o{ TASK : owns
  HOUSEHOLD ||--o{ CASE : owns
  CASE ||--o{ CASE_PERSON : involves
  PERSON ||--o{ CASE_PERSON : participates
  CASE ||--o{ CASE_EVENT : has
  CASE ||--o{ CASE_TASK : contains
  TASK ||--o{ CASE_TASK : links
  CASE ||--o{ DEADLINE : has
  HOUSEHOLD ||--o{ CALENDAR_EVENT : has
  HOUSEHOLD ||--o{ ORGANIZATION : knows
  ORGANIZATION ||--o{ CONTACT : employs
  CASE }o--o{ ORGANIZATION : concerns
  HOUSEHOLD ||--o{ DOCUMENT_REFERENCE : references
  CASE }o--o{ DOCUMENT_REFERENCE : contextualizes
  HOUSEHOLD ||--o{ EXPENSE : records
  EXPENSE ||--o{ REIMBURSEMENT : claims
  HOUSEHOLD ||--o{ TRIP : plans
  TRIP ||--o{ TRIP_PARTICIPANT : includes
  PERSON ||--o{ TRIP_PARTICIPANT : travels
  HOUSEHOLD ||--o{ ASSET : owns
  ASSET ||--o{ WARRANTY : covered_by
  HOUSEHOLD ||--o{ AUDIT_EVENT : records
  HOUSEHOLD ||--o{ INTEGRATION_CONNECTION : configures
  INTEGRATION_CONNECTION ||--o{ SYNC_RUN : executes
  HOUSEHOLD ||--o{ OUTBOX_EVENT : queues
```

### Context links

`CASE }o--o{ DOCUMENT_REFERENCE` is implemented by a single generic
`record_link` table rather than a join table per pair — the same need
applies to expenses, trips, assets, tasks and claims, and twenty-one join
tables would be twenty-one authorization paths. See ADR-021; the rule that
matters is that a link is visible only if the actor may read the record at
the *other* end.

### Database constraints

- every household-owned row has a non-null householdId
- foreign keys are explicit
- unique constraints exist for provider + externalId
- state transitions are enforced in application commands and tested
- timestamps use UTC
- date-only fields use DATE
- monetary values use integer minor units + ISO currency
- no cascade delete across audit history
