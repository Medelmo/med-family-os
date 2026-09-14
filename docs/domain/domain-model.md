# Domain Model

## Aggregates

### Household
Owns the tenancy boundary. All household-scoped data belongs to exactly one household.

### Person
A real human in or associated with the household. A person is not necessarily a login.

### UserAccount
Authentication identity. Links to one or more household memberships.

### HouseholdMembership
User + household + role + status + scope.

### Task
An executable action. A task has exactly one lifecycle and may reference multiple contexts.

### Case
A real-world process with a lifecycle, participants, next action and timeline.

### Deadline
A commitment or due point. A deadline may be linked to a case/task/trip/etc.

### CalendarEvent
A scheduled occurrence, distinct from a deadline.

### Reminder
A delivery instruction for a deadline/task/event/case.

### Organization
A legal/business/administrative entity.

### Contact
A person who acts as a contact for an organization or household matter.

### DocumentReference
Metadata and pointer to an external or local document. The app does not become the document archive.

### Expense
A financial occurrence.

### Reimbursement
A claim/process associated with one or more expenses.

### Budget
A planning envelope, not a bank ledger.

### Trip
A bounded travel context.

### Asset
A durable household object.

### Warranty
Coverage interval associated with an asset.

### Note
Short contextual text, not a replacement for Obsidian.

### AuditEvent
Immutable security/operational record.

### IntegrationConnection
Configured provider connection.

### SyncRun
An observable synchronization attempt with cursor/checkpoint and error information.

### OutboxEvent
Transactional side-effect intent.

## Cross-cutting fields

Where applicable:
- id
- householdId
- createdAt
- updatedAt
- archivedAt
- createdBy
- updatedBy
- version
- visibility
- sensitivity

## Ownership vs visibility

Ownership answers “who is accountable?”
Visibility answers “who may see it?”

Never use ownership as a substitute for authorization.

## Sensitivity

NORMAL:
ordinary household planning.

SENSITIVE:
financial, administrative, personal.

HIGHLY_SENSITIVE:
child-sensitive data, health-related administrative context, authentication/recovery data, highly private notes.

Sensitive fields should be minimized and access logged where justified.

### Person sensitivity (resolved ambiguity — added during Phase 1 implementation)

`Person`'s own core identity fields (display name, date of birth) are
**NORMAL**, not SENSITIVE, by default — despite "personal" data being
listed as SENSITIVE above. A CHILD must be able to see their own profile
and be identifiable by name in shared views (e.g. "assigned to Lukas");
`application/policies/authorize.ts` denies CHILD access to any
non-NORMAL resource outright (CLAUDE.md §5: children never inherit adult
access), so classifying Person itself as SENSITIVE would make a child
unable to see their own name in the app — contradicting
`docs/permissions.md`'s "Child People access: self/allowed" row.

The resolution: "personal" in the SENSITIVE definition above means
sensitive *content* about a person — case details, documents, notes,
financial records — not the bare fact that a household member exists and
has a name/birthday. That content lives on Case/DocumentReference/Note/
Expense, each classified independently and each referencing the person via
`personScopeIds`, not folded into the Person record's own sensitivity.
