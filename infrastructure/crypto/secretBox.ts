import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticated encryption for external credentials at rest.
 *
 * CLAUDE.md §7 forbids keeping long-lived external secrets in ordinary
 * domain tables, §8 forbids custom cryptography, and the threat model
 * says to "assume backups may eventually be accessed by an attacker".
 * Those three together decide almost everything here:
 *
 * - **AES-256-GCM from Node's own `crypto`.** Not a hand-rolled scheme,
 *   and not encrypt-then-hope: GCM is an AEAD, so a modified ciphertext
 *   fails to open rather than decrypting to rubbish that some caller then
 *   sends to a provider.
 * - **The key never lives in the database.** It comes from the
 *   environment, so a stolen dump — or a backup — is ciphertext and
 *   nothing else. This is the property that makes the backup assumption
 *   survivable.
 * - **A keyring, not a key.** Every sealed value names the key that
 *   sealed it, so a new key can be introduced and the old one kept for
 *   reading while values are re-sealed. "Credential rotation" is in
 *   docs/integrations/integration-contracts.md's list of things every
 *   adapter must support; rotation you cannot perform without downtime is
 *   rotation nobody performs.
 * - **Additional authenticated data.** The context a secret belongs to
 *   (household, connection, purpose) is bound into the tag. Copying a row
 *   from one connection to another produces a value that will not open,
 *   so a database-level tamper cannot repoint a credential at a different
 *   integration.
 *
 * Format: `<keyId>.<iv>.<tag>.<ciphertext>`, each part base64url. The key
 * id is outside the ciphertext by necessity — you need it to choose a key
 * — and is not a secret.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Keyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export class CredentialCryptoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CredentialCryptoError";
    this.code = code;
  }
}

/**
 * Builds a keyring from configuration.
 *
 * @param spec `id:base64key` entries, comma-separated. Ids are short and
 *   arbitrary ("v1", "2026-09"); the base64 must decode to exactly 32
 *   bytes.
 * @param activeKeyId which key new values are sealed with. Every other
 *   key stays available for opening old ones.
 *
 * Throws rather than degrading. A misconfigured keyring means the app
 * cannot safely store a credential, and starting up as though it could —
 * then failing at the moment somebody connects an integration — would be
 * worse than refusing.
 */
export function parseKeyring(spec: string | undefined, activeKeyId: string | undefined): Keyring {
  const entries = (spec ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new CredentialCryptoError("NO_KEYS", "No credential encryption keys are configured.");
  }

  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new CredentialCryptoError("MALFORMED_KEY", "Each key must be written as id:base64key.");
    }

    const id = entry.slice(0, separator).trim();
    const material = Buffer.from(entry.slice(separator + 1).trim(), "base64");

    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      throw new CredentialCryptoError("MALFORMED_KEY", "A key id must be 1-32 characters of [A-Za-z0-9_-].");
    }
    if (keys.has(id)) {
      throw new CredentialCryptoError("DUPLICATE_KEY", `The key id "${id}" appears more than once.`);
    }
    if (material.length !== KEY_BYTES) {
      // Short keys are the classic way an "encrypted" store turns out not
      // to be. openssl rand -base64 32 produces the right length.
      throw new CredentialCryptoError("BAD_KEY_LENGTH", `Key "${id}" must decode to exactly ${KEY_BYTES} bytes.`);
    }

    keys.set(id, material);
  }

  const active = activeKeyId?.trim() ?? "";
  if (!keys.has(active)) {
    throw new CredentialCryptoError("NO_ACTIVE_KEY", "The active key id is not one of the configured keys.");
  }

  // Two identical keys under different ids would make rotation a no-op
  // while looking like it worked.
  const seen: Buffer[] = [];
  for (const material of keys.values()) {
    if (seen.some((other) => timingSafeEqual(other, material))) {
      throw new CredentialCryptoError("DUPLICATE_KEY", "Two key ids share the same key material.");
    }
    seen.push(material);
  }

  return { activeKeyId: active, keys };
}

const encode = (buffer: Buffer) => buffer.toString("base64url");

/**
 * Seals a secret with the keyring's active key.
 *
 * @param aad the context this secret belongs to. The same string must be
 *   supplied to open it, so it must be derived from stable facts — see
 *   credentialContext().
 */
export function sealSecret(keyring: Keyring, plaintext: string, aad: string): string {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new CredentialCryptoError("NO_ACTIVE_KEY", "The active key is missing from the keyring.");

  // A fresh random IV per call. Reusing one under the same key is the
  // single way to break GCM completely.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [keyring.activeKeyId, encode(iv), encode(tag), encode(ciphertext)].join(".");
}

/**
 * Opens a sealed secret, or throws.
 *
 * Never returns a partial or "best effort" result: a failure here means
 * the value was tampered with, sealed for a different context, or sealed
 * with a key this deployment no longer has, and all three are reasons to
 * stop rather than proceed with something that looks like a credential.
 */
export function openSecret(keyring: Keyring, sealed: string, aad: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4) {
    throw new CredentialCryptoError("MALFORMED_VALUE", "Sealed value is not in the expected format.");
  }

  const [keyId, ivPart, tagPart, ciphertextPart] = parts;
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new CredentialCryptoError("UNKNOWN_KEY", `No key "${keyId}" is configured; it may have been retired early.`);
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CredentialCryptoError("MALFORMED_VALUE", "Sealed value has a malformed nonce or tag.");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // The underlying error is deliberately swallowed: it distinguishes
    // failure modes an attacker would like distinguished.
    throw new CredentialCryptoError("AUTHENTICATION_FAILED", "This credential could not be opened.");
  }
}

/** Which key sealed a value, without opening it — for rotation reporting. */
export function keyIdOf(sealed: string): string | null {
  const keyId = sealed.split(".")[0];
  return keyId && /^[A-Za-z0-9_-]{1,32}$/.test(keyId) ? keyId : null;
}

/**
 * Re-seals a value under the active key.
 *
 * Returns null when it is already current, so a rotation pass can skip
 * rows without writing them.
 */
export function resealSecret(keyring: Keyring, sealed: string, aad: string): string | null {
  if (keyIdOf(sealed) === keyring.activeKeyId) return null;
  return sealSecret(keyring, openSecret(keyring, sealed, aad), aad);
}

/**
 * The context a credential is bound to.
 *
 * Included in the AEAD tag, so a row lifted from one connection and
 * pasted into another will not open. The parts are ids rather than
 * anything mutable — a context that changed when somebody renamed an
 * integration would lock the household out of its own credential.
 */
export function credentialContext(householdId: string, connectionId: string, purpose: string): string {
  return `medfamily:credential:v1:${householdId}:${connectionId}:${purpose}`;
}
