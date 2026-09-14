/**
 * Distinguishes "authorization failure" from other failure modes per
 * CLAUDE.md §21 ("Distinguish: user validation error, authorization
 * failure, conflict, not found, dependency failure..."). Route handlers and
 * Server Actions map this to a 403-equivalent response and never include
 * the underlying resource details in the message shown to the user (the
 * message here is already generic on purpose).
 */
export class AuthorizationError extends Error {
  constructor(message = "Not authorized.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Optimistic-concurrency conflict (CLAUDE.md §8 / docs/domain/erd.md `version`). */
export class ConflictError extends Error {
  constructor(message = "This record was changed by someone else. Reload and try again.") {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
