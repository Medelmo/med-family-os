/**
 * Money, as integer minor units plus an ISO 4217 code.
 *
 * Never a float: 0.1 + 0.2 is not 0.3 in IEEE 754, and a household that
 * cannot make its own expense list add up will not trust anything else the
 * app says. Never a bare number either — an amount without a currency is
 * not an amount, and "the household's currency" is a setting that can
 * change while historical records must not.
 *
 * Formatting is deliberately absent from this module: it is locale-aware
 * presentation (CLAUDE.md §14) and belongs with next-intl in the UI, which
 * has the user's locale. This layer only ever moves integers around.
 */

export interface Money {
  /** Cents, not euros. 12.34 EUR is 1234. */
  amountMinor: number;
  /** ISO 4217, uppercase, e.g. "EUR". */
  currency: string;
}

/**
 * Currencies whose minor unit is not 1/100.
 *
 * Deliberately short: it covers the zero-decimal currencies a European
 * household plausibly meets (a Japanese or Korean invoice, a trip to
 * Iceland) rather than pretending to be a complete ISO 4217 table, which
 * would be stale data this app has no way to verify. Anything absent is
 * treated as two decimals, which is right for every currency the household
 * is realistically holding.
 */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  ISK: 0,
  CLP: 0,
  VND: 0,
  HUF: 0,
};

export const DEFAULT_CURRENCY = "EUR";

export function minorUnitDigits(currency: string): number {
  return MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;
}

export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/**
 * Parses a human-typed amount into minor units.
 *
 * The hard part is that "1,234" means 1234 to a German and 1.234 to
 * an American, and a bank CSV export gives no hint which it is. The rule
 * here is explicit, total, and tested rather than left to a locale guess:
 *
 * 1. Strip spaces (including non-breaking) and any currency symbol.
 * 2. A leading "-" or a trailing "-" (some German exports) means negative.
 * 3. If both "." and "," appear, the *last* one is the decimal separator
 *    and the other is a grouping separator. This is correct for both
 *    "1.234,56" and "1,234.56".
 * 4. If only one appears, it is a decimal separator when it is followed by
 *    fewer digits than the currency's minor-unit digits, or by exactly
 *    that many; it is a grouping separator when followed by exactly three
 *    digits *and* the currency has fewer than three minor-unit digits.
 *    So "1,234" is 1234.00 and "1,23" is 1.23.
 * 5. Anything else is rejected rather than guessed at.
 *
 * Rule 4 is genuinely ambiguous input, and the choice made here can be
 * wrong by a factor of a thousand. That is why CSV import shows every
 * parsed row for confirmation before anything is written, rather than
 * trusting this function on its own.
 */
export type AmountParseResult = { ok: true; amountMinor: number } | { ok: false; reason: string };

export function parseAmountToMinor(input: string, currency: string = DEFAULT_CURRENCY): AmountParseResult {
  const digits = minorUnitDigits(currency);

  let text = input.replace(/[\s  ]/g, "").replace(/[^\d.,+-]/g, "");
  if (text === "") return { ok: false, reason: "empty" };

  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  }
  text = text.replace(/^\+/, "");
  if (/[+-]/.test(text)) return { ok: false, reason: "misplaced sign" };
  if (text === "") return { ok: false, reason: "empty" };

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalSeparatorAt = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalSeparatorAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const only = Math.max(lastDot, lastComma);
    const trailing = text.length - only - 1;
    const looksLikeGrouping = trailing === 3 && digits < 3;
    decimalSeparatorAt = looksLikeGrouping ? -1 : only;
    if (!looksLikeGrouping && trailing > digits) {
      return { ok: false, reason: "too many decimal places" };
    }
  }

  const wholeText = (decimalSeparatorAt >= 0 ? text.slice(0, decimalSeparatorAt) : text).replace(/[.,]/g, "");
  const fractionText = decimalSeparatorAt >= 0 ? text.slice(decimalSeparatorAt + 1) : "";

  if (!/^\d*$/.test(wholeText) || !/^\d*$/.test(fractionText)) return { ok: false, reason: "not a number" };
  if (wholeText === "" && fractionText === "") return { ok: false, reason: "empty" };
  if (fractionText.length > digits) return { ok: false, reason: "too many decimal places" };

  const whole = wholeText === "" ? 0 : Number(wholeText);
  const fraction = fractionText === "" ? 0 : Number(fractionText.padEnd(digits, "0"));
  const amountMinor = whole * 10 ** digits + fraction;

  if (!Number.isSafeInteger(amountMinor)) return { ok: false, reason: "out of range" };
  return { ok: true, amountMinor: negative ? -amountMinor : amountMinor };
}

/**
 * Minor units back to a plain machine-readable decimal ("1234" -> "12.34").
 *
 * For CSV export and for round-tripping through a number input — not for
 * display, which is the UI's locale-aware job.
 */
export function formatMinorAsDecimal(amountMinor: number, currency: string = DEFAULT_CURRENCY): string {
  const digits = minorUnitDigits(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  if (digits === 0) return `${sign}${absolute}`;
  const whole = Math.floor(absolute / 10 ** digits);
  const fraction = String(absolute % 10 ** digits).padStart(digits, "0");
  return `${sign}${whole}.${fraction}`;
}

/** Sums amounts that must already share a currency; the caller groups. */
export function sumMinor(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
