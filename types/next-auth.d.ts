import type { Role } from "../domain/shared/types";

// Module augmentation for the fields infrastructure/auth/auth.ts adds to
// the session/JWT beyond Auth.js's defaults. See ADR-006: `sid`/`uid` drive
// JWT-session revocation; householdId/role/personIds are what
// application/policies/authorize.ts's `Actor` needs and are populated once
// in the `session` callback rather than re-derived on every policy check.
declare module "next-auth" {
  interface Session {
    /**
     * The current session_revocation row id (ADR-006). Used to revoke only
     * *this* device's session on a plain sign-out, as opposed to every
     * session for the user ("sign out everywhere", a separate action).
     */
    sid?: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      householdId?: string;
      role?: Role;
      personIds: string[];
    };
  }
}

// `next-auth/jwt` is only a re-export (`export * from "@auth/core/jwt"`);
// augmenting it does not merge into the interface actually used by
// @auth/core's own CallbacksOptions type (it imports JWT from "./jwt.js"
// directly, i.e. @auth/core/jwt) — verified empirically: augmenting
// "next-auth/jwt" left token.sid/token.uid typed as {} in infrastructure/auth/auth.ts.
// Augment the real declaration site instead.
declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    sid?: string;
  }
}
