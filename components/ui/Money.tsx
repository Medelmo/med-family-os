"use client";

import { useFormatter } from "next-intl";
import { minorUnitDigits } from "../../domain/finance/money";

export interface MoneyProps {
  amountMinor: number;
  currency: string;
  /** Renders a negative amount in the "over budget" colour. */
  signed?: boolean;
}

/**
 * Renders an amount in the reader's locale.
 *
 * This is the *only* place minor units are turned into a decimal, and it
 * happens at the very edge, for display alone — CLAUDE.md §14 requires
 * locale-aware currency formatting, and ADR-015 keeps every calculation in
 * integers so no total is ever computed from the divided value.
 *
 * `<data value>` rather than a bare span: the machine-readable amount
 * stays attached to the human-readable one, which is what lets a test (or
 * a future export) assert on the figure without parsing a localised
 * string.
 */
export function Money({ amountMinor, currency, signed = false }: MoneyProps) {
  const format = useFormatter();
  const value = amountMinor / 10 ** minorUnitDigits(currency);

  return (
    <data value={String(value)} data-negative={signed && amountMinor < 0 ? "true" : undefined}>
      {format.number(value, { style: "currency", currency })}
    </data>
  );
}
