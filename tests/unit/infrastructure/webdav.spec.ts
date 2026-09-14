import { describe, expect, it } from "vitest";
import {
  MAX_MULTISTATUS_ENTRIES,
  MultistatusError,
  decodeXmlText,
  parseMultistatus,
} from "../../../infrastructure/integrations/webdav";

/**
 * The WebDAV reader, fed the shapes a real Nextcloud actually returns.
 *
 * This is a hand-written scanner over untrusted input, so the tests carry
 * more weight than usual: the cost of not taking an XML dependency is that
 * the awkward cases have to be written down rather than assumed handled.
 */

/** A response block, in the shape Nextcloud sends. */
function response(
  href: string,
  props: Record<string, string>,
  { collection = false, missing = [] as string[] } = {}
) {
  const supplied = Object.entries(props)
    .map(([name, value]) => `<${name}>${value}</${name}>`)
    .join("");

  // Nextcloud always sends a second propstat for properties it could not
  // supply, with a 404 and empty elements.
  const notFound = missing.length
    ? `<d:propstat><d:prop>${missing.map((n) => `<${n}/>`).join("")}</d:prop>` +
      `<d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>`
    : "";

  return `
  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        ${supplied}
        <d:resourcetype>${collection ? "<d:collection/>" : ""}</d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    ${notFound}
  </d:response>`;
}

const multistatus = (...responses: string[]) =>
  `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
${responses.join("\n")}
</d:multistatus>`;

describe("reading a folder listing", () => {
  it("takes the href, the properties and whether it is a folder", () => {
    const xml = multistatus(
      response("/remote.php/dav/files/ada/Papers/", { "oc:fileid": "10" }, { collection: true }),
      response("/remote.php/dav/files/ada/Papers/Bescheid.pdf", {
        "oc:fileid": "11",
        "d:getlastmodified": "Mon, 14 Sep 2026 12:00:00 GMT",
        "d:getcontenttype": "application/pdf",
      })
    );

    const entries = parseMultistatus(xml);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ href: "/remote.php/dav/files/ada/Papers/", isCollection: true });
    expect(entries[1].isCollection).toBe(false);
    expect(entries[1].props.get("fileid")).toBe("11");
    expect(entries[1].props.get("getcontenttype")).toBe("application/pdf");
  });

  // The namespace prefix is the server's choice, not a constant. sabre/dav
  // uses `d:`, some servers use `D:`, and a default namespace has none.
  it.each([
    ["lowercase d", "d"],
    ["uppercase D", "D"],
    ["a different prefix", "dav"],
  ])("reads a listing using %s", (_label, prefix) => {
    const p = prefix ? `${prefix}:` : "";
    const xml = `<?xml version="1.0"?>
<${p}multistatus xmlns:${prefix}="DAV:" xmlns:oc="http://owncloud.org/ns">
  <${p}response>
    <${p}href>/remote.php/dav/files/ada/a.pdf</${p}href>
    <${p}propstat>
      <${p}prop><oc:fileid>7</oc:fileid><${p}resourcetype/></${p}prop>
      <${p}status>HTTP/1.1 200 OK</${p}status>
    </${p}propstat>
  </${p}response>
</${p}multistatus>`;

    const [entry] = parseMultistatus(xml);
    expect(entry.props.get("fileid")).toBe("7");
    expect(entry.isCollection).toBe(false);
  });

  // The 404 propstat lists the properties the server could not give. Its
  // elements are empty, and reading them would overwrite the good values
  // from the 200 propstat with "".
  it("ignores the properties the server said it does not have", () => {
    const xml = multistatus(
      response(
        "/remote.php/dav/files/ada/a.pdf",
        { "oc:fileid": "12" },
        { missing: ["oc:size", "nc:has-preview"] }
      )
    );

    const [entry] = parseMultistatus(xml);
    expect(entry.props.get("fileid")).toBe("12");
    expect(entry.props.has("size")).toBe(false);
  });

  it("skips a response with no href rather than inventing one", () => {
    const xml = multistatus(
      `<d:response><d:propstat><d:prop><oc:fileid>1</oc:fileid></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      response("/remote.php/dav/files/ada/good.pdf", { "oc:fileid": "2" })
    );

    const entries = parseMultistatus(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].props.get("fileid")).toBe("2");
  });

  // One odd file must not stop the other four hundred from syncing.
  it("drops an unterminated response and keeps the rest", () => {
    const xml = multistatus(
      `<d:response><d:href>/broken`,
      response("/remote.php/dav/files/ada/good.pdf", { "oc:fileid": "3" })
    );

    expect(parseMultistatus(xml).map((e) => e.props.get("fileid"))).toEqual(["3"]);
  });

  it("refuses a body that is not a WebDAV listing at all", () => {
    expect(() => parseMultistatus("<html><body>Login</body></html>")).toThrow(MultistatusError);
    expect(() => parseMultistatus("")).toThrow(MultistatusError);
    // A JSON error page from a reverse proxy is the realistic version.
    expect(() => parseMultistatus('{"error":"unauthorised"}')).toThrow(MultistatusError);
  });

  it("stops at a listing long enough to be a misconfiguration", () => {
    const many = Array.from({ length: MAX_MULTISTATUS_ENTRIES + 10 }, (_, i) =>
      response(`/remote.php/dav/files/ada/${i}.pdf`, { "oc:fileid": String(i) })
    );

    expect(parseMultistatus(multistatus(...many))).toHaveLength(MAX_MULTISTATUS_ENTRIES);
  });
});

describe("text that is not plain", () => {
  it("resolves the five predefined entities", () => {
    expect(decodeXmlText("Fish &amp; Chips &lt;b&gt; &quot;x&quot; &apos;y&apos;")).toBe(
      `Fish & Chips <b> "x" 'y'`
    );
  });

  it("resolves numeric character references", () => {
    expect(decodeXmlText("M&#252;ller &#x2014; Bescheid")).toBe("Müller — Bescheid");
  });

  // There is no DTD here to define one, so an unknown entity is data, not
  // something to guess at.
  it("leaves an unknown entity exactly as it arrived", () => {
    expect(decodeXmlText("Tom &nbsp; Jerry &lol1;")).toBe("Tom &nbsp; Jerry &lol1;");
  });

  // The reason this file does not take an XML dependency. There is no
  // expansion step to attack: the entity is never defined and never
  // resolved, so the classic quadratic blow-up simply does not happen.
  it("does nothing at all with a billion-laughs payload", () => {
    const attack =
      `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">` +
      `<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>` +
      `<d:multistatus xmlns:d="DAV:">` +
      `<d:response><d:href>&lol2;</d:href></d:response></d:multistatus>`;

    const [entry] = parseMultistatus(attack);
    expect(entry.href).toBe("&lol2;");
  });

  // XXE: an external entity is likewise never resolved, so no request is
  // made and no file is read.
  it("does not resolve an external entity", () => {
    const attack =
      `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
      `<d:multistatus xmlns:d="DAV:"><d:response><d:href>&xxe;</d:href>` +
      `<d:propstat><d:prop><oc:fileid>&xxe;</oc:fileid></d:prop>` +
      `<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

    const [entry] = parseMultistatus(attack);
    expect(entry.href).toBe("&xxe;");
    expect(entry.props.get("fileid")).toBe("&xxe;");
  });

  it("reads CDATA", () => {
    const xml = multistatus(
      `<d:response><d:href><![CDATA[/remote.php/dav/files/ada/a & b.pdf]]></d:href>` +
        `<d:propstat><d:prop><oc:fileid>4</oc:fileid></d:prop>` +
        `<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    );

    expect(parseMultistatus(xml)[0].href).toBe("/remote.php/dav/files/ada/a & b.pdf");
  });

  it("does not turn a surrogate reference into a replacement character", () => {
    expect(decodeXmlText("&#xD800;")).toBe("&#xD800;");
    expect(decodeXmlText("&#x110000;")).toBe("&#x110000;");
  });
});
