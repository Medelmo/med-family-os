import type { Sensitivity, Visibility } from "../shared/types";

/**
 * docs/domain/domain-model.md: "Metadata and pointer to an external or
 * local document. The app does not become the document archive."
 *
 * `docs/integrations/integration-contracts.md` lists exactly what is
 * stored for Paperless — provider, externalId, title, document date, URL,
 * context links — and adds "Do not copy OCR text by default". So this
 * record is a signpost, not a copy: enough to find the document and to
 * say why it matters, and nothing that would make this app a second,
 * worse Paperless (CLAUDE.md §13).
 */
export const DOCUMENT_PROVIDERS = ["PAPERLESS", "NEXTCLOUD", "MANUAL"] as const;
export type DocumentProviderId = (typeof DOCUMENT_PROVIDERS)[number];

export interface DocumentReference {
  id: string;
  householdId: string;
  provider: DocumentProviderId;
  /** The provider's own id. Null only for MANUAL entries. */
  externalId: string | null;
  connectionId: string | null;

  /** What the provider calls it. Overwritten freely by a sync. */
  title: string;
  /** What the household calls it. Never touched by a sync — see below. */
  titleOverride: string | null;
  documentDate: string | null;
  url: string | null;

  /** The household's own words about why this document matters. */
  note: string | null;

  archivedAt: Date | null;
  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What the household should see it called. */
export function displayTitle(reference: Pick<DocumentReference, "title" | "titleOverride">): string {
  return reference.titleOverride ?? reference.title;
}

export interface IncomingDocument {
  externalId: string;
  title: string;
  documentDate: string | null;
  url: string | null;
}

/**
 * The fields a sync is allowed to write on an existing reference.
 *
 * This is how `docs/domain/state-machines.md`'s "a sync run must never
 * silently overwrite local edits" is enforced, and the mechanism is
 * deliberately structural rather than a comparison:
 *
 * **Provider-owned fields and household-owned fields are different
 * columns.** `title` is what Paperless calls the document and a sync
 * overwrites it without asking; `titleOverride` and `note` are the
 * household's and a sync cannot reach them at all. There is no "has this
 * been edited?" flag to get wrong, no last-writer-wins comparison, and no
 * timestamp race — the question never arises because the two never share
 * a field.
 *
 * The cost is one extra column and a `displayTitle` helper. The
 * alternative — one `title` field plus a dirty flag — fails the first time
 * a household edits a title, a sync runs, and the flag was not set because
 * the edit went through a path that forgot.
 */
export function applyProviderUpdate(
  existing: Pick<DocumentReference, "title" | "documentDate" | "url">,
  incoming: IncomingDocument
): Partial<DocumentReference> | null {
  const patch: Partial<DocumentReference> = {};

  if (existing.title !== incoming.title) patch.title = incoming.title;
  if (existing.documentDate !== incoming.documentDate) patch.documentDate = incoming.documentDate;
  if (existing.url !== incoming.url) patch.url = incoming.url;

  // Nothing changed: a sync that rewrites unchanged rows churns
  // `updatedAt`, wakes every watcher, and makes "what did this run
  // actually do?" unanswerable.
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Rejects a provider URL that is not safe to render as a link.
 *
 * A document reference's whole purpose is to be clicked, and the URL
 * arrives from a system the household controls but this application does
 * not parse or vet. `javascript:` and `data:` URLs in an `href` are script
 * execution in the user's session, and this is the one place external
 * input becomes a link — so the check lives here, in the domain, rather
 * than being remembered at each render.
 */
export function isSafeDocumentUrl(url: string | null): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
