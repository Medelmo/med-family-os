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

This matrix is a product default, not a substitute for resource-level policy checks.
