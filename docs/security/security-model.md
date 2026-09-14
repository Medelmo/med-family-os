# Security Model

## Trust boundaries

1. Browser <-> application
2. Application <-> PostgreSQL
3. Application <-> external provider
4. Home Assistant <-> HA projection
5. AI provider <-> authorized context
6. Backup store <-> recovery environment

## Authorization

All domain commands execute through a policy-aware application service.

Recommended shape:

`authorize(user, action, resourceContext)`

Policies must be unit tested independently of UI.

## High-risk areas

- BOLA/IDOR
- cross-household data leakage
- child access escalation
- attachment path traversal
- SSRF via external URLs
- malicious imported documents
- OAuth token leakage
- webhook spoofing
- replayed integration events
- CSRF
- XSS in notes/imported content
- rate-limit bypass
- backup exposure
- overly broad HA tokens
- AI context overexposure

## Security controls

- opaque public IDs where useful; never rely on obscurity
- parameterized DB queries through ORM
- input validation
- output encoding
- CSP and secure headers
- secure cookies
- no localStorage for session secrets
- request correlation IDs
- audit security-sensitive actions
- redacted logs
- dependency/container scanning
- image/document MIME and size validation
- SSRF allowlist for provider URLs
- timeouts and bounded retries
- secret rotation procedure

## ASVS target

OWASP ASVS 5.0.0 is the verification baseline.
