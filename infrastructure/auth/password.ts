import { hash, verify } from "@node-rs/argon2";

// ADR-006: Argon2id via @node-rs/argon2 (native binding, not a hand-rolled
// KDF). Defaults already use Argon2id with OWASP-reasonable cost
// parameters; only pin them explicitly where the default would change
// meaning across a library upgrade.
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB, OWASP ASVS/cheat-sheet minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(hashValue, plaintext);
  } catch {
    // @node-rs/argon2 throws on a malformed hash rather than returning
    // false; a malformed stored hash must fail closed, not throw past the
    // sign-in flow.
    return false;
  }
}
