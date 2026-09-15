import { describe, expect, it } from "vitest";
import {
  mayDisclose,
  scrubSecrets,
  summariseWithheld,
  type ProviderLocality,
} from "../../../domain/ai/disclosure";
import type { Sensitivity } from "../../../domain/shared/types";

/**
 * What may reach a model.
 *
 * The most security-critical pure function in the application: everything
 * else about the AI phase is a workflow, and this is the part that decides
 * whether a household's medical and financial records leave the house.
 * It is tested exhaustively rather than representatively — six cells in
 * the matrix, all six asserted.
 */

const ALL: Sensitivity[] = ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"];

describe("the disclosure ceiling", () => {
  it.each<[Sensitivity, ProviderLocality, boolean]>([
    ["NORMAL", "LOCAL", true],
    ["NORMAL", "REMOTE", true],
    ["SENSITIVE", "LOCAL", true],
    // The rule the whole design turns on: a hosted model is a place data
    // leaves the household, and SENSITIVE does not leave the household.
    ["SENSITIVE", "REMOTE", false],
    // The hard floor. There is no provider that clears it — an
    // on-premises model is still something clever, and a household marks
    // a record this way to say "nothing clever touches this".
    ["HIGHLY_SENSITIVE", "LOCAL", false],
    ["HIGHLY_SENSITIVE", "REMOTE", false],
  ])("%s to a %s model: %s", (sensitivity, locality, allowed) => {
    expect(mayDisclose(sensitivity, locality)).toBe(allowed);
  });

  it("never lets anything above NORMAL leave the household", () => {
    const leaving = ALL.filter((s) => mayDisclose(s, "REMOTE"));
    expect(leaving).toEqual(["NORMAL"]);
  });

  it("never discloses HIGHLY_SENSITIVE to anything at all", () => {
    const localities: ProviderLocality[] = ["LOCAL", "REMOTE"];
    expect(localities.filter((l) => mayDisclose("HIGHLY_SENSITIVE", l))).toEqual([]);
  });
});

describe("saying what was held back", () => {
  // A summary built from four of seven notes is incomplete, not wrong,
  // and the difference decides whether somebody acts on it.
  it("counts what was withheld, by sensitivity", () => {
    const items = [
      { sensitivity: "NORMAL" as const },
      { sensitivity: "SENSITIVE" as const },
      { sensitivity: "SENSITIVE" as const },
      { sensitivity: "HIGHLY_SENSITIVE" as const },
    ];

    expect(summariseWithheld(items, "REMOTE")).toEqual(
      expect.arrayContaining([
        { sensitivity: "SENSITIVE", count: 2 },
        { sensitivity: "HIGHLY_SENSITIVE", count: 1 },
      ])
    );
  });

  it("reports nothing withheld when everything was allowed", () => {
    expect(summariseWithheld([{ sensitivity: "NORMAL" }], "LOCAL")).toEqual([]);
  });
});

describe("scrubbing secrets", () => {
  it.each([
    ["a bearer token", "Use Authorization: Bearer sk-abc123def456 for this", "sk-abc123def456"],
    ["an api key", "api_key=9f8e7d6c5b4a3210 in the portal", "9f8e7d6c5b4a3210"],
    ["a password", "Password: hunter2-correct-horse", "hunter2-correct-horse"],
    ["a German password label", "Passwort: sehr-geheim-1234", "sehr-geheim-1234"],
    ["a credential in a URL", "See https://ada:s3cret@cloud.internal/files", "s3cret"],
    [
      "an argon2 hash",
      "hash $argon2id$v=19$m=19456,t=2,p=1$gx897FUbqGrd$WdSkPTQYYg9J4wm",
      "argon2id",
    ],
  ])("removes %s", (_label, input, secret) => {
    const { text, removed } = scrubSecrets(input);
    expect(text).not.toContain(secret);
    expect(text).toContain("[redacted:");
    expect(removed.length).toBeGreaterThan(0);
  });

  // ADR-019's format: keyId.iv.tag.ciphertext. If one of these ever
  // reached a note, it must not reach a prompt.
  it("removes a sealed credential in this app's own format", () => {
    const sealed = "v1.YWJjZGVmZ2hpamtsbW5vcA.cXJzdHV2d3h5emFiY2RlZg.Z3JhcGVmcnVpdGJhbmFuYWFwcGxl";
    const { text } = scrubSecrets(`The token is ${sealed} apparently`);
    expect(text).not.toContain(sealed);
  });

  it("removes a private key block whole", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ\nnope\n-----END RSA PRIVATE KEY-----";
    const { text } = scrubSecrets(`Attached:\n${key}\nregards`);
    expect(text).not.toContain("MIIEpAIBAAKCAQ");
    expect(text).toContain("regards");
  });

  /**
   * The bug this shape invites.
   *
   * The patterns are module-level and carry /g, so `lastIndex` survives
   * between calls — a second call on the same pattern would otherwise
   * start halfway through the string and miss a secret at the beginning.
   * Two identical inputs must scrub identically.
   */
  it("scrubs the same input the same way every time", () => {
    const input = "Password: hunter2 and api_key=abcdef123456";
    const first = scrubSecrets(input);
    const second = scrubSecrets(input);
    const third = scrubSecrets(input);

    expect(second.text).toBe(first.text);
    expect(third.text).toBe(first.text);
    expect(first.text).not.toContain("hunter2");
    expect(second.text).not.toContain("hunter2");
  });

  // The cost of matching `Bearer <value>` on whitespace is false
  // positives in prose. These are the sentences that would be mangled by a
  // rule that was even slightly looser.
  it.each([
    "The bearer of bad news was the Sachbearbeiterin.",
    "Our token of appreciation arrived by post.",
    "The password reset link has expired.",
  ])("leaves prose alone: %s", (prose) => {
    expect(scrubSecrets(prose).text).toBe(prose);
  });

  it("leaves ordinary household text completely alone", () => {
    const ordinary = [
      "Pflegegrad Widerspruch — Frist läuft am 18.09.2026 ab.",
      "Dr. Müller hat die Rechnung über 89,90 € geschickt.",
      "Aktenzeichen 4711/2026, Sachbearbeiterin Frau Schmidt.",
    ].join("\n");

    const { text, removed } = scrubSecrets(ordinary);
    expect(text).toBe(ordinary);
    expect(removed).toEqual([]);
  });

  it("names what it removed without ever repeating the value", () => {
    const { removed, text } = scrubSecrets("token: sk-live-do-not-leak-me");
    expect(removed).toEqual(["token"]);
    expect(JSON.stringify(removed)).not.toContain("sk-live");
    expect(text).toContain("[redacted:token]");
  });
});
