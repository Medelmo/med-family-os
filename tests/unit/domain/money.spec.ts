import { describe, expect, it } from "vitest";
import { formatMinorAsDecimal, minorUnitDigits, parseAmountToMinor } from "../../../domain/finance/money";

/**
 * Money parsing is where a household finance tool quietly goes wrong: a
 * German "1.234,56" read as American, or a rounding error accumulated in a
 * float, produces numbers that look plausible and are not. Every rule in
 * domain/finance/money.ts is pinned here, including the ambiguous cases
 * where the rule had to be chosen rather than derived.
 */
describe("parseAmountToMinor", () => {
  it("parses a plain decimal", () => {
    expect(parseAmountToMinor("12.34")).toEqual({ ok: true, amountMinor: 1234 });
  });

  it("parses a German decimal comma", () => {
    expect(parseAmountToMinor("12,34")).toEqual({ ok: true, amountMinor: 1234 });
  });

  it("parses a whole number with no separator", () => {
    expect(parseAmountToMinor("40")).toEqual({ ok: true, amountMinor: 4000 });
  });

  it("treats the last separator as the decimal one when both appear", () => {
    expect(parseAmountToMinor("1.234,56")).toEqual({ ok: true, amountMinor: 123456 });
    expect(parseAmountToMinor("1,234.56")).toEqual({ ok: true, amountMinor: 123456 });
  });

  it("handles several grouping separators", () => {
    expect(parseAmountToMinor("1.234.567,89")).toEqual({ ok: true, amountMinor: 123456789 });
  });

  // The documented resolution of genuinely ambiguous input: three trailing
  // digits after a lone separator is grouping, not a decimal. This is the
  // rule that can be wrong by a factor of a thousand, which is why CSV
  // import confirms every parsed row before writing.
  it("reads a lone separator followed by exactly three digits as grouping", () => {
    expect(parseAmountToMinor("1,234")).toEqual({ ok: true, amountMinor: 123400 });
    expect(parseAmountToMinor("1.234")).toEqual({ ok: true, amountMinor: 123400 });
  });

  it("reads a lone separator followed by one or two digits as a decimal", () => {
    expect(parseAmountToMinor("1,2")).toEqual({ ok: true, amountMinor: 120 });
    expect(parseAmountToMinor("1,23")).toEqual({ ok: true, amountMinor: 123 });
  });

  it("accepts a leading or trailing minus", () => {
    expect(parseAmountToMinor("-12,34")).toEqual({ ok: true, amountMinor: -1234 });
    expect(parseAmountToMinor("12,34-")).toEqual({ ok: true, amountMinor: -1234 });
  });

  it("ignores currency symbols and spacing, including non-breaking spaces", () => {
    expect(parseAmountToMinor("€ 1.234,56")).toEqual({ ok: true, amountMinor: 123456 });
    expect(parseAmountToMinor("1 234,56")).toEqual({ ok: true, amountMinor: 123456 });
    expect(parseAmountToMinor("12,34 EUR")).toEqual({ ok: true, amountMinor: 1234 });
  });

  it("respects a currency with no minor unit", () => {
    expect(parseAmountToMinor("1200", "JPY")).toEqual({ ok: true, amountMinor: 1200 });
    // With zero minor-unit digits there is no decimal reading available,
    // so a separator can only be grouping.
    expect(parseAmountToMinor("1,200", "JPY")).toEqual({ ok: true, amountMinor: 1200 });
  });

  it("rejects rather than rounds when there are too many decimal places", () => {
    expect(parseAmountToMinor("12,3456")).toMatchObject({ ok: false });
    expect(parseAmountToMinor("1.234,567")).toMatchObject({ ok: false });
    expect(parseAmountToMinor("1.5", "JPY")).toMatchObject({ ok: false });
  });

  // The uncomfortable consequence of the grouping rule, pinned so it can
  // never change by accident: a German "12,345" means twelve-point-three-
  // four-five, but it is indistinguishable from an English twelve
  // thousand, and the rule chooses grouping. Nothing in the string can
  // settle it, which is the argument for confirming imported rows.
  it("reads three trailing digits as grouping even where a locale would disagree", () => {
    expect(parseAmountToMinor("12,345")).toEqual({ ok: true, amountMinor: 1234500 });
  });

  it("rejects input that is not a number", () => {
    for (const input of ["", "   ", "abc", "€", "1-2", "--5"]) {
      expect(parseAmountToMinor(input), input).toMatchObject({ ok: false });
    }
  });

  it("never returns a value that would lose precision", () => {
    expect(parseAmountToMinor("999999999999999999")).toMatchObject({ ok: false });
  });
});

describe("formatMinorAsDecimal", () => {
  it("round-trips through the parser", () => {
    for (const minor of [0, 5, 99, 100, 1234, -1234, 123456789]) {
      const text = formatMinorAsDecimal(minor);
      expect(parseAmountToMinor(text), text).toEqual({ ok: true, amountMinor: minor });
    }
  });

  it("pads the fraction", () => {
    expect(formatMinorAsDecimal(5)).toBe("0.05");
    expect(formatMinorAsDecimal(50)).toBe("0.50");
    expect(formatMinorAsDecimal(-5)).toBe("-0.05");
  });

  it("omits the fraction for a zero-decimal currency", () => {
    expect(formatMinorAsDecimal(1200, "JPY")).toBe("1200");
  });
});

describe("minorUnitDigits", () => {
  it("defaults to two and is case-insensitive", () => {
    expect(minorUnitDigits("EUR")).toBe(2);
    expect(minorUnitDigits("xyz")).toBe(2);
    expect(minorUnitDigits("jpy")).toBe(0);
  });
});
