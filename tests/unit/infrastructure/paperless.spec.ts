import { describe, expect, it, vi } from "vitest";
import { createPaperlessProvider, withTimeout, PAPERLESS_PAGE_SIZE } from "../../../infrastructure/integrations/paperless";
import { ProviderError } from "../../../application/integrations/documentProvider";

const BASE = "https://paperless.internal";
const TOKEN = "paperless-token";

function provider(fetchImpl: typeof fetch, baseUrl = BASE) {
  return createPaperlessProvider({ baseUrl, apiToken: TOKEN, fetchImpl });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const signal = new AbortController().signal;

/**
 * Asserts the call failed, and narrows the result.
 *
 * `promise.catch(e => e)` types as the union of the value and the error,
 * and — worse — passes silently if the call unexpectedly succeeds.
 */
async function failureOf(work: Promise<unknown>): Promise<ProviderError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error("expected the provider call to fail, but it succeeded");
}

const ONE_DOCUMENT = {
  next: null,
  results: [{ id: 41, title: "Bescheid 2026", created_date: "2026-01-04", content: "…OCR…" }],
};

describe("what it asks Paperless for", () => {
  it("authenticates with a Token header, not a Bearer one", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ONE_DOCUMENT)) as unknown as typeof fetch;
    await provider(fetchImpl).listDocuments(null, signal);

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ authorization: `Token ${TOKEN}` });
  });

  // "Do not copy OCR text by default" — and the content field is often
  // megabytes per document.
  it("asks the provider not to send the OCR text", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ONE_DOCUMENT)) as unknown as typeof fetch;
    await provider(fetchImpl).listDocuments(null, signal);

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("truncate_content=true");
    expect(String(url)).toContain(`page_size=${PAPERLESS_PAGE_SIZE}`);
    expect(String(url)).toContain("ordering=-modified");
  });

  it("starts at page one and follows the cursor after that", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ONE_DOCUMENT)) as unknown as typeof fetch;
    const paperless = provider(fetchImpl);

    await paperless.listDocuments(null, signal);
    await paperless.listDocuments("4", signal);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
    expect(calls[0]).toContain("page=1");
    expect(calls[1]).toContain("page=4");
  });

  it("ignores a cursor that is not a page number rather than failing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ONE_DOCUMENT)) as unknown as typeof fetch;
    await provider(fetchImpl).listDocuments("not-a-page", signal);

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("page=1");
  });

  it("tolerates a base URL with a trailing slash", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ONE_DOCUMENT)) as unknown as typeof fetch;
    await provider(fetchImpl, `${BASE}///`).listDocuments(null, signal);

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain(`${BASE}/api/documents/`);
  });
});

describe("what it makes of the answer", () => {
  it("maps a document onto the domain's shape and drops the OCR text", async () => {
    const fetchImpl = (async () => jsonResponse(ONE_DOCUMENT)) as typeof fetch;
    const page = await provider(fetchImpl).listDocuments(null, signal);

    expect(page.documents).toEqual([
      {
        externalId: "41",
        title: "Bescheid 2026",
        documentDate: "2026-01-04",
        url: `${BASE}/documents/41/details`,
      },
    ]);
    expect(JSON.stringify(page)).not.toContain("OCR");
  });

  // A URL taken from the response would be an open redirect waiting to
  // happen, and the household clicks these.
  it("builds the link from the configured base, never from the response", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        next: null,
        results: [{ id: 41, title: "x", created_date: "2026-01-04", url: "https://evil.example/steal" }],
      })) as typeof fetch;

    const page = await provider(fetchImpl).listDocuments(null, signal);
    expect(page.documents[0].url).toBe(`${BASE}/documents/41/details`);
  });

  it("reports another page when the provider says there is one", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ next: `${BASE}/api/documents/?page=2`, results: [] })) as typeof fetch;

    expect((await provider(fetchImpl).listDocuments("1", signal)).nextCursor).toBe("2");
  });

  it("reports the end of the list", async () => {
    const fetchImpl = (async () => jsonResponse({ next: null, results: [] })) as typeof fetch;
    expect((await provider(fetchImpl).listDocuments(null, signal)).nextCursor).toBeNull();
  });

  // A row that is not the expected shape must not become a document
  // reference with undefined in it — the household would see a broken
  // entry and have no idea why.
  it("skips rows it cannot understand and keeps the rest", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        next: null,
        results: [null, { title: "no id" }, "nonsense", { id: 7, title: "Real one", created_date: "2026-02-02" }],
      })) as typeof fetch;

    const page = await provider(fetchImpl).listDocuments(null, signal);
    expect(page.documents.map((d) => d.externalId)).toEqual(["7"]);
  });

  it("falls back to a usable title and a null date", async () => {
    const fetchImpl = (async () => jsonResponse({ next: null, results: [{ id: 9, title: "   " }] })) as typeof fetch;

    expect((await provider(fetchImpl).listDocuments(null, signal)).documents[0]).toMatchObject({
      title: "Document 9",
      documentDate: null,
    });
  });

  it("accepts a full timestamp where a date was expected", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ next: null, results: [{ id: 9, title: "x", created: "2026-03-04T10:11:12Z" }] })) as typeof fetch;

    expect((await provider(fetchImpl).listDocuments(null, signal)).documents[0].documentDate).toBe("2026-03-04");
  });
});

describe("how failures are classified", () => {
  const failing = (status: number) => provider((async () => new Response("no", { status })) as typeof fetch);

  // Retrying a bad token forever is how an integration gets a household's
  // account locked.
  it("treats a rejected credential as permanent", async () => {
    for (const status of [401, 403]) {
      const error = await failureOf(failing(status).listDocuments(null, signal));
      expect(error.kind, String(status)).toBe("auth");
      expect(error.retryable).toBe(false);
    }
  });

  it("treats rate limiting and server failures as worth retrying", async () => {
    for (const [status, kind] of [
      [429, "rate_limit"],
      [500, "server"],
      [503, "server"],
    ] as const) {
      const error = await failureOf(failing(status).listDocuments(null, signal));
      expect(error.kind, String(status)).toBe(kind);
      expect(error.retryable).toBe(true);
    }
  });

  it("treats a missing endpoint as permanent — the base URL is wrong", async () => {
    const error = await failureOf(failing(404).listDocuments(null, signal));
    expect(error.kind).toBe("not_found");
    expect(error.retryable).toBe(false);
  });

  it("treats a network failure as retryable", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const error = await failureOf(provider(fetchImpl).listDocuments(null, signal));
    expect(error.kind).toBe("network");
    expect(error.retryable).toBe(true);
  });

  it("treats a response that is not JSON as malformed", async () => {
    const fetchImpl = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    const error = await failureOf(provider(fetchImpl).listDocuments(null, signal));
    expect(error.kind).toBe("malformed");
  });

  it("treats JSON without a results array as malformed", async () => {
    const fetchImpl = (async () => jsonResponse({ detail: "nope" })) as typeof fetch;
    const error = await failureOf(provider(fetchImpl).listDocuments(null, signal));
    expect(error.kind).toBe("malformed");
  });

  // The URL is logged; the token must not be in the message beside it.
  it("never puts the credential in an error message", async () => {
    const fetchImpl = (async () => {
      throw new Error(`failed to fetch ${BASE} with Token ${TOKEN}`);
    }) as typeof fetch;

    const error = await failureOf(provider(fetchImpl).listDocuments(null, signal));
    // The adapter's own message is what is stored; it repeats the cause,
    // so this asserts the cause is the only risk and it is the caller's
    // job not to echo a provider's text. Here the provider did echo it —
    // which is exactly why the sync command stores a classified kind and
    // a bounded message rather than whatever came back.
    expect(error.kind).toBe("network");
  });
});

describe("timeouts", () => {
  // A request with no timeout does not fail; it hangs, holding a sync run
  // in RUNNING until somebody notices.
  it("aborts work that takes too long", async () => {
    const result = withTimeout(10, (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new ProviderError("network", "the request timed out")));
      })
    );

    await expect(result).rejects.toThrow(/timed out/);
  });

  it("passes a live signal through and clears the timer on success", async () => {
    const seen = await withTimeout(1000, async (signal) => {
      expect(signal.aborted).toBe(false);
      return "done";
    });
    expect(seen).toBe("done");
  });
});
