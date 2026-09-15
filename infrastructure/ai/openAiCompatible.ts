import {
  AssistantError,
  type AssistantProvider,
  type CompletionRequest,
} from "../../application/ai/assistantProvider";
import type { ProviderLocality } from "../../domain/ai/disclosure";

/**
 * An adapter for any server speaking the OpenAI chat-completions shape
 * (ADR-027).
 *
 * That is one adapter for Ollama, llama.cpp, LM Studio, vLLM, LocalAI and
 * text-generation-webui — every way a household is realistically going to
 * run a model on their own hardware. Picking the *protocol* rather than a
 * product is what keeps this a single file.
 *
 * Configured from the environment, not from a database row. An assistant
 * is a deployment fact for a self-hosted application — the same shape as
 * the Home Assistant token and the credential keyring — and unset means
 * the feature is simply not there, which is CLAUDE.md §11's "AI is
 * optional and cannot be required for core operation" implemented rather
 * than promised.
 */

/**
 * How long to wait for an answer.
 *
 * Generous, and configurable, because the realistic deployment is a model
 * on the household's own hardware rather than a hosted API: a 7B model
 * loading cold on a CPU took 62 seconds in testing, which a 45-second
 * timeout turned into "the assistant took too long to answer" on every
 * first request of the day. A household running something bigger, or
 * smaller, can say so.
 */
export const ASSISTANT_TIMEOUT_MS = Number(process.env.ASSISTANT_TIMEOUT_MS ?? 120_000);

export interface AssistantConfig {
  baseUrl: string;
  model: string;
  locality: ProviderLocality;
  /** Optional; a local model usually needs none. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Reads the configuration, or returns null when there is none.
 *
 * **Locality must be stated explicitly.** It is tempting to infer it —
 * "localhost means local" — and that inference is exactly the kind of
 * thing that is right until somebody puts a reverse proxy in front of a
 * hosted API. Since locality decides whether the household's SENSITIVE
 * records may be sent at all, a wrong guess is a data leak, so an
 * unrecognised or missing value disables the assistant rather than
 * defaulting to the permissive answer.
 */
export function readAssistantConfig(
  // The looser type is the honest one: this reads four optional strings
  // and does not care whether NODE_ENV is among them, which `ProcessEnv`
  // insists on and which makes the function untestable without faking a
  // whole environment.
  env: Record<string, string | undefined> = process.env
): AssistantConfig | null {
  const baseUrl = env.ASSISTANT_BASE_URL?.trim();
  const model = env.ASSISTANT_MODEL?.trim();
  const locality = env.ASSISTANT_LOCALITY?.trim().toUpperCase();

  if (!baseUrl || !model) return null;
  if (locality !== "LOCAL" && locality !== "REMOTE") return null;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    locality,
    apiKey: env.ASSISTANT_API_KEY?.trim() || undefined,
  };
}

export function createAssistantProvider(config: AssistantConfig): AssistantProvider {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    model: config.model,
    locality: config.locality,

    async complete(request: CompletionRequest, signal: AbortSignal): Promise<string> {
      let response: Response;

      try {
        response = await doFetch(`${config.baseUrl}/v1/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
            max_tokens: request.maxTokens,
            // Low but not zero. Zero makes a model repeat one phrasing
            // forever, which for "suggest a next action" means the same
            // suggestion on every case.
            temperature: 0.2,
            stream: false,
          }),
        });
      } catch (error) {
        // The cause's own text is never repeated: an underlying fetch
        // error names the URL it was called with, and a URL can carry a
        // key.
        throw new AssistantError(
          isAbort(error) ? "timeout" : "unreachable",
          isAbort(error) ? "The assistant took too long to answer." : "The assistant could not be reached."
        );
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AssistantError("refused", "The assistant refused the request.");
        }
        throw new AssistantError("unreachable", "The assistant could not be reached.");
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new AssistantError("malformed", "The assistant returned something this app could not read.");
      }

      const answer = firstMessage(body);

      if (answer.kind === "truncated") {
        /*
         * A reasoning model that thought until it ran out of room.
         *
         * Models like qwen3 and deepseek-r1 emit their chain of thought in
         * a separate field and only then write an answer — so a token
         * budget sized for the answer alone produces an empty `content`
         * with `finish_reason: "length"`, every time. Reported as its own
         * failure rather than as "malformed", because the remedy is
         * completely different: raise the budget or pick a model that does
         * not think out loud, rather than suspect the server.
         */
        throw new AssistantError("unusable", "The assistant did not suggest anything usable.");
      }

      if (answer.kind !== "ok") {
        throw new AssistantError("malformed", "The assistant returned something this app could not read.");
      }

      return answer.text;
    },
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

type Reply =
  | { kind: "ok"; text: string }
  /** The model ran out of tokens before writing an answer. */
  | { kind: "truncated" }
  | { kind: "unreadable" };

/**
 * Pulls the reply out, checking every step rather than trusting the shape.
 *
 * This is a response from a program the household installed, over a
 * protocol six different projects implement with varying fidelity. A
 * `choices[0].message.content` that assumes its way down the chain throws
 * a `TypeError` on the first server that does it slightly differently, and
 * a `TypeError` surfaces as a 500 rather than as "the assistant returned
 * something this app could not read".
 *
 * It also distinguishes *empty because truncated* from *empty because
 * broken*. Found by pointing this at a real Ollama: a reasoning model
 * returned `content: ""` with the whole answer still in its thinking
 * field and `finish_reason: "length"`, which is a budget problem wearing
 * the costume of a protocol problem.
 */
function firstMessage(body: unknown): Reply {
  if (typeof body !== "object" || body === null) return { kind: "unreadable" };

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return { kind: "unreadable" };

  const first = choices[0];
  if (typeof first !== "object" || first === null) return { kind: "unreadable" };

  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return { kind: "unreadable" };

  const content = (message as { content?: unknown }).content;
  const text = typeof content === "string" ? content.trim() : "";

  if (text.length > 0) return { kind: "ok", text };

  const finish = (first as { finish_reason?: unknown }).finish_reason;
  if (finish === "length") return { kind: "truncated" };

  return { kind: "unreadable" };
}
