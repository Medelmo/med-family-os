# Product Specification

## Product promise

Med Family OS turns household information into **actionable attention**.

The user should be able to answer, within seconds:
- What needs my attention?
- What is due?
- Who is waiting on whom?
- What context do I need?
- What is coming next for the family?
- Where is the authoritative document or source?

## Primary user journeys

### 1. Capture
User records something quickly without deciding its final structure.

### 2. Triage
Inbox is classified into a task, case, event, note, expense, document reference, or discarded item.

### 3. Execute
User sees the next action, context, owner, due date and related records.

### 4. Follow up
Waiting/blocked items have a next follow-up date and accountable party.

### 5. Close
Completion records outcome and preserves history.

### 6. Retrieve
Global search and contextual links make information discoverable.

## Product anti-goals

- banking replacement
- password manager
- document archive
- photo library
- full knowledge base
- smart-home controller
- medical record system
- project-management suite for external teams

## Critical missing concept fixed from original scaffold

The original model listed tasks/cases/deadlines but did not define a **next-action/follow-up model**. This is essential for a household operating system.

Waiting and blocked records must support:
- waitingFor
- waitingSince
- followUpAt
- nextAction
- responsibleParty
- source/context

Without these fields, a waiting list becomes a graveyard.

## Attention score

Attention is a projection, not stored truth.

Inputs:
- overdue
- due-soon window
- priority
- blocked/waiting age
- missing next action
- unresolved reimbursement
- stale external verification
- upcoming warranty
- trip readiness

Rules must be deterministic and explainable. Never show an opaque AI score as the primary attention mechanism.
