import { describe, expect, it, vi } from "vitest";
import {
  createNextcloudProvider,
  filesUrl,
  normaliseRemotePath,
} from "../../../infrastructure/integrations/nextcloud";
import { ProviderError } from "../../../application/integrations/documentProvider";

/**
 * The Nextcloud adapter, against the responses a real one sends.
 *
 * A test that reached an actual Nextcloud would be testing somebody's
 * homelab. The XML here is copied in shape from a real `PROPFIND`
 * response, including the parts that are easy to forget: the folder itself
 * as the first entry, the second `404` propstat, and a filename with
 * characters in it.
 */

const BASE = "https://cloud.internal";
const PASSWORD = "app-password-value-not-a-login";

function propfindBody(...entries: string[]) {
  return `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
${entries.join("\n")}
</d:multistatus>`;
}

const folder = (href: string, fileId: string) => `
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <oc:fileid>${fileId}</oc:fileid>
        <d:getlastmodified>Mon, 14 Sep 2026 12:00:00 GMT</d:getlastmodified>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

const file = (href: string, fileId: string, displayName: string, modified = "Mon, 14 Sep 2026 12:00:00 GMT") => `
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <oc:fileid>${fileId}</oc:fileid>
        <d:displayname>${displayName}</d:displayname>
        <d:getlastmodified>${modified}</d:getlastmodified>
        <d:getcontenttype>application/pdf</d:getcontenttype>
        <d:resourcetype/>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><nc:has-preview/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>`;

function respondWith(body: string, init: ResponseInit = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return new Response(body, { status: 200, ...init });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const provider = (fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof createNextcloudProvider>[0]> = {}) =>
  createNextcloudProvider({
    baseUrl: BASE,
    username: "ada",
    appPassword: PASSWORD,
    remotePath: "Documents/Household",
    fetchImpl,
    ...overrides,
  });

const signal = () => new AbortController().signal;

describe("asking Nextcloud for a folder", () => {
  it("sends a Depth-1 PROPFIND to that account's folder", async () => {
    const { calls, fetchImpl } = respondWith(propfindBody());
    await provider(fetchImpl).listDocuments(null, signal());

    expect(calls[0].url).toBe("https://cloud.internal/remote.php/dav/files/ada/Documents/Household/");
    expect(calls[0].init.method).toBe("PROPFIND");
    // Depth 1, not infinity: "do not mirror the full Nextcloud tree".
    expect((calls[0].init.headers as Record<string, string>).depth).toBe("1");
  });

  it("asks for the five properties it uses and not for everything", async () => {
    const { calls, fetchImpl } = respondWith(propfindBody());
    await provider(fetchImpl).listDocuments(null, signal());

    const body = String(calls[0].init.body);
    expect(body).toContain("<oc:fileid/>");
    expect(body).toContain("<d:displayname/>");
    // allprop would return previews, shares, tags and comment counts for
    // every file — far more of the household's Nextcloud than this app
    // has any business holding.
    expect(body).not.toContain("allprop");
  });

  it("authenticates with the app password and puts it nowhere else", async () => {
    const { calls, fetchImpl } = respondWith(propfindBody());
    await provider(fetchImpl).listDocuments(null, signal());

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from(`ada:${PASSWORD}`).toString("base64")}`);
    // Not in the URL, where it would reach a log or a browser history.
    expect(calls[0].url).not.toContain(PASSWORD);
  });
});

describe("what comes back", () => {
  it("maps files and leaves the folder itself out", async () => {
    const { fetchImpl } = respondWith(
      propfindBody(
        folder("/remote.php/dav/files/ada/Documents/Household/", "100"),
        file("/remote.php/dav/files/ada/Documents/Household/Bescheid.pdf", "101", "Bescheid.pdf")
      )
    );

    const page = await provider(fetchImpl).listDocuments(null, signal());

    expect(page.documents).toEqual([
      {
        externalId: "101",
        title: "Bescheid.pdf",
        documentDate: "2026-09-14",
        url: "https://cloud.internal/index.php/f/101",
      },
    ]);
  });

  // The contract's "do not mirror the full Nextcloud tree", asserted.
  it("does not descend into subfolders", async () => {
    const { fetchImpl } = respondWith(
      propfindBody(
        folder("/remote.php/dav/files/ada/Documents/Household/", "100"),
        folder("/remote.php/dav/files/ada/Documents/Household/Old/", "102"),
        file("/remote.php/dav/files/ada/Documents/Household/a.pdf", "103", "a.pdf")
      )
    );

    const page = await provider(fetchImpl).listDocuments(null, signal());
    expect(page.documents.map((d) => d.externalId)).toEqual(["103"]);
  });

  /**
   * The identity is the file id, not the path — which is what makes a
   * rename an update rather than a duplicate. This is the property the
   * whole sync's idempotency rests on.
   */
  it("keys on the file id, so a rename updates rather than duplicates", async () => {
    const before = respondWith(
      propfindBody(file("/remote.php/dav/files/ada/Documents/Household/old.pdf", "104", "old.pdf"))
    );
    const after = respondWith(
      propfindBody(file("/remote.php/dav/files/ada/Documents/Household/new name.pdf", "104", "new name.pdf"))
    );

    const first = await provider(before.fetchImpl).listDocuments(null, signal());
    const second = await provider(after.fetchImpl).listDocuments(null, signal());

    expect(first.documents[0].externalId).toBe(second.documents[0].externalId);
    expect(first.documents[0].title).not.toBe(second.documents[0].title);
  });

  it("falls back to the filename when the server sends no display name", async () => {
    const { fetchImpl } = respondWith(
      propfindBody(`
      <d:response>
        <d:href>/remote.php/dav/files/ada/Documents/Household/Rechnung%20M%C3%BCller.pdf</d:href>
        <d:propstat>
          <d:prop><oc:fileid>105</oc:fileid><d:resourcetype/></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>`)
    );

    const page = await provider(fetchImpl).listDocuments(null, signal());
    expect(page.documents[0].title).toBe("Rechnung Müller.pdf");
  });

  it("skips an entry with no usable file id rather than importing a duplicate every run", async () => {
    const { fetchImpl } = respondWith(
      propfindBody(
        `<d:response><d:href>/remote.php/dav/files/ada/Documents/Household/x.pdf</d:href>
         <d:propstat><d:prop><d:displayname>x.pdf</d:displayname><d:resourcetype/></d:prop>
         <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        file("/remote.php/dav/files/ada/Documents/Household/y.pdf", "106", "y.pdf")
      )
    );

    const page = await provider(fetchImpl).listDocuments(null, signal());
    expect(page.documents.map((d) => d.externalId)).toEqual(["106"]);
  });

  it("has no second page, because a PROPFIND returns the folder at once", async () => {
    const { fetchImpl } = respondWith(
      propfindBody(file("/remote.php/dav/files/ada/Documents/Household/a.pdf", "107", "a.pdf"))
    );

    expect((await provider(fetchImpl).listDocuments(null, signal())).nextCursor).toBeNull();
  });

  it("leaves the date null when the server sends one it cannot read", async () => {
    const { fetchImpl } = respondWith(
      propfindBody(file("/remote.php/dav/files/ada/Documents/Household/a.pdf", "108", "a.pdf", "not a date"))
    );

    expect((await provider(fetchImpl).listDocuments(null, signal())).documents[0].documentDate).toBeNull();
  });
});

describe("when it goes wrong", () => {
  it("classifies a rejected app password as auth, which is not retried", async () => {
    const { fetchImpl } = respondWith("", { status: 401 });

    const error = await provider(fetchImpl)
      .listDocuments(null, signal())
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("auth");
    expect(error.retryable).toBe(false);
  });

  // The realistic misconfiguration: a base URL pointing at something that
  // is not Nextcloud. Telling the household to check the address beats
  // telling them to check the token.
  it("says to check the address when the server does not speak WebDAV", async () => {
    const { fetchImpl } = respondWith("", { status: 405 });

    const error = await provider(fetchImpl)
      .listDocuments(null, signal())
      .catch((e) => e);

    expect(error.kind).toBe("not_found");
    expect(error.message).toMatch(/base URL/i);
  });

  it("reports an HTML login page as malformed rather than parsing it", async () => {
    const { fetchImpl } = respondWith("<html><body>Please log in</body></html>");

    const error = await provider(fetchImpl)
      .listDocuments(null, signal())
      .catch((e) => e);

    expect(error.kind).toBe("malformed");
  });

  // The rule that a credential leak was found violating in Phase 7: the
  // message is this application's own words, never the cause's, because an
  // underlying fetch error names the URL it was called with.
  it("never repeats the underlying error, which could name the credential", async () => {
    const fetchImpl = (async () => {
      throw new Error(`request to https://ada:${PASSWORD}@cloud.internal/remote.php/dav failed`);
    }) as unknown as typeof fetch;

    const error = await provider(fetchImpl)
      .listDocuments(null, signal())
      .catch((e) => e);

    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain("cloud.internal");
  });

  it("refuses a listing too large to hold", async () => {
    const { fetchImpl } = respondWith(propfindBody(), {
      headers: { "content-length": String(64 * 1024 * 1024) },
    });

    const error = await provider(fetchImpl)
      .listDocuments(null, signal())
      .catch((e) => e);

    expect(error.kind).toBe("malformed");
    expect(error.message).toMatch(/too large/i);
  });
});

describe("building the folder URL", () => {
  it("encodes every segment", () => {
    expect(filesUrl(BASE, "ada müller", "Ordner/Ärzte & Co")).toBe(
      "https://cloud.internal/remote.php/dav/files/ada%20m%C3%BCller/Ordner/%C3%84rzte%20%26%20Co/"
    );
  });

  it("treats an empty path as the account root", () => {
    expect(filesUrl(BASE, "ada", "")).toBe("https://cloud.internal/remote.php/dav/files/ada/");
    expect(filesUrl(BASE, "ada", "  /  ")).toBe("https://cloud.internal/remote.php/dav/files/ada/");
  });

  it("tolerates leading and trailing slashes", () => {
    expect(filesUrl(BASE, "ada", "/Documents/")).toBe("https://cloud.internal/remote.php/dav/files/ada/Documents/");
  });

  // Refused rather than resolved: resolving it would silently read a
  // folder the household did not name.
  it("refuses a path that steps up out of itself", () => {
    expect(() => normaliseRemotePath("Documents/../../etc")).toThrow(ProviderError);
    expect(() => normaliseRemotePath("..")).toThrow(ProviderError);
    expect(() => filesUrl(BASE, "ada", "a/../../b")).toThrow(ProviderError);
  });

  // `..` inside a name is a legal folder name, and only a whole segment
  // means traversal.
  it("allows dots that are not a whole segment", () => {
    expect(normaliseRemotePath("Steuer..2026")).toBe("Steuer..2026");
    expect(filesUrl(BASE, "ada", "a..b")).toContain("/a..b/");
  });
});
