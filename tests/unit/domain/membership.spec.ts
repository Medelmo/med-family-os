import { describe, expect, it } from "vitest";
import { wouldLeaveHouseholdWithoutOwner } from "../../../domain/family/membership";

const baseMembership = { status: "ACTIVE" as const };

describe("wouldLeaveHouseholdWithoutOwner", () => {
  it("allows promoting a member to OWNER regardless of other owners", () => {
    const memberships = [{ id: "m1", role: "OWNER" as const, ...baseMembership }];
    expect(wouldLeaveHouseholdWithoutOwner(memberships, "m1", "OWNER")).toBe(false);
  });

  it("rejects demoting the sole OWNER", () => {
    const memberships = [{ id: "m1", role: "OWNER" as const, ...baseMembership }];
    expect(wouldLeaveHouseholdWithoutOwner(memberships, "m1", "ADMIN")).toBe(true);
  });

  it("allows demoting an OWNER when another active OWNER remains", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, ...baseMembership },
      { id: "m2", role: "OWNER" as const, ...baseMembership },
    ];
    expect(wouldLeaveHouseholdWithoutOwner(memberships, "m1", "ADMIN")).toBe(false);
  });

  it("does not count a SUSPENDED/REMOVED OWNER as a remaining owner", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, status: "ACTIVE" as const },
      { id: "m2", role: "OWNER" as const, status: "SUSPENDED" as const },
    ];
    expect(wouldLeaveHouseholdWithoutOwner(memberships, "m1", "ADMIN")).toBe(true);
  });

  it("is unaffected by changing a non-owner's role", () => {
    const memberships = [
      { id: "m1", role: "OWNER" as const, ...baseMembership },
      { id: "m2", role: "ADULT" as const, ...baseMembership },
    ];
    expect(wouldLeaveHouseholdWithoutOwner(memberships, "m2", "VIEWER")).toBe(false);
  });
});
