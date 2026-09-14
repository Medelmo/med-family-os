import { describe, expect, it } from "vitest";
import { bearerTokenFrom, checkHaToken, HA_TOKEN_MIN_LENGTH } from "../../infrastructure/integrations/haToken";

const REAL = "a".repeat(HA_TOKEN_MIN_LENGTH);

describe("the Home Assistant token check", () => {
  it("accepts the configured token", () => {
    expect(checkHaToken(REAL, REAL)).toBe("authorized");
  });

  it("rejects a wrong token of the same length", () => {
    expect(checkHaToken("b".repeat(HA_TOKEN_MIN_LENGTH), REAL)).toBe("unauthorized");
  });

  it("rejects a token that is a prefix of the real one", () => {
    expect(checkHaToken(REAL.slice(0, -1), REAL)).toBe("unauthorized");
    expect(checkHaToken(`${REAL}x`, REAL)).toBe("unauthorized");
  });

  it("rejects an absent token", () => {
    expect(checkHaToken(null, REAL)).toBe("unauthorized");
    expect(checkHaToken("", REAL)).toBe("unauthorized");
  });

  // A deployment that has not set a token has not opted in to a
  // machine-readable surface, and must not get one by accident.
  it("fails closed when nothing is configured", () => {
    expect(checkHaToken(REAL, undefined)).toBe("not_configured");
    expect(checkHaToken(null, undefined)).toBe("not_configured");
    expect(checkHaToken(REAL, "")).toBe("not_configured");
    expect(checkHaToken(REAL, "   ")).toBe("not_configured");
  });

  // Empty presented against empty configured must never be a match.
  it("does not let two blanks authenticate each other", () => {
    expect(checkHaToken("", "")).toBe("not_configured");
    expect(checkHaToken(null, undefined)).toBe("not_configured");
  });

  // A four-character token satisfies every other check here and is still
  // guessable in an afternoon on a LAN.
  it("refuses to accept a token shorter than the minimum, even a correct one", () => {
    const short = "s".repeat(HA_TOKEN_MIN_LENGTH - 1);
    expect(checkHaToken(short, short)).toBe("not_configured");
  });

  it("ignores surrounding whitespace in the configured value", () => {
    expect(checkHaToken(REAL, `  ${REAL}  `)).toBe("authorized");
  });
});

describe("reading the bearer token", () => {
  const withHeader = (value: string) => new Request("https://example.test/api/ha/summary", { headers: { authorization: value } });

  it("reads a bearer header", () => {
    expect(bearerTokenFrom(withHeader(`Bearer ${REAL}`))).toBe(REAL);
  });

  it("is case-insensitive about the scheme and tolerant of spacing", () => {
    expect(bearerTokenFrom(withHeader(`bearer   ${REAL}`))).toBe(REAL);
    expect(bearerTokenFrom(withHeader(`  BEARER ${REAL}  `))).toBe(REAL);
  });

  it("ignores another scheme", () => {
    expect(bearerTokenFrom(withHeader(`Basic ${REAL}`))).toBeNull();
  });

  it("is null with no header at all", () => {
    expect(bearerTokenFrom(new Request("https://example.test/api/ha/summary"))).toBeNull();
  });

  // A token in a URL ends up in the proxy's access log, the browser's
  // history and any screenshot of the dashboard.
  it("never reads a token from the query string", () => {
    expect(bearerTokenFrom(new Request(`https://example.test/api/ha/summary?token=${REAL}`))).toBeNull();
  });
});
