# ADR-019: External credentials are sealed with AES-256-GCM under a keyring

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 7 (Integrations), foundation

## Context

Before any provider adapter can exist, the application needs somewhere to
keep the credential that adapter authenticates with — a Paperless API
token, a Nextcloud app password, a CalDAV login.

Three constraints decide almost everything:

- CLAUDE.md §7: "Never store passwords or long-lived external secrets in
  ordinary domain tables."
- CLAUDE.md §8: "Never use custom cryptography."
- `docs/security/threat-model.md`: assume backups may eventually be
  accessed by an attacker.

And `docs/integrations/integration-contracts.md` requires every adapter to
support **credential rotation**.

## Decision

### 1. AES-256-GCM from Node's own `crypto`

Not a hand-rolled scheme — §8 — and not encrypt-without-authenticate. GCM
is an AEAD, so a modified ciphertext *fails to open* rather than
decrypting to rubbish that some caller then sends to a provider as though
it were a token.

A fresh random 12-byte nonce per seal. Reusing one under the same key is
the single way to break GCM completely, so it is generated, never derived
and never stored separately.

### 2. The key never touches the database

It comes from the environment (`CREDENTIAL_KEYS`), so a stolen dump — or,
more realistically, a backup that ends up somewhere it should not — is
ciphertext and nothing else. This is the property that makes the threat
model's backup assumption survivable, and `.env.example` says so in as
many words.

### 3. A keyring, not a key

Configuration is `id:base64key` entries plus an active id. Every sealed
value names the key that sealed it, so:

- a new key can be introduced while the old one stays readable,
- values are re-sealed under the active key by `resealSecret`, which
  returns null for anything already current so a rotation pass skips rows
  it does not need to write,
- the old key can then be dropped.

Rotation that requires downtime is rotation nobody performs, which is the
same as having none.

`parseKeyring` refuses a duplicate id, and refuses two ids that share the
same key material — the second would make a rotation a no-op while looking
like it had worked.

### 4. Context is bound into the tag

The AAD is `medfamily:credential:v1:<householdId>:<connectionId>:<purpose>`.
A row lifted from one connection and pasted into another produces a value
that will not open, so a database-level tamper cannot repoint a credential
at a different integration, a different household, or a different use.

The parts are ids, never anything mutable. A context that changed when
somebody renamed an integration would lock the household out of its own
credential.

### 5. Failures say one thing

Every failure to open — wrong context, tampered ciphertext, tampered tag,
tampered nonce — raises the same message. The underlying error is
swallowed because it distinguishes failure modes an attacker would like
distinguished. A test asserts the two most different causes produce
identical text.

### 6. A 32-byte key, refused if shorter

A short key is the classic way an "encrypted" store turns out not to be.
`parseKeyring` requires exactly 32 bytes after base64 decoding and throws
otherwise, and `.env.example` gives the `openssl rand -base64 32` that
produces one.

### 7. The keyring is resolved lazily, not at startup

A household running no integrations should not have to generate and manage
a key it will never use, and refusing to boot without one would make the
common case worse to protect a feature nobody has enabled.

The cost is that a misconfigured keyring surfaces when somebody first
connects an integration rather than at boot. That is acceptable **because
it surfaces as a refusal**: `parseKeyring` throws, and the failure mode is
"you cannot connect this yet", never "we stored your password badly".
`isKeyringConfigured` lets a settings page say so before offering a form
that would fail on submit.

## Consequences

- Credentials will live in their own table, holding ciphertext and a key
  id, joined to nothing and selected by no domain query — §7's "not in
  ordinary domain tables" taken literally.
- Losing `CREDENTIAL_KEYS` means losing every stored credential, and no
  amount of database access recovers them. That is the point, and it is
  what the household must back up separately from the database.
- The sealed format (`keyId.iv.tag.ciphertext`, base64url) is versioned by
  the `v1` inside the AAD rather than by a byte in the payload, so a
  future scheme change is a new context string and a migration that
  re-seals, not an ambiguity in the parser.
- This commit is foundation with no caller yet, which is a deliberate
  exception to "build vertically": it is security-critical, it is fully
  tested on its own, and writing it *after* an adapter would mean writing
  an adapter that stores a token somewhere temporary first.
