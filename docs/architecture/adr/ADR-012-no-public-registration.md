# ADR-012 No public self-registration: first-run bootstrap + admin-added members

Status: Accepted

## Decision
There is no public sign-up route. The only way an account is created is:
1. **First-run bootstrap** (`/setup`, `application/commands/household/bootstrapHousehold.ts`) —
   creates the first OWNER account and household. Reachable only while zero
   `UserAccount` rows exist; the check runs inside the same transaction as
   the insert.
2. **Admin-added member** (`application/commands/household/addHouseholdMember.ts`) —
   an existing OWNER/ADMIN creates every subsequent account, from inside
   the authenticated app (Settings → Household members), never from a
   public form.

## Context
CLAUDE.md's mission statement: "a private, self-hosted household operating
system for one household." `docs/security/threat-model.md` lists "
unauthenticated internet attacker" as an adversary. A public registration
endpoint is a meaningful, avoidable expansion of that attack surface
(credential-stuffing targets, sign-up spam, account-enumeration surface)
for an application that, by product definition, only ever needs to onboard
the members of one specific family — a fixed, small, known set of people,
added by someone who already has access.

This was not stated explicitly in any scaffold doc, which simply didn't
address it — self-hosted personal apps in general split between "public
sign-up" (wrong fit here) and "admin-provisioned accounts" (the Nextcloud/
Vaultwarden/Immich pattern, which CLAUDE.md's own "System ownership
boundaries" table treats as prior art this app sits alongside). Admin-
provisioned accounts is the correct default for a private, one-household
system and is adopted without further discussion needed.

## Consequences
- No `/register` or `/signup` route exists or should be added without
  superseding this ADR.
- `bootstrapHousehold` must remain a one-time operation — Phase 1 enforces
  this via a same-transaction `count(*) from users` check; there is no
  separate "is setup complete" flag to keep in sync, by design (one less
  piece of state that could drift from reality).
- `addHouseholdMember` requires an OWNER/ADMIN actor
  (`application/policies/household.ts`'s `authorizeAddHouseholdMember`) and
  currently sets a temporary password the OWNER/ADMIN communicates
  out-of-band (no email/SMTP integration exists yet). A "member must change
  password on first login" flow is a reasonable Phase 2+ addition, not
  required for Phase 1's vertical slice.
- If a future requirement needs OAuth (e.g. a household member wants to use
  an existing Google account), that provider is still added *alongside*
  Credentials, not as a public-signup replacement — the account still has
  to be pre-provisioned or explicitly invited by an OWNER/ADMIN.
