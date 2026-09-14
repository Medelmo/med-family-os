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

## Search

Search and links share one rule: **a record is discoverable only if the
actor may read it** (ADR-021 §4, ADR-022 §4). A result list that showed
titles the reader cannot open would be an enumeration channel for exactly
the records a sensitivity level protects — and for most records the title
*is* the disclosure.

This is enforced structurally rather than by care at each call site.
`application/queries/search/search.ts` selects only row ids and relevance
ranks; it never reads a title, description, note or merchant from the
database. Presentation and authorization both happen in `resolveRecords`,
the single function that links also use. Search therefore cannot leak a
title, because it never holds one, and search cannot drift away from links,
because the two are the same code.

Withheld rows are absent. No count of them is reported: "3 results you may
not see" is itself the disclosure.

### The query string

`/search?q=…` is a GET form, so the search term appears in the URL.
CLAUDE.md's rule is that sensitive data must never appear in a URL, and
this is a deliberate, bounded exception: the term is the household's own
words rather than a record's contents, the address never leaves the
household's own machine, and the only place this application writes a URL
is the request log, which records `pathname` and never the query string
(ADR-010).

**If request logging ever starts recording query strings, `/search` must
become a POST-and-redirect.** Nothing else in the application depends on
that property, so it is easy to break without noticing.

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
- record enumeration through search or link titles

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
