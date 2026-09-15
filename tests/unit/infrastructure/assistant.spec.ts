import { describe, expect, it, vi } from "vitest";
import {
  createAssistantProvider,
  readAssistantConfig,
} from "../../../infrastructure/ai/openAiCompatible";
import { AssistantError } from "../../../application/ai/assistantProvider";

/**
 * The model adapter.
 *
 * Several of these come directly from pointing it at a real Ollama rather
 * than from imagination — the reasoning-model case in particular, which no
 * amount of reading the OpenAI spec would have suggested.
 */

const BASE = { ASSISTANT_BASE_URL: "http://ollama.internal:11434", ASSISTANT_MODEL: "llama3.1:8b" };

function respondWith(body: unknown, init: ResponseInit = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: 200,
      ...init,
    });
  });
  return { calls, fetchImpl: impl as unknown as typeof fetch };
}

const reply = (content: string, finish = "stop") => ({
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
});

const provider = (fetchImpl: typeof fetch, locality: "LOCAL" | "REMOTE" = "LOCAL") =>
  createAssistantProvider({
    baseUrl: "http://ollama.internal:11434",
    model: "llama3.1:8b",
    locality,
    fetchImpl,
  });

const signal = () => new AbortController().signal;

describe("reading the configuration", () => {
  it("needs a base URL, a model, and an explicit locality", () => {
    expect(readAssistantConfig({ ...BASE, ASSISTANT_LOCALITY: "LOCAL" })).toMatchObject({
      model: "llama3.1:8b",
      locality: "LOCAL",
    });
  });

  /**
   * The most important test in this file.
   *
   * Locality decides whether the household's SENSITIVE records may be sent
   * at all, so a missing or unrecognised value must disable the assistant
   * rather than fall back to the permissive answer. There is deliberately
   * no inference from the hostname: "localhost means local" stops being
   * true the moment somebody puts a proxy in front of a hosted API, and a
   * wrong guess there is a data leak.
   */
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["nonsense", "yes"],
    ["a hostname", "localhost"],
    ["on-prem, which is not the word", "ONPREM"],
  ])("refuses to run with %s locality", (_label, locality) => {
    expect(readAssistantConfig({ ...BASE, ASSISTANT_LOCALITY: locality })).toBeNull();
  });

  it("is off when nothing is configured, which is how AI stays optional", () => {
    expect(readAssistantConfig({})).toBeNull();
    expect(readAssistantConfig({ ASSISTANT_LOCALITY: "LOCAL" })).toBeNull();
  });

  it("refuses a base URL that is not http(s)", () => {
    for (const url of ["file:///etc/passwd", "ftp://host/x", "not a url"]) {
      expect(readAssistantConfig({ ...BASE, ASSISTANT_BASE_URL: url, ASSISTANT_LOCALITY: "LOCAL" })).toBeNull();
    }
  });

  it("accepts either case for locality, and trims", () => {
    expect(readAssistantConfig({ ...BASE, ASSISTANT_LOCALITY: " local " })).toMatchObject({ locality: "LOCAL" });
  });
});

describe("asking for a completion", () => {
  it("sends the system and user messages, and does not stream", async () => {
    const { calls, fetchImpl } = respondWith(reply("Bescheid anfordern"));
    await provider(fetchImpl).complete({ system: "rules", user: "context", maxTokens: 512 }, signal());

    expect(calls[0].url).toBe("http://ollama.internal:11434/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.messages).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "context" },
    ]);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(512);
  });

  it("returns the trimmed reply", async () => {
    const { fetchImpl } = respondWith(reply("  Bescheid anfordern  "));
    const text = await provider(fetchImpl).complete({ system: "", user: "", maxTokens: 512 }, signal());
    expect(text).toBe("Bescheid anfordern");
  });

  it("sends no authorization header when there is no key", async () => {
    const { calls, fetchImpl } = respondWith(reply("x"));
    await provider(fetchImpl).complete({ system: "", user: "", maxTokens: 10 }, signal());
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe("when the model does not cooperate", () => {
  /**
   * Found by running against a real local model.
   *
   * qwen3 emits its chain of thought in a separate `reasoning` field and
   * only then writes an answer — so with a budget sized for the answer it
   * returns `content: ""` and `finish_reason: "length"`, every single
   * time. That is a budget problem wearing the costume of a protocol
   * problem, and telling them apart is the difference between "raise the
   * limit" and "your server is broken".
   */
  it("reports a reasoning model that ran out of room as unusable, not malformed", async () => {
    const { fetchImpl } = respondWith({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "", reasoning: "Thinking Process: 1. Analyze…" },
          finish_reason: "length",
        },
      ],
    });

    const error = await provider(fetchImpl)
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);

    expect(error).toBeInstanceOf(AssistantError);
    expect(error.kind).toBe("unusable");
  });

  it("reports an empty reply that was not truncated as malformed", async () => {
    const { fetchImpl } = respondWith(reply("", "stop"));
    const error = await provider(fetchImpl)
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);
    expect(error.kind).toBe("malformed");
  });

  // Six projects implement this protocol with varying fidelity. None of
  // these may become a TypeError, which would surface as a 500.
  it.each([
    ["not an object", "plain text"],
    ["no choices", { id: "x" }],
    ["empty choices", { choices: [] }],
    ["no message", { choices: [{ index: 0 }] }],
    ["content of the wrong type", { choices: [{ message: { content: 42 } }] }],
    ["null message", { choices: [{ message: null }] }],
  ])("reports %s as malformed rather than throwing", async (_label, body) => {
    const { fetchImpl } = respondWith(body);
    const error = await provider(fetchImpl)
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);

    expect(error).toBeInstanceOf(AssistantError);
    expect(error.kind).toBe("malformed");
  });

  it("classifies a rejected key as refused, which is not retried", async () => {
    const { fetchImpl } = respondWith("", { status: 401 });
    const error = await provider(fetchImpl)
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);
    expect(error.kind).toBe("refused");
  });

  it("classifies an abort as a timeout", async () => {
    const fetchImpl = (async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      throw abort;
    }) as unknown as typeof fetch;

    const error = await provider(fetchImpl)
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);
    expect(error.kind).toBe("timeout");
  });

  // The rule a credential leak taught the sync driver in Phase 7: an
  // underlying fetch error names the URL it was called with, and a URL can
  // carry a key.
  it("never repeats the underlying error, which could name the key", async () => {
    const fetchImpl = (async () => {
      throw new Error("request to http://user:sk-live-secret@ollama.internal/v1 failed");
    }) as unknown as typeof fetch;

    const error = await provider(fetchImpl)
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);

    expect(error.message).not.toContain("sk-live-secret");
    expect(error.message).not.toContain("ollama.internal");
    expect(error.message).toMatch(/could not be reached/i);
  });
});
