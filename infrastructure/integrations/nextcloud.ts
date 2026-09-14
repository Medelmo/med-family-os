import {
  classifyHttpStatus,
  ProviderError,
  type DocumentPage,
  type DocumentProvider,
} from "../../application/integrations/documentProvider";
import type { IncomingDocument } from "../../domain/documents/documentReference";
import { MAX_MULTISTATUS_BYTES, MultistatusError, parseMultistatus } from "./webdav";

/**
 * Nextcloud Files, read-only, one folder.
 *
 * `docs/integrations/integration-contracts.md`: "file links and optionally
 * selected attachment storage. **Do not mirror the full Nextcloud
 * tree.**" That sentence is the design. The connection names one folder,
 * the listing is `Depth: 1`, and subfolders are reported as folders and
 * skipped rather than descended into. A household that wants two folders
 * configures two connections, which also gives them two health rows and
 * two schedules.
 *
 * This file and `webdav.ts` are the only places in the application that
 * have seen Nextcloud's XML. Everything above speaks `IncomingDocument`.
 */

export const NEXTCLOUD_TIMEOUT_MS = 20_000;

export interface NextcloudConfig {
  baseUrl: string;
  /** The Nextcloud account the app password belongs to. Not a secret. */
  username: string;
  /** An app password, not the account password — see ADR-024. */
  appPassword: string;
  /** Folder to list, relative to that account's files root. */
  remotePath: string;
  fetchImpl?: typeof fetch;
}

/**
 * The properties asked for, and nothing else.
 *
 * A bare `<d:propfind><d:allprop/></d:propfind>` would return previews,
 * share state, comment counts, tags and system metadata for every file —
 * far more of the household's Nextcloud than this application has any
 * business holding in memory, and a much larger response to read.
 */
const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:fileid/>
    <d:displayname/>
    <d:getlastmodified/>
    <d:getcontenttype/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

export function createNextcloudProvider(config: NextcloudConfig): DocumentProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  const folderUrl = filesUrl(base, config.username, config.remotePath);

  return {
    id: "NEXTCLOUD",

    async listDocuments(_cursor: string | null, signal: AbortSignal): Promise<DocumentPage> {
      let response: Response;
      try {
        response = await doFetch(folderUrl, {
          method: "PROPFIND",
          signal,
          headers: {
            // Basic with an app password. The header is built here and
            // nowhere else; it is never logged, and no error message in
            // this file interpolates the request.
            authorization: `Basic ${Buffer.from(`${config.username}:${config.appPassword}`, "utf8").toString("base64")}`,
            // Depth 1 is the contract: this folder's children, and no
            // deeper. Depth "infinity" is what "mirror the full tree"
            // would look like, and many servers refuse it anyway.
            depth: "1",
            "content-type": "application/xml; charset=utf-8",
          },
          body: PROPFIND_BODY,
        });
      } catch (error) {
        // The cause's own text is deliberately not repeated: an underlying
        // fetch error routinely names the URL it was called with, and this
        // URL carries a username.
        throw new ProviderError(
          "network",
          isTimeout(error) ? "The request timed out." : "Could not reach the provider."
        );
      }

      if (!response.ok) {
        // 405 means the server answered but does not speak WebDAV here —
        // almost always a base URL pointing at something that is not
        // Nextcloud. Classified as not_found so the household is told to
        // check the address rather than the token.
        if (response.status === 405) {
          throw new ProviderError("not_found", "That address does not speak WebDAV. Check the base URL.");
        }
        throw classifyHttpStatus(response.status, "");
      }

      const body = await readBounded(response);

      let entries;
      try {
        entries = parseMultistatus(body);
      } catch (error) {
        throw new ProviderError(
          "malformed",
          error instanceof MultistatusError ? error.message : "The provider returned something this app could not read."
        );
      }

      const documents: IncomingDocument[] = [];
      for (const entry of entries) {
        // The folder itself is the first entry of a Depth-1 listing, and
        // subfolders are the contract's "do not mirror the tree".
        if (entry.isCollection) continue;
        const document = toDocument(entry, base, folderUrl);
        if (document) documents.push(document);
      }

      // **No cursor.** A `PROPFIND` returns the whole folder in one
      // response; there is nothing to page through, and pretending
      // otherwise would mean re-fetching the same body to slice it.
      //
      // The incremental version of this is a `REPORT` with
      // `sync-collection` (RFC 6578) and a sync token, which Nextcloud
      // supports. It is worth doing when a household has a folder large
      // enough to care about — the size cap below is what says so out
      // loud in the meantime, rather than degrading quietly.
      return { documents, nextCursor: null };
    },
  };
}

/**
 * The WebDAV URL for one folder of one account.
 *
 * Every segment is encoded here. The username and the path come from a
 * form, and a segment containing `/` or `..` would otherwise reach a
 * different folder than the one the household configured — on their own
 * server, but not the one they asked for. `normaliseRemotePath` refuses
 * traversal outright; this is the second line.
 */
export function filesUrl(base: string, username: string, remotePath: string): string {
  const segments = normaliseRemotePath(remotePath)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));

  const prefix = `${base}/remote.php/dav/files/${encodeURIComponent(username)}`;
  return segments.length > 0 ? `${prefix}/${segments.join("/")}/` : `${prefix}/`;
}

/**
 * A folder path this application is willing to ask for.
 *
 * Empty means the account's own root. `..` is refused rather than
 * resolved: resolving it would silently sync a folder the household did
 * not name, and there is no legitimate reason to type one.
 */
export function normaliseRemotePath(remotePath: string): string {
  const trimmed = remotePath.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  if (trimmed.split("/").some((segment) => segment === "..")) {
    throw new ProviderError("malformed", "That folder path is not allowed.");
  }
  return trimmed;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Reads the body, refusing one too large to hold.
 *
 * `response.text()` on a listing of a hundred thousand files would put the
 * whole thing in memory before anything could object. The header is
 * checked first because it is free, and the stream is measured as it
 * arrives because `content-length` is optional and a chunked response
 * simply will not have one.
 */
async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_MULTISTATUS_BYTES) {
    throw new ProviderError("malformed", "The folder listing was too large to read.");
  }

  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MULTISTATUS_BYTES) {
        throw new ProviderError("malformed", "The folder listing was too large to read.");
      }
      chunks.push(value);
    }
  } finally {
    // Tells the server to stop sending. Without this a refused oversized
    // response keeps arriving until the connection times out.
    await reader.cancel().catch(() => {});
  }

  return new TextDecoder("utf-8").decode(await concat(chunks, total));
}

async function concat(chunks: Uint8Array[], total: number): Promise<Uint8Array> {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * One WebDAV entry as the domain's shape.
 *
 * `oc:fileid` is the identity, not the path. A file id survives a rename
 * and a move within the account, so renaming a document in Nextcloud
 * updates the household's reference instead of creating a second one and
 * orphaning the first — which is what a path-keyed sync would do, and what
 * the household would experience as their notes silently detaching.
 */
function toDocument(
  entry: { href: string; props: Map<string, string>; isCollection: boolean },
  base: string,
  folderUrl: string
): IncomingDocument | null {
  const fileId = entry.props.get("fileid")?.trim();
  // No id, no identity: the upsert has nothing to be idempotent on, so the
  // entry is skipped rather than imported as a duplicate on every run.
  if (!fileId || !/^\d+$/.test(fileId)) return null;

  const title = entry.props.get("displayname")?.trim() || nameFromHref(entry.href, folderUrl) || `File ${fileId}`;

  return {
    externalId: fileId,
    title,
    documentDate: toIsoDate(entry.props.get("getlastmodified")),
    // Built from the configured base and the file id, never from the
    // href: a URL taken from a response is an open redirect waiting to
    // happen, and the household clicks these. `/f/<id>` is Nextcloud's own
    // stable permalink and follows a move.
    url: `${base}/index.php/f/${encodeURIComponent(fileId)}`,
  };
}

/** The filename, for a server that did not send `displayname`. */
function nameFromHref(href: string, folderUrl: string): string | null {
  const last = href.replace(/\/+$/, "").split("/").pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    // A malformed percent-escape in a filename. The raw segment is still
    // a better answer than nothing, and better than throwing over one file.
    void folderUrl;
    return last;
  }
}

/**
 * `getlastmodified` is an RFC 1123 date; the domain wants a calendar date.
 *
 * The *modified* time, which is the only date WebDAV offers — a file's
 * contents have no "document date" the way a Paperless record does. It is
 * honest as "when this last changed" and is what the documents list
 * orders by.
 */
function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
