import type { IncomingDocument } from "../../domain/documents/documentReference";

/**
 * The port every document provider implements.
 *
 * `docs/architecture/module-boundaries.md` puts integrations behind
 * application/domain ports, and CLAUDE.md §9 says "the core domain must
 * not depend on Paperless/Nextcloud/Home Assistant-specific data types".
 * So this interface speaks in `IncomingDocument` — the domain's own shape
 * — and the adapter is the only code that has ever seen the provider's
 * JSON.
 *
 * §9's checklist for an adapter (capabilities, authentication, rate
 * limits, sync direction, cursor, idempotency key, retry policy, error
 * classification, observability, data mapping, deletion behaviour) is
 * answered partly here and partly by the sync command that drives it:
 *
 * - **capabilities / sync direction**: read-only, one page at a time.
 *   Nothing in this port can write to a provider, which is a deliberate
 *   narrowing — CLAUDE.md §13 says not to recreate Paperless, and an
 *   adapter that can only read cannot damage the system of record.
 * - **cursor**: an opaque string the adapter understands and the caller
 *   only stores. A cursor the application tried to interpret would break
 *   the first time a provider changed its paging.
 * - **idempotency key**: `externalId`, enforced by a unique index rather
 *   than by the adapter behaving well.
 * - **error classification**: `ProviderError.kind`, below.
 * - **retry policy / observability**: the sync run's own state machine.
 * - **deletion behaviour**: out of scope here on purpose — see the note on
 *   `listDocuments`.
 */
export interface DocumentPage {
  documents: IncomingDocument[];
  /** Null when the provider has nothing more to give. */
  nextCursor: string | null;
}

export interface DocumentProvider {
  readonly id: "PAPERLESS" | "NEXTCLOUD";

  /**
   * One page of documents, newest first, starting from `cursor`.
   *
   * Deliberately does **not** report deletions. Knowing that a document
   * vanished from Paperless would require either a full reconciliation
   * every run or a provider-side change feed, and acting on it would mean
   * this app deleting a household's reference because a system it does not
   * own happened to return a shorter list. A reference to a document that
   * has moved is a broken link the household can see and fix; a reference
   * this app silently removed is information nobody can get back.
   */
  listDocuments(cursor: string | null, signal: AbortSignal): Promise<DocumentPage>;
}

/**
 * Why a provider call failed, in terms the sync machine can act on.
 *
 * The distinction that matters is `retryable`: retrying a bad token
 * forever is how an integration ends up locked out, and not retrying a
 * timeout is how a household's documents stop arriving because the router
 * rebooted.
 */
export type ProviderErrorKind = "auth" | "not_found" | "rate_limit" | "network" | "server" | "malformed";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;

  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryable = kind === "rate_limit" || kind === "network" || kind === "server";
  }
}

/**
 * Turns an HTTP status into a classified error.
 *
 * 401 and 403 are `auth` and not retryable: a token that is wrong now
 * will be wrong in five minutes, and hammering an authentication endpoint
 * is how an integration gets the household's account locked.
 */
export function classifyHttpStatus(status: number, detail: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("auth", `The provider rejected the credential (${status}).`);
  if (status === 404) return new ProviderError("not_found", `The provider has no such endpoint (404). ${detail}`);
  if (status === 429) return new ProviderError("rate_limit", "The provider asked us to slow down (429).");
  if (status >= 500) return new ProviderError("server", `The provider failed (${status}).`);
  return new ProviderError("malformed", `Unexpected response from the provider (${status}). ${detail}`);
}
