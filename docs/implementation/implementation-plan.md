# Implementation Plan

Build vertically, not by isolated database CRUD.

## Vertical slice 1
Authentication -> household -> person -> policy -> audit.

## Vertical slice 2
Inbox -> task -> deadline -> today -> attention.

## Vertical slice 3
Case -> next action -> waiting -> timeline -> documents.

## Vertical slice 4
Calendar -> reminders -> outbox -> notification provider.

## Vertical slice 5
Finance -> reimbursement -> export.

## Vertical slice 6
Trips -> accessibility verification -> packing.

## Vertical slice 7
Assets -> warranty -> maintenance.

## Vertical slice 8
Provider integrations.

## Vertical slice 9
AI advisory features.

Each slice must be independently usable and tested.
