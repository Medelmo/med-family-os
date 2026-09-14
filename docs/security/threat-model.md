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

### Backup compromise
Raw PostgreSQL dump exposes household data.

Mitigation: encrypted backup destination, access control, retention, restore drills.

## Security acceptance

No critical/high authorization bypass may remain at release.
