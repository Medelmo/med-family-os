import { parseCsv } from "./csv";
import { EXPENSE_CATEGORIES, isExpenseCategory, type ExpenseCategory } from "./expense";
import { DEFAULT_CURRENCY, parseAmountToMinor } from "./money";

/**
 * Turns a CSV file into a reviewable plan.
 *
 * Nothing here writes anything, and that is the point. ADR-015 §2 commits
 * to showing every parsed row and its interpreted amount before anything
 * is stored, because the amount rule is knowingly ambiguous for input like
 * `1,234` and can be wrong by a factor of a thousand. A plan the household
 * can read is the only honest way to use a parser with that property.
 *
 * The same function runs again on confirmation, against the same text, so
 * the preview and the write cannot disagree about what the file said.
 */

export const IMPORT_MAX_ROWS = 1000;

/** Header names accepted for each field, lowercased. German and English. */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  incurredOn: ["date", "datum", "buchungstag", "belegdatum"],
  description: ["description", "what", "beschreibung", "verwendungszweck", "wofür", "wofuer", "text"],
  amount: ["amount", "betrag", "summe"],
  currency: ["currency", "währung", "waehrung"],
  category: ["category", "kategorie"],
  merchant: ["merchant", "where", "wo", "händler", "haendler", "empfänger", "empfaenger"],
};

export const REQUIRED_COLUMNS = ["incurredOn", "description", "amount"] as const;

export interface ImportRowProblem {
  code: "MISSING_DESCRIPTION" | "BAD_DATE" | "BAD_AMOUNT" | "NON_POSITIVE_AMOUNT" | "BAD_CURRENCY" | "UNKNOWN_CATEGORY";
  detail?: string;
}

export interface PlannedRow {
  /** 1-based line number in the file, counting the header — so it matches what a spreadsheet shows. */
  line: number;
  raw: Record<string, string>;
  description: string;
  incurredOn: string;
  amountMinor: number;
  currency: string;
  category: ExpenseCategory;
  merchant: string | null;
  problems: ImportRowProblem[];
  /** An expense with the same date, description, amount and currency already exists. */
  possibleDuplicate: boolean;
}

export type ImportPlan =
  | { ok: false; error: "EMPTY_FILE" | "NO_HEADER" | "TOO_MANY_ROWS"; missingColumns?: string[] }
  | { ok: false; error: "MISSING_COLUMNS"; missingColumns: string[] }
  | { ok: true; rows: PlannedRow[]; importable: number; rejected: number };

export interface DuplicateKeySet {
  has(key: string): boolean;
}

/** The key a duplicate is judged on — deliberately not the merchant or category, which people re-categorise. */
export function duplicateKey(row: {
  incurredOn: string;
  description: string;
  amountMinor: number;
  currency: string;
}): string {
  return [row.incurredOn, row.description.trim().toLowerCase(), row.amountMinor, row.currency].join("|");
}

export function planExpenseImport(
  text: string,
  options: { defaultCurrency?: string; existing?: DuplicateKeySet } = {}
): ImportPlan {
  const defaultCurrency = options.defaultCurrency ?? DEFAULT_CURRENCY;
  const table = parseCsv(text);

  if (table.length === 0) return { ok: false, error: "EMPTY_FILE" };
  if (table.length === 1) return { ok: false, error: "NO_HEADER" };
  if (table.length - 1 > IMPORT_MAX_ROWS) return { ok: false, error: "TOO_MANY_ROWS" };

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const columnIndex: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex((name) => aliases.includes(name));
    if (index >= 0) columnIndex[field] = index;
  }

  const missingColumns = REQUIRED_COLUMNS.filter((field) => columnIndex[field] === undefined);
  if (missingColumns.length > 0) return { ok: false, error: "MISSING_COLUMNS", missingColumns: [...missingColumns] };

  const rows: PlannedRow[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const cell = (field: keyof typeof HEADER_ALIASES): string => {
      const index = columnIndex[field];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };

    const problems: ImportRowProblem[] = [];

    const description = cell("description");
    if (!description) problems.push({ code: "MISSING_DESCRIPTION" });

    const incurredOn = normaliseDate(cell("incurredOn"));
    if (!incurredOn) problems.push({ code: "BAD_DATE", detail: cell("incurredOn") });

    const currencyRaw = cell("currency").toUpperCase();
    let currency = defaultCurrency;
    if (currencyRaw) {
      if (/^[A-Z]{3}$/.test(currencyRaw)) currency = currencyRaw;
      else problems.push({ code: "BAD_CURRENCY", detail: currencyRaw });
    }

    const amountRaw = cell("amount");
    const parsedAmount = parseAmountToMinor(amountRaw, currency);
    let amountMinor = 0;
    if (!parsedAmount.ok) {
      problems.push({ code: "BAD_AMOUNT", detail: amountRaw });
    } else if (parsedAmount.amountMinor <= 0) {
      // A bank export mixes income and spending, and a minus sign is how
      // it tells them apart. This app records spending, so a credit is
      // reported and skipped rather than silently stored as a negative
      // expense that would quietly reduce a category total.
      problems.push({ code: "NON_POSITIVE_AMOUNT", detail: amountRaw });
      amountMinor = parsedAmount.amountMinor;
    } else {
      amountMinor = parsedAmount.amountMinor;
    }

    const categoryRaw = cell("category").toUpperCase();
    let category: ExpenseCategory = "OTHER";
    if (categoryRaw) {
      if (isExpenseCategory(categoryRaw)) category = categoryRaw;
      else problems.push({ code: "UNKNOWN_CATEGORY", detail: cell("category") });
    }

    const merchant = cell("merchant") || null;

    const planned: PlannedRow = {
      line: i + 1,
      raw: Object.fromEntries(header.map((name, index) => [name || `column${index + 1}`, cells[index] ?? ""])),
      description,
      incurredOn: incurredOn ?? "",
      amountMinor,
      currency,
      category,
      merchant,
      problems,
      possibleDuplicate: false,
    };

    planned.possibleDuplicate =
      problems.length === 0 && (options.existing?.has(duplicateKey(planned)) ?? false);

    rows.push(planned);
  }

  const rejected = rows.filter((row) => row.problems.length > 0).length;
  return { ok: true, rows, importable: rows.length - rejected, rejected };
}

/**
 * Accepts the date formats a European household's exports actually use.
 *
 * `12/05/2026` is deliberately **not** accepted: it means 12 May to half
 * the world and 5 December to the other half, and nothing in the file
 * settles it. Guessing would put an expense in the wrong month silently,
 * which is exactly the class of error this whole flow exists to prevent.
 */
function normaliseDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return isRealDate(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;

  // German: 12.05.2026 or 12.5.26
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text);
  if (german) {
    const day = german[1].padStart(2, "0");
    const month = german[2].padStart(2, "0");
    const year = german[3].length === 2 ? `20${german[3]}` : german[3];
    return isRealDate(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  return null;
}

function isRealDate(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1) return false;
  // Day 0 of the next month is the last day of this one.
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The header this app writes, and the one the importer is happiest with. */
export const EXPORT_HEADER = ["Date", "Description", "Amount", "Currency", "Category", "Merchant"] as const;

export const IMPORT_TEMPLATE = [
  EXPORT_HEADER.join(","),
  `2026-05-12,Dentist check-up,89.90,EUR,${EXPENSE_CATEGORIES[3]},Praxis Müller`,
].join("\r\n");
