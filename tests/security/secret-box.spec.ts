import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  credentialContext,
  keyIdOf,
  openSecret,
  parseKeyring,
  resealSecret,
  sealSecret,
  CredentialCryptoError,
} from "../../infrastructure/crypto/secretBox";
import { getKeyring, isKeyringConfigured, resetKeyringCache } from "../../infrastructure/crypto/keyring";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

const ring = (spec = `v1:${KEY_A}`, active = "v1") => parseKeyring(spec, active);
const AAD = credentialContext("household-1", "connection-1", "api_token");

describe("configuring the keyring", () => {
  it("accepts one key", () => {
    const keyring = ring();
    expect(keyring.activeKeyId).toBe("v1");
    expect(keyring.keys.size).toBe(1);
  });

  it("accepts several and keeps the old ones readable", () => {
    const keyring = parseKeyring(`v1:${KEY_A}, v2:${KEY_B}`, "v2");
    expect(keyring.activeKeyId).toBe("v2");
    expect([...keyring.keys.keys()]).toEqual(["v1", "v2"]);
  });

  // Refusing to start beats failing at the moment somebody connects an
  // integration.
  it("refuses an empty or absent configuration", () => {
    expect(() => parseKeyring(undefined, "v1")).toThrow(CredentialCryptoError);
    expect(() => parseKeyring("", "v1")).toThrow(CredentialCryptoError);
    expect(() => parseKeyring("   ", "v1")).toThrow(CredentialCryptoError);
  });

  // A short key is the classic way an "encrypted" store turns out not to
  // be.
  it("refuses a key that is not exactly 32 bytes", () => {
    expect(() => parseKeyring(`v1:${randomBytes(16).toString("base64")}`, "v1")).toThrow(/32 bytes/);
    expect(() => parseKeyring(`v1:${randomBytes(48).toString("base64")}`, "v1")).toThrow(/32 bytes/);
  });

  it("refuses an active id that names no key", () => {
    expect(() => parseKeyring(`v1:${KEY_A}`, "v9")).toThrow(/active key/);
    expect(() => parseKeyring(`v1:${KEY_A}`, undefined)).toThrow(/active key/);
  });

  it("refuses malformed entries", () => {
    expect(() => parseKeyring(KEY_A, "v1")).toThrow(/id:base64key/);
    expect(() => parseKeyring(`:${KEY_A}`, "v1")).toThrow(/id:base64key/);
    expect(() => parseKeyring(`v 1:${KEY_A}`, "v 1")).toThrow(/key id/);
  });

  it("refuses a repeated id", () => {
    expect(() => parseKeyring(`v1:${KEY_A},v1:${KEY_B}`, "v1")).toThrow(/more than once/);
  });

  // Two ids sharing material would make a rotation a no-op while looking
  // like it worked.
  it("refuses two ids that share the same key material", () => {
    expect(() => parseKeyring(`v1:${KEY_A},v2:${KEY_A}`, "v2")).toThrow(/same key material/);
  });
});

describe("sealing and opening", () => {
  it("round-trips a secret", () => {
    const keyring = ring();
    expect(openSecret(keyring, sealSecret(keyring, "hunter2", AAD), AAD)).toBe("hunter2");
  });

  it("round-trips unicode and long values", () => {
    const keyring = ring();
    const secret = `Müller-Straße ${"x".repeat(4000)} 🔐`;
    expect(openSecret(keyring, sealSecret(keyring, secret, AAD), AAD)).toBe(secret);
  });

  it("never produces the same ciphertext twice", () => {
    const keyring = ring();
    const first = sealSecret(keyring, "hunter2", AAD);
    const second = sealSecret(keyring, "hunter2", AAD);
    expect(first).not.toBe(second);
    // Both still open: the difference is the nonce, not the content.
    expect(openSecret(keyring, first, AAD)).toBe(openSecret(keyring, second, AAD));
  });

  it("does not leak the secret into the sealed form", () => {
    const keyring = ring();
    expect(sealSecret(keyring, "hunter2", AAD)).not.toContain("hunter2");
  });

  it("names the key that sealed it", () => {
    const keyring = parseKeyring(`v1:${KEY_A},v2:${KEY_B}`, "v2");
    expect(keyIdOf(sealSecret(keyring, "hunter2", AAD))).toBe("v2");
  });
});

describe("what must not open", () => {
  const keyring = ring();

  it("refuses a tampered ciphertext", () => {
    const sealed = sealSecret(keyring, "hunter2", AAD);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64url");

    expect(() => openSecret(keyring, parts.join("."), AAD)).toThrow(/could not be opened/);
  });

  it("refuses a tampered tag", () => {
    const parts = sealSecret(keyring, "hunter2", AAD).split(".");
    const flipped = Buffer.from(parts[2], "base64url");
    flipped[0] ^= 0xff;
    parts[2] = flipped.toString("base64url");

    expect(() => openSecret(keyring, parts.join("."), AAD)).toThrow(/could not be opened/);
  });

  it("refuses a tampered nonce", () => {
    const parts = sealSecret(keyring, "hunter2", AAD).split(".");
    const flipped = Buffer.from(parts[1], "base64url");
    flipped[0] ^= 0xff;
    parts[1] = flipped.toString("base64url");

    expect(() => openSecret(keyring, parts.join("."), AAD)).toThrow(/could not be opened/);
  });

  // The whole point of binding context into the tag: a row lifted from
  // one connection and pasted into another must not open.
  it("refuses a value sealed for a different context", () => {
    const sealed = sealSecret(keyring, "hunter2", AAD);
    const otherConnection = credentialContext("household-1", "connection-2", "api_token");
    const otherHousehold = credentialContext("household-2", "connection-1", "api_token");
    const otherPurpose = credentialContext("household-1", "connection-1", "password");

    for (const wrong of [otherConnection, otherHousehold, otherPurpose]) {
      expect(() => openSecret(keyring, sealed, wrong), wrong).toThrow(/could not be opened/);
    }
  });

  it("refuses a value sealed with a key this deployment no longer has", () => {
    const old = parseKeyring(`v1:${KEY_A}`, "v1");
    const sealed = sealSecret(old, "hunter2", AAD);
    const rotatedAway = parseKeyring(`v2:${KEY_B}`, "v2");

    expect(() => openSecret(rotatedAway, sealed, AAD)).toThrow(/No key "v1"/);
  });

  it("refuses a malformed value rather than guessing", () => {
    for (const bad of ["", "nonsense", "v1.only.three", "v1.a.b.c.d"]) {
      expect(() => openSecret(keyring, bad, AAD), bad).toThrow(CredentialCryptoError);
    }
  });

  // An attacker should not learn *why* a value failed to open.
  it("says the same thing however it failed", () => {
    const sealed = sealSecret(keyring, "hunter2", AAD);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 0xff;

    const wrongContext = () => openSecret(keyring, sealed, credentialContext("h", "c", "p"));
    const wrongContent = () => openSecret(keyring, [...parts.slice(0, 3), flipped.toString("base64url")].join("."), AAD);

    expect(wrongContext).toThrow("This credential could not be opened.");
    expect(wrongContent).toThrow("This credential could not be opened.");
  });
});

describe("rotation", () => {
  it("keeps old values readable after a new key is introduced", () => {
    const before = parseKeyring(`v1:${KEY_A}`, "v1");
    const sealed = sealSecret(before, "hunter2", AAD);

    const after = parseKeyring(`v1:${KEY_A},v2:${KEY_B}`, "v2");
    expect(openSecret(after, sealed, AAD)).toBe("hunter2");
  });

  it("re-seals an old value under the active key", () => {
    const before = parseKeyring(`v1:${KEY_A}`, "v1");
    const sealed = sealSecret(before, "hunter2", AAD);

    const after = parseKeyring(`v1:${KEY_A},v2:${KEY_B}`, "v2");
    const resealed = resealSecret(after, sealed, AAD);

    expect(resealed).not.toBeNull();
    expect(keyIdOf(resealed!)).toBe("v2");
    expect(openSecret(after, resealed!, AAD)).toBe("hunter2");

    // And once re-sealed, the old key can be dropped entirely.
    const keyGone = parseKeyring(`v2:${KEY_B}`, "v2");
    expect(openSecret(keyGone, resealed!, AAD)).toBe("hunter2");
  });

  // A rotation pass should skip rows it does not need to write.
  it("returns null for a value that is already current", () => {
    const keyring = parseKeyring(`v1:${KEY_A},v2:${KEY_B}`, "v2");
    expect(resealSecret(keyring, sealSecret(keyring, "hunter2", AAD), AAD)).toBeNull();
  });
});

describe("the deployment keyring", () => {
  // Resolved lazily: a household running no integrations should not have
  // to generate a key it will never use.
  it("reports itself unconfigured rather than throwing on a check", () => {
    resetKeyringCache();
    expect(isKeyringConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("reads the keys from the environment", () => {
    resetKeyringCache();
    const env = { CREDENTIAL_KEYS: `v1:${KEY_A}`, CREDENTIAL_ACTIVE_KEY: "v1" } as unknown as NodeJS.ProcessEnv;
    expect(isKeyringConfigured(env)).toBe(true);
    expect(getKeyring(env).activeKeyId).toBe("v1");
    resetKeyringCache();
  });

  // The failure mode is "you cannot connect this yet", never "we stored
  // your password badly".
  it("throws rather than degrading when asked to use a broken configuration", () => {
    resetKeyringCache();
    expect(() => getKeyring({ CREDENTIAL_KEYS: "v1:too-short" } as unknown as NodeJS.ProcessEnv)).toThrow(
      CredentialCryptoError
    );
    resetKeyringCache();
  });
});
