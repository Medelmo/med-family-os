# Threat Model

## Assets

- household data
- child-sensitive data
- financial data
- document references
- external integration credentials
- AI context
- backup data
- audit history

## Adversaries

- unauthenticated internet attacker
- authenticated low-privilege household user
- compromised browser session
- malicious imported content
- compromised integration endpoint
- accidental operator error
- backup theft

## Abuse cases

### BOLA
User changes `/cases/{id}` to another household's ID.

Mitigation: household membership + resource policy at service boundary.

### Child escalation
Child calls a direct API to retrieve adult financial data.

Mitigation: explicit sensitivity policy; never infer permission from navigation.

### SSRF
User provides a URL that causes server to fetch internal network resources.

Mitigation: provider-specific allowlists; no arbitrary URL fetch endpoint.

### Webhook replay
Old provider event is submitted repeatedly.

Mitigation: signature validation + event ID/idempotency store.

### AI overreach
AI receives data outside user authorization.

Mitigation: retrieve only through policy-filtered application queries.

Implemented in ADR-027, with three layers rather than one:

1. **Authorization.** Context is assembled only by calling the same
   queries the screens call (`getCase`), which refuse a record the actor
   may not read. There is no second path to the data.
2. **Disclosure ceiling.** On top of authorization, what a model may be
   shown depends on where it runs: a remote model sees NORMAL only, a
   local model may also see SENSITIVE, and nothing sees
   HIGHLY_SENSITIVE. Above the ceiling nothing is described at all — not
   the title, not that the record exists — and the refusal is audited.
3. **Secret scrubbing.** A belt behind the structural braces: anything
   resembling a token, password, hash or sealed value is replaced before
   the prompt is sent, and what was removed is recorded as provenance.

And the mutation side is closed by construction rather than by rule:
accepting a suggestion runs the ordinary domain command with the
accepting person as the actor, so there is no code path from a model's
output to a row.

### Backup compromise
Raw PostgreSQL dump exposes household data.

Mitigation: encrypted backup destination, access control, retention, restore drills.

## Security acceptance

No critical/high authorization bypass may remain at release.
