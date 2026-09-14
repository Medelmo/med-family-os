/**
 * A single synchronisation attempt against one provider.
 *
 * docs/domain/state-machines.md, verbatim:
 *
 *   PENDING -> RUNNING -> SUCCEEDED
 *   RUNNING -> PARTIAL
 *   RUNNING -> FAILED
 *   FAILED -> RETRYING -> RUNNING
 *
 *   A sync run must never silently overwrite local edits.
 *
 * `PARTIAL` is the interesting state and the reason this is a machine
 * rather than a boolean: a run that imported eleven documents and choked
 * on the twelfth has done real, useful work that must not be thrown away,
 * and has also not finished. Recording it as success would lose the
 * error; recording it as failure would re-import eleven documents on the
 * next attempt.
 */
export type SyncRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "RETRYING";

export interface SyncRun {
  id: string;
  householdId: string;
  connectionId: string;
  status: SyncRunStatus;
  /** 1 for the first attempt; RETRY increments it. */
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
  /** The provider cursor this run started from, so a failure can be resumed. */
  cursorBefore: string | null;
  cursorAfter: string | null;
  /** Classified, human-readable, and never the credential. */
  errorKind: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

const ALLOWED_TRANSITIONS: Record<SyncRunStatus, readonly SyncRunStatus[]> = {
  PENDING: ["RUNNING"],
  RUNNING: ["SUCCEEDED", "PARTIAL", "FAILED"],
  SUCCEEDED: [],
  // A partial run is finished. Picking up where it left off is the *next*
  // run, starting from the cursor this one reached — not a resurrection
  // of this record, which would lose the history of what happened.
  PARTIAL: [],
  FAILED: ["RETRYING"],
  RETRYING: ["RUNNING"],
};

export interface SyncProgress {
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
  cursorAfter: string | null;
}

export type SyncCommand =
  | { type: "START" }
  | { type: "SUCCEED"; progress: SyncProgress }
  | { type: "PARTIAL"; progress: SyncProgress; errorKind: string; errorMessage: string }
  | { type: "FAIL"; errorKind: string; errorMessage: string }
  | { type: "RETRY" };

export type SyncRejection =
  | { code: "ILLEGAL_TRANSITION"; message: string }
  | { code: "PARTIAL_WITHOUT_PROGRESS"; message: string };

export interface SyncTransition {
  status: SyncRunStatus;
  patch: Partial<SyncRun>;
  auditAction: string;
}

export type SyncTransitionResult =
  | { ok: true; transition: SyncTransition }
  | { ok: false; rejection: SyncRejection };

function targetStatusFor(command: SyncCommand): SyncRunStatus {
  switch (command.type) {
    case "START":
      return "RUNNING";
    case "SUCCEED":
      return "SUCCEEDED";
    case "PARTIAL":
      return "PARTIAL";
    case "FAIL":
      return "FAILED";
    case "RETRY":
      return "RETRYING";
  }
}

export function applySyncCommand(run: SyncRun, command: SyncCommand, now: Date): SyncTransitionResult {
  const target = targetStatusFor(command);

  if (!ALLOWED_TRANSITIONS[run.status].includes(target)) {
    return {
      ok: false,
      rejection: { code: "ILLEGAL_TRANSITION", message: `A sync run cannot go from ${run.status} to ${target}.` },
    };
  }

  switch (command.type) {
    case "START":
      return {
        ok: true,
        transition: {
          status: "RUNNING",
          // startedAt is set on the first start and kept across retries:
          // "how long has this been going" is about the attempt, and the
          // attempt counter already distinguishes them.
          patch: { status: "RUNNING", startedAt: run.startedAt ?? now },
          auditAction: "sync.started",
        },
      };

    case "SUCCEED":
      return {
        ok: true,
        transition: {
          status: "SUCCEEDED",
          patch: { status: "SUCCEEDED", finishedAt: now, ...command.progress, errorKind: null, errorMessage: null },
          auditAction: "sync.succeeded",
        },
      };

    case "PARTIAL": {
      // A partial run that imported nothing is a failure wearing a
      // friendlier name, and calling it PARTIAL would advance the cursor
      // past documents nobody has seen.
      if (command.progress.itemsImported === 0) {
        return {
          ok: false,
          rejection: {
            code: "PARTIAL_WITHOUT_PROGRESS",
            message: "A run that imported nothing is a failure, not a partial success.",
          },
        };
      }
      return {
        ok: true,
        transition: {
          status: "PARTIAL",
          patch: {
            status: "PARTIAL",
            finishedAt: now,
            ...command.progress,
            errorKind: command.errorKind,
            errorMessage: command.errorMessage,
          },
          auditAction: "sync.partial",
        },
      };
    }

    case "FAIL":
      return {
        ok: true,
        transition: {
          status: "FAILED",
          patch: {
            status: "FAILED",
            finishedAt: now,
            errorKind: command.errorKind,
            errorMessage: command.errorMessage,
          },
          auditAction: "sync.failed",
        },
      };

    case "RETRY":
      return {
        ok: true,
        transition: {
          status: "RETRYING",
          patch: { status: "RETRYING", attempt: run.attempt + 1, finishedAt: null },
          auditAction: "sync.retrying",
        },
      };
  }
}

/** A run that has finished, whatever the outcome. */
export function isSyncFinished(status: SyncRunStatus): boolean {
  return status === "SUCCEEDED" || status === "PARTIAL" || status === "FAILED";
}

/**
 * The cursor the next run should start from.
 *
 * A successful or partial run advances it — a partial one to wherever it
 * actually reached, which is the entire reason the state exists. A failed
 * run does not, because nothing about where it stopped can be trusted.
 */
export function nextCursorAfter(run: Pick<SyncRun, "status" | "cursorAfter" | "cursorBefore">): string | null {
  if (run.status === "SUCCEEDED" || run.status === "PARTIAL") return run.cursorAfter;
  return run.cursorBefore;
}
