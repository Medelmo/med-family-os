/**
 * Just enough WebDAV `multistatus` reading for a folder listing.
 *
 * **Why not an XML library.** CLAUDE.md §16 asks for a reason before a
 * dependency, and there are two here, one ordinary and one security-shaped.
 *
 * The ordinary one: this reads a single, highly constrained document — the
 * `PROPFIND` response Nextcloud returns for one folder — and takes four
 * leaf values out of each entry. A general parser would bring a
 * configuration surface and a supply-chain entry for a job with four
 * fields in it. The project already made this call once, hand-writing an
 * RFC 4180 reader in `domain/finance/csv.ts` rather than taking a CSV
 * dependency.
 *
 * The security-shaped one is the more interesting: **this scanner does not
 * resolve entities, and cannot.** It has no DTD handling, no external
 * entity resolution and no entity expansion, so XXE and billion-laughs —
 * the two things that make parsing untrusted XML genuinely dangerous — are
 * not mitigated here, they are absent. A real parser would need to be
 * configured into that same position, correctly, and to stay configured
 * through upgrades.
 *
 * **What it gives up.** This is not an XML parser and must never be
 * described as one. It does not understand namespaces properly (it matches
 * on local names), comments, processing instructions, or mixed content. It
 * would be the wrong tool for a document format anyone is free to shape.
 * The mitigation for mis-parsing is strictness: an entry that does not
 * yield the fields this needs, in the form it expects, is skipped rather
 * than guessed at, and the tests feed it real Nextcloud responses
 * including the awkward ones — other namespace prefixes, entities and
 * percent-encoding in filenames, CDATA, and folders among the files.
 */

/** One `<d:response>` from a multistatus document, reduced to its leaves. */
export interface WebDavEntry {
  /** The `<d:href>`, still percent-encoded as the server sent it. */
  href: string;
  /** Local names mapped to their text, lowercased keys. */
  props: Map<string, string>;
  /** True when `<d:resourcetype>` contained a `<d:collection/>`. */
  isCollection: boolean;
}

/** Response bodies larger than this are refused rather than parsed. */
export const MAX_MULTISTATUS_BYTES = 8 * 1024 * 1024;

/** Entries beyond this are ignored — a listing that long is a misconfiguration. */
export const MAX_MULTISTATUS_ENTRIES = 5_000;

export class MultistatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultistatusError";
  }
}

/**
 * Splits a multistatus body into entries.
 *
 * Throws only when the body is not a multistatus document at all. A single
 * malformed entry inside a valid document is dropped, because one odd file
 * on a household's Nextcloud must not stop the other four hundred syncing.
 */
export function parseMultistatus(body: string): WebDavEntry[] {
  if (body.length > MAX_MULTISTATUS_BYTES) {
    throw new MultistatusError("The folder listing was too large to read.");
  }
  if (!/<[A-Za-z0-9_.-]*:?multistatus[\s>]/i.test(body)) {
    throw new MultistatusError("The server did not return a WebDAV listing.");
  }

  const entries: WebDavEntry[] = [];
  for (const block of blocksOf(body, "response")) {
    if (entries.length >= MAX_MULTISTATUS_ENTRIES) break;
    const entry = toEntry(block);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * The inner text of every `<…:localName>…</…:localName>` in `xml`.
 *
 * Nested same-named elements are not supported and do not occur in the
 * subset this reads; a `<d:response>` never contains another one.
 */
function* blocksOf(xml: string, localName: string): Generator<string> {
  const open = new RegExp(`<([A-Za-z0-9_.-]*:)?${localName}(\\s[^>]*)?>`, "gi");
  let match: RegExpExecArray | null;

  while ((match = open.exec(xml)) !== null) {
    const prefix = match[1] ?? "";
    const closeTag = `</${prefix}${localName}>`;
    const start = match.index + match[0].length;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) continue;
    yield xml.slice(start, end);
    open.lastIndex = end + closeTag.length;
  }
}

function toEntry(block: string): WebDavEntry | null {
  const href = firstLeaf(block, "href");
  if (href === null) return null;

  const props = new Map<string, string>();

  // Only 200-status propstats are read. Nextcloud returns a second
  // propstat listing the properties it could *not* supply, with a 404
  // status and empty elements — reading those would overwrite good values
  // with empty strings.
  for (const propstat of blocksOf(block, "propstat")) {
    const status = firstLeaf(propstat, "status") ?? "";
    if (!/\b200\b/.test(status)) continue;

    for (const prop of blocksOf(propstat, "prop")) {
      for (const [name, value] of leavesOf(prop)) {
        if (!props.has(name)) props.set(name, value);
      }
    }
  }

  const resourceType = sliceOf(block, "resourcetype") ?? "";

  return {
    href: href.trim(),
    props,
    isCollection: /<([A-Za-z0-9_.-]*:)?collection\s*\/?>/i.test(resourceType),
  };
}

/** Direct text-only children of a `<prop>` block, by local name. */
function* leavesOf(prop: string): Generator<[string, string]> {
  const element = /<([A-Za-z0-9_.-]*:)?([A-Za-z0-9_.-]+)(\s[^>]*)?(\/>|>)/g;
  let match: RegExpExecArray | null;

  while ((match = element.exec(prop)) !== null) {
    const [, , localName, , ending] = match;
    const key = localName.toLowerCase();

    if (ending === "/>") {
      yield [key, ""];
      continue;
    }

    const closeTag = `</${match[1] ?? ""}${localName}>`;
    const start = match.index + match[0].length;
    const end = prop.indexOf(closeTag, start);
    if (end === -1) continue;

    const inner = prop.slice(start, end);
    // Elements with child elements — `resourcetype` is the one that
    // matters — are not text leaves and are handled separately.
    if (!inner.includes("<") || inner.includes("<![CDATA[")) {
      yield [key, decodeXmlText(inner)];
    }
    element.lastIndex = end + closeTag.length;
  }
}

function firstLeaf(xml: string, localName: string): string | null {
  const inner = sliceOf(xml, localName);
  return inner === null ? null : decodeXmlText(inner);
}

function sliceOf(xml: string, localName: string): string | null {
  for (const block of blocksOf(xml, localName)) return block;
  return null;
}

/**
 * XML text to a string.
 *
 * CDATA first, then the five predefined entities and numeric character
 * references. **No named entity beyond those five is resolved** — there is
 * no DTD here to define one, and an unknown `&foo;` is left exactly as it
 * arrived rather than guessed at. That is the whole entity story, which is
 * the point: there is nothing here to expand recursively.
 */
export function decodeXmlText(text: string): string {
  const withoutCdata = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

  return withoutCdata.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        // Surrogates and out-of-range values are left as written rather
        // than turned into a replacement character that looks like data.
        if (!Number.isSafeInteger(code) || code <= 0 || code > 0x10ffff) return whole;
        if (code >= 0xd800 && code <= 0xdfff) return whole;
        return String.fromCodePoint(code);
      }
    }
  });
}
