import type { ProviderLocality } from "../../domain/ai/disclosure";

/**
 * The port every model provider implements (ADR-027).
 *
 * Shaped like `DocumentProvider` (ADR-020) for the same reason: the domain
 * must not know that any particular vendor exists. What crosses this line
 * is a prompt this application wrote and a string the model returned —
 * never a chat history, a tool definition, or a provider's own schema.
 *
 * **`locality` is not metadata.** It decides what the provider may be
 * shown at all (`domain/ai/disclosure.ts`), so it is part of the
 * interface rather than part of the configuration, and an adapter cannot
 * be wired up without answering the question.
 */
export interface AssistantProvider {
  /** As the provider reports it, e.g. "llama3.1:8b". Recorded as provenance. */
  readonly model: string;
  /** Whether this model runs inside the household's network. */
  readonly locality: ProviderLocality;

  /**
   * One completion. No streaming, no conversation.
   *
   * Deliberately the smallest possible surface: every capability in this
   * application is "here is some context, produce this one thing", and a
   * chat interface would invite the assistant to become a place people
   * type rather than a thing that proposes.
   */
  complete(request: CompletionRequest, signal: AbortSignal): Promise<string>;
}

export interface CompletionRequest {
  /** The rules. Fixed per capability and versioned as `promptVersion`. */
  system: string;
  /** The context, already policy-filtered and scrubbed. */
  user: string;
  /**
   * A hard ceiling on the reply. A model that rambles costs the household
   * nothing but time; one that rambles into a text column costs storage
   * and makes a suggestion unreadable.
   */
  maxTokens: number;
}

export type AssistantErrorKind =
  | "not_configured"
  | "unreachable"
  | "timeout"
  | "refused"
  | "malformed"
  /** The model answered, but not with anything usable. */
  | "unusable";

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind;

  constructor(kind: AssistantErrorKind, message: string) {
    super(message);
    this.name = "AssistantError";
    this.kind = kind;
  }
}

/**
 * Messages shown for each failure — a fixed table, in this application's
 * own words.
 *
 * The same rule the sync driver learned the hard way in Phase 7: an
 * upstream error routinely names the URL it was called with, and a URL can
 * carry a credential. Nothing a provider says is ever repeated to a
 * person or written to a row.
 */
export const ASSISTANT_FAILURES: Record<AssistantErrorKind, string> = {
  not_configured: "No assistant is configured for this household.",
  unreachable: "The assistant could not be reached.",
  timeout: "The assistant took too long to answer.",
  refused: "The assistant refused the request.",
  malformed: "The assistant returned something this app could not read.",
  unusable: "The assistant did not suggest anything usable.",
};
