import {
  classifyHttpStatus,
  ProviderError,
  type DocumentPage,
  type DocumentProvider,
} from "../../application/integrations/documentProvider";
import type { IncomingDocument } from "../../domain/documents/documentReference";

/**
 * Paperless-ngx, read-only.
 *
 * `docs/integrations/integration-contracts.md`: "locate/open documents and
 * optionally import metadata… Do not copy OCR text by default." So this
 * reads `/api/documents/` and takes five fields: the id, the title, the
 * document date, and a URL back into Paperless. The `content` field — the
 * OCR text, often megabytes of it — is never read, and `truncate_content`
 * asks Paperless not to send it in the first place.
 *
 * This file is the only place in the application that has seen Paperless's
 * JSON. Everything above it speaks `IncomingDocument`.
 */

export const PAPERLESS_PAGE_SIZE = 50;
export const PAPERLESS_TIMEOUT_MS = 15_000;

export interface PaperlessConfig {
  baseUrl: string;
  apiToken: string;
  /** Injected so tests do not need a network, and so a timeout can be applied around it. */
  fetchImpl?: typeof fetch;
}

export function createPaperlessProvider(config: PaperlessConfig): DocumentProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");

  return {
    id: "PAPERLESS",

    async listDocuments(cursor: string | null, signal: AbortSignal): Promise<DocumentPage> {
      // The cursor is a page number as a string. It is opaque to the
      // caller by contract, so the shape can change without touching
      // anything above this file.
      const page = parsePage(cursor);
      const url =
        `${base}/api/documents/?ordering=-modified&page_size=${PAPERLESS_PAGE_SIZE}` +
        `&page=${page}&truncate_content=true`;

      let response: Response;
      try {
        response = await doFetch(url, {
          signal,
          headers: {
            // Paperless uses "Token", not "Bearer".
            authorization: `Token ${config.apiToken}`,
            accept: "application/json",
          },
        });
      } catch (error) {
        // Timeouts, DNS failures, a reboot mid-request — all retryable.
        //
        // The cause's own text is deliberately **not** repeated. An
        // underlying fetch error routinely names the URL it was called
        // with, and a URL can carry a credential; this message is stored
        // and shown, so it says which kind of failure happened and
        // nothing about the request that caused it.
        throw new ProviderError("network", isTimeout(error) ? "The request timed out." : "Could not reach the provider.");
      }

      if (!response.ok) {
        throw classifyHttpStatus(response.status, "");
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ProviderError("malformed", "The provider did not return JSON.");
      }

      return toPage(body, page, base);
    },
  };
}

function parsePage(cursor: string | null): number {
  if (!cursor) return 1;
  const page = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

interface PaperlessListBody {
  next?: unknown;
  results?: unknown;
}

/**
 * Maps Paperless's response onto the domain's shape.
 *
 * Every field is checked rather than trusted. This is data from another
 * system arriving over the network, and a row that is not the shape this
 * expects is skipped rather than allowed to become a
 * `DocumentReference` with `undefined` in it — the household would see a
 * broken entry and have no idea why.
 */
function toPage(body: unknown, currentPage: number, base: string): DocumentPage {
  if (typeof body !== "object" || body === null) {
    throw new ProviderError("malformed", "The provider returned something that is not a document list.");
  }

  const { next, results } = body as PaperlessListBody;
  if (!Array.isArray(results)) {
    throw new ProviderError("malformed", "The provider's response had no results array.");
  }

  const documents: IncomingDocument[] = [];
  for (const row of results) {
    const document = toDocument(row, base);
    if (document) documents.push(document);
  }

  return {
    documents,
    // Paperless gives a full URL for the next page; only whether there is
    // one matters here, because the page number is the cursor.
    nextCursor: typeof next === "string" && next.length > 0 ? String(currentPage + 1) : null,
  };
}

function toDocument(row: unknown, base: string): IncomingDocument | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;

  const id = record.id;
  if (typeof id !== "number" && typeof id !== "string") return null;

  const externalId = String(id);
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : `Document ${externalId}`;

  // Paperless sends "2026-01-04" or a full timestamp depending on version
  // and field; either way the domain wants a date.
  const created = record.created_date ?? record.created;
  const documentDate = typeof created === "string" && /^\d{4}-\d{2}-\d{2}/.test(created) ? created.slice(0, 10) : null;

  return {
    externalId,
    title,
    documentDate,
    // Built from the configured base rather than from anything the
    // provider sent: a URL taken from the response would be an open
    // redirect waiting to happen, and the household clicks these.
    url: `${base}/documents/${encodeURIComponent(externalId)}/details`,
  };
}

/**
 * Runs a provider call under a timeout.
 *
 * `docs/integrations/integration-contracts.md` requires every adapter to
 * support one, and a request with no timeout does not fail — it hangs,
 * holding a sync run in RUNNING until somebody notices.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
