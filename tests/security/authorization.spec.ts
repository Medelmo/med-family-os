import { describe, expect, it } from "vitest";
import { canAccess } from "../../application/policies/authorize";

const owner = { userId: "owner", householdId: "h1", role: "OWNER" as const, personIds: [] };
const adult = { userId: "adult", householdId: "h1", role: "ADULT" as const, personIds: ["p1"] };
const otherAdult = { userId: "adult2", householdId: "h1", role: "ADULT" as const, personIds: ["p3"] };
const child = { userId: "child", householdId: "h1", role: "CHILD" as const, personIds: ["p2"] };
const viewer = { userId: "viewer", householdId: "h1", role: "VIEWER" as const, personIds: [] };

const householdNormal = { householdId: "h1", visibility: "HOUSEHOLD" as const, sensitivity: "NORMAL" as const };

describe("authorization: household boundary (BOLA/IDOR)", () => {
  it("rejects cross-household access regardless of role", () => {
    expect(canAccess(adult, "read", { ...householdNormal, householdId: "h2" })).toBe(false);
    expect(canAccess(owner, "read", { ...householdNormal, householdId: "h2" })).toBe(false);
  });
});

describe("authorization: VIEWER is read-only", () => {
  it("allows VIEWER to read household-normal data", () => {
    expect(canAccess(viewer, "read", householdNormal)).toBe(true);
  });

  it("rejects VIEWER create/update/delete/archive on household-normal data", () => {
    expect(canAccess(viewer, "create", householdNormal)).toBe(false);
    expect(canAccess(viewer, "update", householdNormal)).toBe(false);
    expect(canAccess(viewer, "delete", householdNormal)).toBe(false);
    expect(canAccess(viewer, "archive", householdNormal)).toBe(false);
  });
});

describe("authorization: CHILD default-deny (no inherited adult access)", () => {
  it("rejects CHILD access to sensitive/highly-sensitive data", () => {
    expect(canAccess(child, "read", { ...householdNormal, sensitivity: "SENSITIVE" })).toBe(false);
    expect(canAccess(child, "read", { ...householdNormal, sensitivity: "HIGHLY_SENSITIVE" })).toBe(false);
  });

  it("rejects CHILD access to an unscoped HOUSEHOLD-visible normal resource", () => {
    // No ownerUserId / allowedUserIds / personScopeIds set: this must NOT be
    // treated as open-to-everyone. Regression test for the fail-open bug.
    expect(canAccess(child, "read", householdNormal)).toBe(false);
    expect(canAccess(child, "create", householdNormal)).toBe(false);
  });

  it("allows CHILD access when explicitly scoped via personScopeIds", () => {
    expect(canAccess(child, "read", { ...householdNormal, personScopeIds: ["p2"] })).toBe(true);
    expect(canAccess(child, "update", { ...householdNormal, personScopeIds: ["p2"] })).toBe(true);
  });

  it("allows CHILD access when explicitly scoped via allowedUserIds or ownership", () => {
    expect(canAccess(child, "read", { ...householdNormal, allowedUserIds: ["child"] })).toBe(true);
    expect(canAccess(child, "read", { ...householdNormal, ownerUserId: "child" })).toBe(true);
  });

  it("rejects CHILD delete even when explicitly scoped", () => {
    expect(canAccess(child, "delete", { ...householdNormal, personScopeIds: ["p2"] })).toBe(false);
  });
});

describe("authorization: PRIVATE visibility and allow-lists", () => {
  it("rejects non-owner access to PRIVATE resources", () => {
    expect(canAccess(adult, "read", { ...householdNormal, visibility: "PRIVATE", ownerUserId: "adult2" })).toBe(false);
  });

  it("allows owner access to their own PRIVATE resource", () => {
    expect(canAccess(adult, "read", { ...householdNormal, visibility: "PRIVATE", ownerUserId: "adult" })).toBe(true);
  });

  it("rejects ADULT access when excluded from an explicit allow-list", () => {
    expect(canAccess(otherAdult, "read", { ...householdNormal, allowedUserIds: ["adult"] })).toBe(false);
  });

  it("OWNER/ADMIN bypass allow-list and person-scope restrictions", () => {
    expect(canAccess(owner, "read", { ...householdNormal, allowedUserIds: ["adult"] })).toBe(true);
    expect(canAccess(owner, "delete", { ...householdNormal, visibility: "PRIVATE", ownerUserId: "adult" })).toBe(true);
  });
});

describe("authorization: ADULT baseline", () => {
  it("allows ADULT create/read/update/delete on household-normal data", () => {
    expect(canAccess(adult, "read", householdNormal)).toBe(true);
    expect(canAccess(adult, "create", householdNormal)).toBe(true);
    expect(canAccess(adult, "update", householdNormal)).toBe(true);
    expect(canAccess(adult, "delete", householdNormal)).toBe(true);
  });
});
