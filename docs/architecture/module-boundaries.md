# Module Boundaries

## features/family
People, relationships, household membership projections.

## features/tasks
Task aggregate, checklist, recurrence, task commands/queries.

## features/cases
Case aggregate, events, next actions, waiting/blocked logic.

## features/calendar
Calendar events, recurrence, reminders.

## features/documents
Document references and provider abstraction.

## features/finance
Expenses, budgets, reimbursements.

## features/travel
Trips, participants, itinerary, packing, accessibility facts.

## features/assets
Assets, warranties, maintenance.

## features/search
Search projection and ranking.

## features/attention
Deterministic attention rules.

## features/notifications
Reminder scheduling, delivery state, provider abstraction.

## infrastructure
DB, auth adapter, observability, storage.

## integrations
Provider-specific adapters only.

No module imports another module's database schema directly. Use application ports/commands.
