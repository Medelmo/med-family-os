import { describe, expect, it } from "vitest";
import { authorizeHouseholdSettingsAccess, authorizePersonAccess } from "../../../application/policies/household";

const owner = { userId: "owner", householdId: "h1", role: "OWNER" as const, personIds: [] };
const admin = { userId: "admin", householdId: "h1", role: "ADMIN" as const, personIds: [] };
const adult = { userId: "adult", householdId: "h1", role: "ADULT" as const, personIds: ["p-adult"] };
const child = { userId: "child", householdId: "h1", role: "CHILD" as const, personIds: ["p-child"] };
const viewer = { userId: "viewer", householdId: "h1", role: "VIEWER" as const, personIds: [] };

describe("authorizeHouseholdSettingsAccess (docs/permissions.md 'Household settings' row)", () => {
  it("grants OWNER/ADMIN full access", () => {
    expect(authorizeHouseholdSettingsAccess(owner, "update", "h1")).toBe(true);
    expect(authorizeHouseholdSettingsAccess(admin, "update", "h1")).toBe(true);
  });

  it("grants ADULT read-only ('limited') access", () => {
    expect(authorizeHouseholdSettingsAccess(adult, "read", "h1")).toBe(true);
    expect(authorizeHouseholdSettingsAccess(adult, "update", "h1")).toBe(false);
    expect(authorizeHouseholdSettingsAccess(adult, "create", "h1")).toBe(false);
  });

  it("denies CHILD/VIEWER entirely, including read", () => {
    expect(authorizeHouseholdSettingsAccess(child, "read", "h1")).toBe(false);
    expect(authorizeHouseholdSettingsAccess(viewer, "read", "h1")).toBe(false);
  });

  it("denies cross-household access regardless of role", () => {
    expect(authorizeHouseholdSettingsAccess(owner, "read", "h2")).toBe(false);
  });
});

describe("authorizePersonAccess (docs/permissions.md 'People' row)", () => {
  const otherPersonRow = {
    householdId: "h1",
    personId: "p-other",
    accountUserId: null,
    visibility: "HOUSEHOLD" as const,
    sensitivity: "NORMAL" as const,
  };
  const ownPersonRow = {
    householdId: "h1",
    personId: "p-child",
    accountUserId: "child",
    visibility: "HOUSEHOLD" as const,
    sensitivity: "NORMAL" as const,
  };

  it("grants ADULT household-scoped read/write on any person row", () => {
    expect(authorizePersonAccess(adult, "read", otherPersonRow)).toBe(true);
    expect(authorizePersonAccess(adult, "update", otherPersonRow)).toBe(true);
  });

  it("denies CHILD access to another household member's row", () => {
    expect(authorizePersonAccess(child, "read", otherPersonRow)).toBe(false);
  });

  it("grants CHILD access to their own row ('self')", () => {
    expect(authorizePersonAccess(child, "read", ownPersonRow)).toBe(true);
  });

  it("still denies CHILD delete even on their own row", () => {
    expect(authorizePersonAccess(child, "delete", ownPersonRow)).toBe(false);
  });

  it("grants VIEWER read but not write", () => {
    expect(authorizePersonAccess(viewer, "read", otherPersonRow)).toBe(true);
    expect(authorizePersonAccess(viewer, "update", otherPersonRow)).toBe(false);
  });
});
