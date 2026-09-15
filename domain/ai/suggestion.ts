import type { ProviderLocality } from "./disclosure";

/**
 * Something a model proposed, which a person has not yet agreed to.
 *
 * CLAUDE.md §11 sets the whole shape in one line:
 *
 *   AI suggestion -> visible provenance -> human review -> explicit
 *   confirmation -> domain command
 *
 * Every part of that is load-bearing, and the last arrow is the one that
 * matters most: **accepting a suggestion does not write the suggestion.**
 * It runs the ordinary domain command, with the person who accepted it as
 * the actor, through the same policy kernel and the same state machine as
 * if they had typed it. A suggestion is a draft of an instruction, never
 * a instruction with a different author.
 *
 * That is also what "AI cannot directly mutate sensitive records" means in
 * practice. There is no path from a model's output to a row; there is only
 * a path from a *person's* decision to a row, which existed already.
 */
export type SuggestionStatus =
  /** Proposed by a model, waiting for a person. */
  | "PROPOSED"
  /** A person agreed; the domain command ran. */
  | "ACCEPTED"
  /** A person said no. Kept, because what was rejected is worth knowing. */
  | "REJECTED"
  /**
   * The records it was about changed after it was proposed, so it is
   * advice about a state of the world that no longer exists.
   */
  | "STALE";

export type SuggestionKind =
  /** A next action for a case that has none — the gap Attention flags. */
  | "CASE_NEXT_ACTION"
  /** A task the case implies but nobody has written down. */
  | "CASE_TASK"
  /** A plain-language summary of a case's timeline. */
  | "CASE_SUMMARY";

/**
 * Where a suggestion came from — the "visible provenance" half of §11.
 *
 * Recorded per suggestion rather than per session, because a suggestion
 * outlives the conversation that produced it: somebody reading a task in
 * six months should be able to find out that a model proposed it, which
 * model, on what evidence, and who agreed.
 */
export interface Provenance {
  /** Model identifier as the provider reports it, e.g. "llama3.1:8b". */
  model: string;
  /** Whether that model ran inside the household or outside it. */
  locality: ProviderLocality;
  /**
   * Which prompt produced this. Bumped whenever the prompt changes, so a
   * suggestion can be read against the instructions that generated it
   * rather than against today's.
   */
  promptVersion: string;
  /** The records the model was actually shown. */
  sources: SuggestionSource[];
  /**
   * What was deliberately kept back, and why. Shown to the reader: a
   * summary built from four of seven notes is incomplete rather than
   * wrong, and that difference decides whether to act on it.
   */
  withheld: { sensitivity: string; count: number }[];
  /** Kinds of secret the scrubber removed. Never the values. */
  redacted: string[];
  generatedAt: Date;
}

export interface SuggestionSource {
  type: string;
  id: string;
  /** The record's `version` when it was read — see `isStale`. */
  version: number;
}

export interface Suggestion {
  id: string;
  householdId: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  /** What the model proposed, in the shape the accepting command takes. */
  payload: Record<string, unknown>;
  provenance: Provenance;
  /** Who decided, and when. Null while PROPOSED. */
  decidedBy: string | null;
  decidedAt: Date | null;
  /** The record the acceptance created, so the trail joins up both ways. */
  resultType: string | null;
  resultId: string | null;
  createdAt: Date;
}

export type SuggestionCommand =
  | { type: "ACCEPT"; actorUserId: string; resultType: string; resultId: string }
  | { type: "REJECT"; actorUserId: string }
  | { type: "MARK_STALE" };

export type SuggestionRejection =
  | { code: "ALREADY_DECIDED"; message: string }
  | { code: "STALE"; message: string };

export interface SuggestionTransition {
  status: SuggestionStatus;
  patch: Partial<Suggestion>;
  auditAction: string;
}

export type SuggestionResult =
  | { ok: true; transition: SuggestionTransition }
  | { ok: false; rejection: SuggestionRejection };

/**
 * Only a `PROPOSED` suggestion can be decided, and only once.
 *
 * There is no path back from a decision. An accepted suggestion has
 * already run a domain command and a rejected one is a record of a
 * judgement; re-deciding either would make the trail lie about what
 * happened.
 */
export function applySuggestionCommand(
  suggestion: Pick<Suggestion, "status">,
  command: SuggestionCommand,
  now: Date
): SuggestionResult {
  /*
   * `MARK_STALE` is idempotent, and handled first for that reason.
   *
   * It is not a decision anybody made — it is an observation that the
   * world moved — so marking an already-stale suggestion stale must be a
   * no-op rather than an error. The alternative forces every caller to
   * check the status before reporting what it just found out, which is a
   * race dressed up as an API.
   *
   * It is still refused on a *decided* suggestion: an accepted one has
   * already run its command, and calling that stale afterwards would
   * claim something about the trail that is not true.
   */
  if (command.type === "MARK_STALE") {
    if (suggestion.status === "ACCEPTED" || suggestion.status === "REJECTED") {
      return {
        ok: false,
        rejection: { code: "ALREADY_DECIDED", message: "This suggestion has already been decided." },
      };
    }
    return {
      ok: true,
      transition: {
        // No `decidedBy`: nobody decided this, the world moved.
        status: "STALE",
        patch: { status: "STALE" },
        auditAction: "ai.suggestion_stale",
      },
    };
  }

  if (suggestion.status === "STALE") {
    return {
      ok: false,
      rejection: {
        code: "STALE",
        message: "The records this was about have changed since it was suggested.",
      },
    };
  }

  if (suggestion.status !== "PROPOSED") {
    return {
      ok: false,
      rejection: { code: "ALREADY_DECIDED", message: "This suggestion has already been decided." },
    };
  }

  switch (command.type) {
    case "ACCEPT":
      return {
        ok: true,
        transition: {
          status: "ACCEPTED",
          patch: {
            status: "ACCEPTED",
            decidedBy: command.actorUserId,
            decidedAt: now,
            resultType: command.resultType,
            resultId: command.resultId,
          },
          auditAction: "ai.suggestion_accepted",
        },
      };

    case "REJECT":
      return {
        ok: true,
        transition: {
          status: "REJECTED",
          patch: { status: "REJECTED", decidedBy: command.actorUserId, decidedAt: now },
          auditAction: "ai.suggestion_rejected",
        },
      };
  }
  // No `MARK_STALE` arm: the early return above narrows `command` to the
  // two human decisions, and the compiler enforces that this switch covers
  // both. A third decision added later fails to compile here rather than
  // falling through to `undefined` at runtime.
}

/**
 * Whether the advice still applies to the records it was about.
 *
 * Every source carries the `version` it was read at, and every mutable
 * aggregate in this application increments `version` on write (CLAUDE.md
 * §8). So "has anything changed under this suggestion" is answerable
 * exactly, without timestamps, clock skew, or a guess.
 *
 * It matters more here than anywhere else in the app: a suggested next
 * action for a case that has since been resolved is not merely out of
 * date, it is advice that would undo somebody's work.
 */
export function isStale(
  sources: readonly SuggestionSource[],
  current: ReadonlyMap<string, number>
): boolean {
  return sources.some((source) => {
    const version = current.get(`${source.type}:${source.id}`);
    // Gone entirely counts as changed — the strongest possible change.
    if (version === undefined) return true;
    return version !== source.version;
  });
}

/** A suggestion nobody has decided yet. */
export function isOpen(status: SuggestionStatus): boolean {
  return status === "PROPOSED";
}
