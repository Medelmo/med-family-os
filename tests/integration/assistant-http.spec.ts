import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssistantProvider } from "../../infrastructure/ai/openAiCompatible";
import { AssistantError } from "../../application/ai/assistantProvider";

/**
 * The adapter against a real HTTP server.
 *
 * The unit tests stub `fetch`, which proves the parsing and leaves the
 * transport untested — headers actually serialised, a body actually
 * written, a socket actually closed. This runs the same adapter over a
 * loopback server that speaks the OpenAI shape, which is what Ollama,
 * llama.cpp and LM Studio all are from this code's point of view.
 *
 * Prompted by pointing the app at a real Ollama and finding two things no
 * stub would have shown: a reasoning model that answers with an empty
 * `content`, and a cold start slower than the timeout.
 */

let server: Server;
let baseUrl: string;
let lastRequest: { headers: Record<string, unknown>; body: string } | null = null;
let nextResponse: { status: number; body: string; delayMs?: number } = {
  status: 200,
  body: JSON.stringify({ choices: [{ message: { content: "Bescheid anfordern" }, finish_reason: "stop" }] }),
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      lastRequest = { headers: req.headers as Record<string, unknown>, body };
      const send = () => {
        res.writeHead(nextResponse.status, { "content-type": "application/json" });
        res.end(nextResponse.body);
      };
      if (nextResponse.delayMs) setTimeout(send, nextResponse.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const provider = (apiKey?: string) =>
  createAssistantProvider({ baseUrl, model: "test:1b", locality: "LOCAL", apiKey });

const signal = () => new AbortController().signal;

describe("the adapter over real HTTP", () => {
  it("completes a request end to end", async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({ choices: [{ message: { content: "Bescheid anfordern" }, finish_reason: "stop" }] }),
    };

    const text = await provider().complete(
      { system: "rules", user: "Case: Pflegegrad", maxTokens: 512 },
      signal()
    );

    expect(text).toBe("Bescheid anfordern");

    const sent = JSON.parse(lastRequest!.body);
    expect(sent.model).toBe("test:1b");
    expect(sent.stream).toBe(false);
    expect(sent.messages[1].content).toContain("Pflegegrad");
    expect(lastRequest!.headers["content-type"]).toContain("application/json");
  });

  it("sends the key as a bearer header when there is one", async () => {
    await provider("sk-test-key").complete({ system: "", user: "", maxTokens: 10 }, signal());
    expect(lastRequest!.headers.authorization).toBe("Bearer sk-test-key");
  });

  it("sends no authorization at all when there is no key", async () => {
    await provider().complete({ system: "", user: "", maxTokens: 10 }, signal());
    expect(lastRequest!.headers.authorization).toBeUndefined();
  });

  // The exact reply a real qwen3 gave through Ollama.
  it("reports a real reasoning model's empty answer as unusable", async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        id: "chatcmpl-431",
        model: "qwen3.5",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "", reasoning: "Thinking Process: 1. Analyze the request…" },
            finish_reason: "length",
          },
        ],
      }),
    };

    const error = await provider()
      .complete({ system: "", user: "", maxTokens: 60 }, signal())
      .catch((e) => e);

    expect(error).toBeInstanceOf(AssistantError);
    expect(error.kind).toBe("unusable");
  });

  it("gives up when the signal aborts, and calls it a timeout", async () => {
    nextResponse = { status: 200, body: "{}", delayMs: 3000 };

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);

    const error = await provider()
      .complete({ system: "", user: "", maxTokens: 10 }, controller.signal)
      .catch((e) => e);

    expect(error).toBeInstanceOf(AssistantError);
    expect(error.kind).toBe("timeout");
    // Never the transport's own words, which name the URL.
    expect(error.message).not.toContain("127.0.0.1");
  });

  it("classifies a rejected key as refused", async () => {
    nextResponse = { status: 401, body: JSON.stringify({ error: "invalid api key sk-real-one" }) };

    const error = await provider("wrong")
      .complete({ system: "", user: "", maxTokens: 10 }, signal())
      .catch((e) => e);

    expect(error.kind).toBe("refused");
    // The server echoed a key back; it must not reach the household.
    expect(error.message).not.toContain("sk-real-one");
  });

  it("reports a non-JSON body as malformed rather than throwing", async () => {
    nextResponse = { status: 200, body: "<html>proxy error</html>" };

    const error = await provider()
      .complete({ system: "", user: "", maxTokens: 10 }, signal())
      .catch((e) => e);

    expect(error).toBeInstanceOf(AssistantError);
    expect(error.kind).toBe("malformed");
  });

  it("reports a closed port as unreachable", async () => {
    const dead = createAssistantProvider({
      // Port 1 is reserved and nothing listens on it.
      baseUrl: "http://127.0.0.1:1",
      model: "test:1b",
      locality: "LOCAL",
    });

    const error = await dead.complete({ system: "", user: "", maxTokens: 10 }, signal()).catch((e) => e);
    expect(error).toBeInstanceOf(AssistantError);
    expect(error.kind).toBe("unreachable");
  });
});
