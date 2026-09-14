import path from "node:path";

export const OWNER = {
  householdName: "E2E Household",
  name: "Ada Owner",
  email: "ada.e2e@example.test",
  password: "correct horse battery staple",
};

/**
 * A second account with a login, created during setup purely so the
 * sign-out journey has a session it can destroy without invalidating the
 * shared owner session every other spec reuses (sign-out revokes the
 * session row server-side — see ADR-006).
 */
export const SECOND_MEMBER = {
  name: "Ben Adult",
  email: "ben.e2e@example.test",
  password: "another correct horse battery",
};

export const OWNER_STORAGE_STATE = path.join(process.cwd(), "tests", "e2e", ".auth", "owner.json");

/** An explicitly empty storage state, for specs that must start signed out. */
export const SIGNED_OUT_STATE = { cookies: [], origins: [] };
