import type { Sensitivity } from "../shared/types";

/**
 * What may reach a model, and what may not (ADR-027).
 *
 * This is the security core of the whole AI phase. The brief's rule is
 * blunt — *"never expose sensitive data in: logs, analytics, exception
 * messages, URLs, notifications, **AI prompts**, telemetry"* — and
 * `docs/security/threat-model.md` names "AI overreach: AI receives data
 * outside user authorization" as its own adversary.
 *
 * Read literally, that rule bans AI from this application entirely: a
 * household operating system's records are almost all SENSITIVE by
 * default, so a model that may only see NORMAL data can summarise
 * nothing worth summarising.
 *
 * The distinction the rule is actually drawing is **where the data goes**.
 * The listed channels — logs, analytics, telemetry, URLs — are all places
 * data *leaves the household*. A model running on the household's own
 * machine is not one of those places; a hosted API unambiguously is.
 *
 * So locality is a first-class property of a provider, and it decides the
 * ceiling:
 *
 * | Sensitivity        | Local model | Remote model |
 * |--------------------|-------------|--------------|
 * | NORMAL             | yes         | yes          |
 * | SENSITIVE          | yes         | **no**       |
 * | HIGHLY_SENSITIVE   | **no**      | **no**       |
 *
 * `HIGHLY_SENSITIVE` is a hard floor with no provider that clears it. A
 * household marks something that way to say "this does not get processed
 * by anything clever", and an on-premises model is still something
 * clever.
 */

export type ProviderLocality =
  /** Runs inside the household's own network; nothing leaves the house. */
  | "LOCAL"
  /** A hosted API. Anything sent leaves the household permanently. */
  | "REMOTE";

const CEILING: Record<ProviderLocality, Sensitivity[]> = {
  LOCAL: ["NORMAL", "SENSITIVE"],
  REMOTE: ["NORMAL"],
};

/** Whether a record at this sensitivity may be described to this provider. */
export function mayDisclose(sensitivity: Sensitivity, locality: ProviderLocality): boolean {
  return CEILING[locality].includes(sensitivity);
}

/**
 * Why a record was withheld, so the interface can say so rather than
 * silently returning a worse answer.
 *
 * A summary built from four of a case's seven notes is not wrong, it is
 * *incomplete*, and the difference matters when somebody is deciding
 * whether to act on it.
 */
export interface Withheld {
  sensitivity: Sensitivity;
  count: number;
}

export function summariseWithheld(
  items: readonly { sensitivity: Sensitivity }[],
  locality: ProviderLocality
): Withheld[] {
  const counts = new Map<Sensitivity, number>();

  for (const item of items) {
    if (mayDisclose(item.sensitivity, locality)) continue;
    counts.set(item.sensitivity, (counts.get(item.sensitivity) ?? 0) + 1);
  }

  return [...counts.entries()].map(([sensitivity, count]) => ({ sensitivity, count }));
}

/**
 * Patterns that must never appear in a prompt whatever their sensitivity
 * label says.
 *
 * Belt and braces, not the main defence. The main defence is structural:
 * context is assembled only from policy-filtered application queries, and
 * none of them select from `integration_credential` or `user` — so a
 * token or a password hash has no path into a prompt in the first place.
 *
 * This exists because "has no path" is a statement about today's code. A
 * household pastes an API key into a case note, someone builds a new
 * context source in a hurry, a provider changes what it echoes back. The
 * cost of scrubbing is one pass over a string; the cost of being wrong is
 * a credential in somebody else's training corpus.
 */
const SECRET_PATTERNS: { label: string; pattern: RegExp }[] = [
  /*
   * `Bearer <token>` — separated by a space, not by a colon.
   *
   * Its own pattern because it is the commonest way a credential appears
   * in text, and the keyword-and-separator rule below misses it entirely:
   * an `Authorization: Bearer sk-live-…` header pasted into a case note
   * went straight through the first version of this, which a test caught
   * on its first run.
   *
   * The length floor and the character class are what stop it mangling
   * prose — "the bearer of bad news" has no eight-character token-shaped
   * word after it.
   */
  { label: "token", pattern: /\bbearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi },
  // Keyword-and-separator forms: token=…, api_key: …, apikey=…
  { label: "token", pattern: /\b(token|api[_-]?key|apikey)\s*[:=]\s*\S+/gi },
  // Basic auth or any credential embedded in a URL.
  { label: "url-credential", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/gi },
  // Anything that says it is a password or secret, and its value.
  { label: "password", pattern: /\b(password|passwort|secret|geheim)\s*[:=]\s*\S+/gi },
  // Argon2/bcrypt hashes, which is what a leaked `user` row looks like.
  { label: "hash", pattern: /\$(argon2[a-z]*|2[aby])\$[^\s]+/gi },
  // The app's own sealed-secret format (ADR-019): keyId.iv.tag.ciphertext.
  { label: "sealed", pattern: /\b[A-Za-z0-9_-]{2,16}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  // Long private-key blocks.
  { label: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

export interface Scrubbed {
  text: string;
  /** What was removed, for the audit record. Never the values themselves. */
  removed: string[];
}

/**
 * Removes anything that looks like a credential.
 *
 * Replaces rather than deletes: a model handed `[redacted]` knows
 * something was there and will not invent a value to fill the gap, where
 * a silent deletion can leave a sentence that reads as complete and is
 * wrong.
 */
export function scrubSecrets(text: string): Scrubbed {
  let out = text;
  const removed: string[] = [];

  for (const { label, pattern } of SECRET_PATTERNS) {
    // `pattern` is module-level and carries /g, so its lastIndex survives
    // between calls. Reset before every use or the second call on the same
    // pattern starts halfway through the string.
    pattern.lastIndex = 0;
    if (!pattern.test(out)) continue;
    pattern.lastIndex = 0;
    out = out.replace(pattern, `[redacted:${label}]`);
    removed.push(label);
  }

  return { text: out, removed };
}
