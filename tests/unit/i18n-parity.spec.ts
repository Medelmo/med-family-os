import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import de from "../../messages/de.json";

/**
 * Both locales must carry the same keys.
 *
 * next-intl throws when a key is missing rather than falling back, so a
 * key added to English and forgotten in German is not a cosmetic gap — it
 * is a crash on that page for a German-speaking household, and it will not
 * be caught by a typecheck, a lint, or any test that happens to run in
 * English. This project has already shipped one render-time message bug
 * that 103 green tests did not notice (the dotted-key problem in Phase 2).
 *
 * The comparison is over full dotted paths, so a namespace present in one
 * locale and absent in the other is caught too.
 */
type Messages = Record<string, unknown>;

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value as Messages).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("message catalogues", () => {
  const enKeys = keyPaths(en).sort();
  const deKeys = keyPaths(de).sort();

  it("has the same keys in English and German", () => {
    expect({
      missingInGerman: enKeys.filter((key) => !deKeys.includes(key)),
      missingInEnglish: deKeys.filter((key) => !enKeys.includes(key)),
    }).toEqual({ missingInGerman: [], missingInEnglish: [] });
  });

  it("has no empty strings, which read as a missing translation", () => {
    const empty = (locale: Messages, name: string) =>
      keyPaths(locale)
        .filter((path) => {
          const value = path.split(".").reduce<unknown>((node, key) => (node as Messages)?.[key], locale);
          return typeof value === "string" && value.trim() === "";
        })
        .map((path) => `${name}:${path}`);

    expect([...empty(en, "en"), ...empty(de, "de")]).toEqual([]);
  });

  // ICU placeholders are part of the contract between a message and its
  // call site. A translation that drops one renders a sentence with a hole
  // in it; one that invents a name throws.
  it("uses the same ICU placeholders in both locales", () => {
    // An argument is a `{` followed by an identifier and then `,` or `}`.
    // The trailing lookahead is what distinguishes `{count, plural, …}`
    // from a plural *branch body* like `{No rows can be imported}`, which
    // a naive `\{(\w+)` reads as an argument named "No". This is an
    // approximation rather than an ICU parser: a single-word branch body
    // would still be mistaken for an argument. There are none today, and
    // the failure mode is a false alarm, not a missed one.
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[,}])/g)].map((match) => match[1]).sort();

    const mismatches: string[] = [];
    for (const path of enKeys) {
      const read = (locale: Messages) => path.split(".").reduce<unknown>((node, key) => (node as Messages)?.[key], locale);
      const source = read(en);
      const target = read(de);
      if (typeof source !== "string" || typeof target !== "string") continue;

      const a = [...new Set(placeholders(source))];
      const b = [...new Set(placeholders(target))];
      if (a.join(",") !== b.join(",")) mismatches.push(`${path}: en[${a}] vs de[${b}]`);
    }

    expect(mismatches).toEqual([]);
  });
});
