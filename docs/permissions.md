# Permissions Matrix

| Resource | Owner/Admin | Adult | Child | Viewer |
|---|---|---|---|---|
| Household settings | full | limited | none | none |
| People | full | household-scoped | self/allowed | read allowed |
| Tasks | full | create/read/update allowed | assigned/self only | read |
| Cases | full | allowed scope | explicitly assigned only | read allowed |
| Finance | full | allowed | none by default | none by default |
| Documents | full | sensitivity-scoped | explicit only | read allowed |
| Trips | full | allowed | participant-safe view | read |
| Assets | full | allowed | explicit | read |
| Audit | full | security-relevant own activity only | none | none |
| Integrations | full | none by default | none | none |
| Backup status | full | none | none | none |
| Assistant | full | on cases they may change | none | none |
| Export | own visible records | own visible records | own visible records | own visible records |

Two rows need their reasoning stated, because neither is obvious from the
others.

**Backup status** is deliberately stricter than the "Household settings"
row it would otherwise fall under, where an Adult has limited (read-only)
access. Everything on that page is a read of the whole household: row
counts per table, including tables the reader is filtered out of. "There
are 14 documents" told to somebody who can open three is the aggregate
form of exactly the enumeration that search and context links are both
careful to prevent.

**Assistant** follows the case it is about, not a role of its own: asking
for a suggestion needs permission to *change* that case, because proposing
an edit to somebody who could never apply it is an interface lying about
what it can do. Accepting one runs the ordinary command, so it is refused
by the same check as typing the change by hand (ADR-027).

**Export** is not a role at all — it is every role, bounded by what that
role can already read. A child's export is small. An export is never a way
to obtain a record the app would not display, which is the single most
important property of the feature: a mistake there is total rather than
partial.

This matrix is a product default, not a substitute for resource-level policy checks.
