# Screen Inventory

## Global
1. Login
2. Unlock/re-authentication
3. App shell
4. Global search
5. Command palette
6. Notifications
7. Settings
8. Household members / permissions
9. Audit/security activity

## Attention
10. Dashboard
11. Inbox
12. Today
13. Attention
14. Waiting
15. Calendar

## Workflows
16. Tasks list
17. Task detail
18. Task create/edit
19. Cases list
20. Case detail
21. Case timeline
22. Case create/edit

## Family
23. People list
24. Person profile
25. Relationships

## Context
26. Organizations
27. Organization detail
28. Contacts
29. Documents/references
30. Notes

## Finance
31. Finance overview — `/finance?month=YYYY-MM`. Built. Carries 32 and 35
    rather than splitting them: a month's spend, its envelopes and the
    form that adds to both are one question ("how are we doing this
    month?"), and separating them would mean three navigations to answer
    it.
32. Expenses — part of 31, along with CSV import and export. Import is a
    two-step upload-then-review flow on the same page rather than a route
    of its own: the review is only meaningful next to the month it would
    change.
33. Expense detail — **not built.** An expense is currently record-and-
    archive; there is nothing on one worth a page of its own until it can
    be edited or linked to a case.
34. Reimbursements — `/finance/claims` and `/finance/claims/[claimId]`.
    Built. The detail page offers exactly the transitions the state
    machine allows from the claim's current status, so it never presents a
    dead end, and shows the claim's own history.
35. Budgets — part of 31.

## Travel
36. Trips — `/trips`. Built. Each card leads with readiness in words,
    because "one access question with no answer yet" is the thing worth
    seeing from a list.
37. Trip detail — `/trips/[tripId]`. Built, and carries 38, 39 and 40.
38. Itinerary — part of 37.
39. Packing — part of 37.
40. Accessibility facts — part of 37, and placed **first** on the page:
    they are the only thing on a trip that cannot be fixed the night
    before. An answer always shows who gave it and when (ADR-016).

### Documents

29 is now built as `/documents`: pointers to paperwork that lives in
Paperless or Nextcloud, never a viewer. CLAUDE.md §13 — do not recreate
Paperless.

## Assets
41. Assets — `/assets`. Built. Each card says the two things that matter
    from a list: when the next service is due, and whether it is still
    covered.
42. Asset detail — `/assets/[assetId]`. Built, and carries 43 and 44.
43. Warranty detail — part of 42. A warranty has no page of its own: it is
    a provider, two dates and a reference, and it means nothing apart from
    the thing it covers.
44. Maintenance — part of 42, as an append-only history (ADR-017).

## Integration/Admin
45. Integrations — `/settings/integrations`, reached from `/settings`.
    Built. Owner/admin only, and a member without that role is told so
    rather than shown an empty page.
46. Sync health — part of 45: the last few runs per connection, each with
    its outcome in words and the counts it achieved. Answered from
    persisted runs rather than from whoever happened to be watching
    (ADR-020).
47. Home Assistant view — `/ha`, plus `GET /api/ha/summary`. Built, and
    deliberately outside the app shell and outside the navigation: it is a
    target for a dashboard embed, not a destination people browse to. It
    carries counts and dates only, never free text (ADR-018).
48. Export
49. Backup/restore status

## Required responsive states

Every major screen must have:
- desktop
- tablet
- mobile
- loading
- empty
- error
- permission denied
- offline/read-only degradation where relevant
