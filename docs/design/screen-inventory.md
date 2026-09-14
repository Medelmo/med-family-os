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
32. Expenses — part of 31.
33. Expense detail — **not built.** An expense is currently record-and-
    archive; there is nothing on one worth a page of its own until it can
    be edited or linked to a case.
34. Reimbursements — `/finance/claims` and `/finance/claims/[claimId]`.
    Built. The detail page offers exactly the transitions the state
    machine allows from the claim's current status, so it never presents a
    dead end, and shows the claim's own history.
35. Budgets — part of 31.

## Travel
36. Trips
37. Trip detail
38. Itinerary
39. Packing
40. Accessibility facts

## Assets
41. Assets
42. Asset detail
43. Warranty detail
44. Maintenance

## Integration/Admin
45. Integrations
46. Sync health
47. Home Assistant view
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
