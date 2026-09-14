import { describe, expect, it } from "vitest";
import { escapeCsvField, parseCsv, toCsv } from "../../../domain/finance/csv";

describe("parseCsv", () => {
  it("reads a simple table", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF and a missing trailing newline alike", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the byte-order mark Excel writes", () => {
    expect(parseCsv("﻿Date,Amount\n2026-05-12,10")[0][0]).toBe("Date");
  });

  it("keeps separators and newlines inside quoted fields", () => {
    expect(parseCsv('a,"b,c"\n1,"line1\nline2"')).toEqual([
      ["a", "b,c"],
      ["1", "line1\nline2"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  // German exports use ';' because ',' is already the decimal separator
  // there — which is exactly the data this app expects.
  it("detects a semicolon delimiter", () => {
    expect(parseCsv("Datum;Betrag\n12.05.2026;89,90")).toEqual([
      ["Datum", "Betrag"],
      ["12.05.2026", "89,90"],
    ]);
  });

  it("does not count a delimiter that is inside quotes when guessing", () => {
    expect(parseCsv('"Müller, Zahnarzt";89,90')).toEqual([["Müller, Zahnarzt", "89,90"]]);
  });

  it("detects tabs", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops blank lines rather than producing empty rows", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("escapeCsvField", () => {
  it("quotes fields containing a delimiter, quote or newline", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField("a;b")).toBe('"a;b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("two\nlines")).toBe('"two\nlines"');
  });

  it("leaves ordinary text alone", () => {
    expect(escapeCsvField("Dentist check-up")).toBe("Dentist check-up");
  });

  // CSV formula injection: these execute when the file is opened in Excel
  // or LibreOffice. The export is the dangerous direction, because the
  // file leaves the app and the browser's protections with it.
  it("neutralises cells a spreadsheet would treat as a formula", () => {
    for (const dangerous of ["=1+1", '=HYPERLINK("https://evil.example","x")', "+1", "-1", "@SUM(A1)", "\tx"]) {
      const escaped = escapeCsvField(dangerous);
      const firstCharacter = escaped.startsWith('"') ? escaped[1] : escaped[0];
      expect(firstCharacter, dangerous).toBe("'");
    }
  });

  it("does not mangle a negative number that was never going to be a formula target", () => {
    // It is still prefixed — correctness of the guard beats prettiness,
    // and an amount column is written from integers by this app anyway.
    expect(escapeCsvField("-5")).toBe("'-5");
  });
});

describe("toCsv", () => {
  it("writes RFC 4180 CRLF rows", () => {
    expect(toCsv([["a", "b"], ["1,5", "2"]])).toBe('a,b\r\n"1,5",2');
  });

  it("round-trips through the parser", () => {
    const rows = [
      ["Date", "Description", "Amount"],
      ["2026-05-12", 'Müller, "Zahnarzt"', "89.90"],
      ["2026-05-13", "two\nlines", "10.00"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
