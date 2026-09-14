import { parseKeyring, type Keyring } from "./secretBox";

/**
 * The deployment's credential keyring, read from the environment once.
 *
 * Resolved lazily rather than at startup, and that is a deliberate trade:
 * a household running no integrations at all should not have to generate
 * and manage an encryption key it will never use, and refusing to boot
 * without one would make the common case worse to protect a feature
 * nobody has enabled.
 *
 * The cost is that a misconfigured keyring surfaces when somebody first
 * connects an integration rather than at startup. That is acceptable
 * because it surfaces as a refusal — `parseKeyring` throws — and never as
 * a credential stored in the clear. The failure mode is "you cannot
 * connect this yet", not "we stored your password badly".
 *
 * Cached after the first successful parse: re-reading and re-validating
 * on every credential operation would buy nothing, and the environment
 * does not change under a running process.
 */
let cached: Keyring | null = null;

export function getKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  if (cached) return cached;
  cached = parseKeyring(env.CREDENTIAL_KEYS, env.CREDENTIAL_ACTIVE_KEY);
  return cached;
}

/** Test-only: forget the cached keyring so a different configuration can be used. */
export function resetKeyringCache(): void {
  cached = null;
}

/**
 * Whether this deployment could store a credential if asked.
 *
 * Lets a settings page say "configure CREDENTIAL_KEYS before connecting an
 * integration" instead of offering a form that will fail on submit.
 */
export function isKeyringConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    getKeyring(env);
    return true;
  } catch {
    return false;
  }
}
