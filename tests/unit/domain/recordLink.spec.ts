import { describe, expect, it } from "vitest";
import {
  canonicalise,
  isLinkableType,
  otherEnd,
  validateLink,
  LINKABLE_TYPES,
  type RecordRef,
} from "../../../domain/links/recordLink";

const ref = (type: string, id: string): RecordRef => ({ type: type as RecordRef["type"], id });

describe("canonical ordering", () => {
  it("puts the same pair in the same order whichever way round it is given", () => {
    const a = ref("document", "aaaa");
    const b = ref("case", "bbbb");

    expect(canonicalise(a, b)).toEqual(canonicalise(b, a));
  });

  // PostgreSQL compares enum values by declared order, and a CHECK
  // constraint enforces that order. Comparing type names as strings here
  // would disagree for any pair whose alphabetical and declared orders
  // differ - and task/expense is exactly such a pair.
  it("orders by declaration, not alphabetically", () => {
    const { source } = canonicalise(ref("expense", "1111"), ref("task", "2222"));
    // "expense" sorts before "task" alphabetically, but task is declared
    // first, so task is the source.
    expect(source.type).toBe("task");
  });

  it("agrees with the declared order for every pair of types", () => {
    for (const first of LINKABLE_TYPES) {
      for (const second of LINKABLE_TYPES) {
        if (first === second) continue;
        const { source, target } = canonicalise(ref(first, "1111"), ref(second, "2222"));
        expect(
          LINKABLE_TYPES.indexOf(source.type) < LINKABLE_TYPES.indexOf(target.type),
          `${first} + ${second}`
        ).toBe(true);
      }
    }
  });

  it("breaks a same-type tie by id", () => {
    const { source, target } = canonicalise(ref("case", "bbbb"), ref("case", "aaaa"));
    expect(source.id).toBe("aaaa");
    expect(target.id).toBe("bbbb");
  });
});

describe("validating a link", () => {
  it("accepts two different records", () => {
    expect(validateLink(ref("case", "1111"), ref("document", "2222"))).toMatchObject({ ok: true });
  });

  it("refuses a record linked to itself", () => {
    expect(validateLink(ref("case", "1111"), ref("case", "1111"))).toMatchObject({
      ok: false,
      rejection: { code: "SELF_LINK" },
    });
  });

  it("accepts two different records of the same type", () => {
    expect(validateLink(ref("case", "1111"), ref("case", "2222"))).toMatchObject({ ok: true });
  });

  it("refuses a type it does not know", () => {
    expect(validateLink(ref("household", "1111"), ref("case", "2222"))).toMatchObject({
      ok: false,
      rejection: { code: "UNKNOWN_TYPE" },
    });
  });

  it("knows which types are linkable", () => {
    expect(isLinkableType("case")).toBe(true);
    expect(isLinkableType("household")).toBe(false);
  });
});

describe("reading a link from one end", () => {
  // Storage is canonical rather than directional, so "the other one" has
  // to be worked out on read: a case may sit in either column depending
  // on how the types happened to sort.
  it("returns the far end whichever column the record is in", () => {
    const link = { sourceType: "task" as const, sourceId: "1111", targetType: "document" as const, targetId: "2222" };

    expect(otherEnd(link, ref("task", "1111"))).toEqual({ type: "document", id: "2222" });
    expect(otherEnd(link, ref("document", "2222"))).toEqual({ type: "task", id: "1111" });
  });

  it("distinguishes two records of the same type", () => {
    const link = { sourceType: "case" as const, sourceId: "aaaa", targetType: "case" as const, targetId: "bbbb" };

    expect(otherEnd(link, ref("case", "aaaa")).id).toBe("bbbb");
    expect(otherEnd(link, ref("case", "bbbb")).id).toBe("aaaa");
  });
});
