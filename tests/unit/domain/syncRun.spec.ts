import { describe, expect, it } from "vitest";
import {
  applySyncCommand,
  isSyncFinished,
  nextCursorAfter,
  type SyncCommand,
  type SyncRun,
  type SyncRunStatus,
} from "../../../domain/integrations/syncRun";
import {
  applyProviderUpdate,
  displayTitle,
  isSafeDocumentUrl,
} from "../../../domain/documents/documentReference";

const NOW = new Date("2026-06-01T09:00:00Z");

function run(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "s1",
    householdId: "h1",
    connectionId: "c1",
    status: "PENDING",
    attempt: 1,
    startedAt: null,
    finishedAt: null,
    itemsSeen: 0,
    itemsImported: 0,
    itemsSkipped: 0,
    cursorBefore: null,
    cursorAfter: null,
    errorKind: null,
    errorMessage: null,
    createdAt: NOW,
    ...overrides,
  };
}

const apply = (status: SyncRunStatus, command: SyncCommand, overrides: Partial<SyncRun> = {}) =>
  applySyncCommand(run({ status, ...overrides }), command, NOW);

const progress = { itemsSeen: 12, itemsImported: 11, itemsSkipped: 1, cursorAfter: "page-2" };

describe("the documented sync lifecycle", () => {
  it("walks PENDING -> RUNNING -> SUCCEEDED", () => {
    expect(apply("PENDING", { type: "START" })).toMatchObject({ ok: true });
    expect(apply("RUNNING", { type: "SUCCEED", progress })).toMatchObject({ ok: true });
  });

  it("walks RUNNING -> FAILED -> RETRYING -> RUNNING", () => {
    expect(apply("RUNNING", { type: "FAIL", errorKind: "network", errorMessage: "timed out" })).toMatchObject({
      ok: true,
    });
    expect(apply("FAILED", { type: "RETRY" })).toMatchObject({ ok: true });
    expect(apply("RETRYING", { type: "START" })).toMatchObject({ ok: true });
  });

  it("counts the attempt up on a retry and clears the finish time", () => {
    const result = apply("FAILED", { type: "RETRY" }, { attempt: 2, finishedAt: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.patch.attempt).toBe(3);
      expect(result.transition.patch.finishedAt).toBeNull();
    }
  });

  // "How long has this been going" is about the attempt, and the attempt
  // counter already distinguishes them.
  it("keeps the original start time across a retry", () => {
    const started = new Date("2026-06-01T08:00:00Z");
    const result = apply("RETRYING", { type: "START" }, { startedAt: started });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transition.patch.startedAt).toEqual(started);
  });

  it("makes success terminal", () => {
    for (const command of [
      { type: "START" },
      { type: "FAIL", errorKind: "x", errorMessage: "y" },
      { type: "RETRY" },
    ] as SyncCommand[]) {
      expect(apply("SUCCEEDED", command), command.type).toMatchObject({ ok: false });
    }
  });

  it("does not let a run finish twice", () => {
    expect(apply("FAILED", { type: "FAIL", errorKind: "x", errorMessage: "y" })).toMatchObject({ ok: false });
    expect(apply("PENDING", { type: "SUCCEED", progress })).toMatchObject({
      ok: false,
      rejection: { code: "ILLEGAL_TRANSITION" },
    });
  });
});

describe("partial runs", () => {
  // The reason this is a machine rather than a boolean: eleven imported
  // documents are real work that must not be thrown away.
  it("keeps the progress and the error together", () => {
    const result = apply("RUNNING", {
      type: "PARTIAL",
      progress,
      errorKind: "rate_limit",
      errorMessage: "429 from the provider",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.patch).toMatchObject({
        itemsImported: 11,
        cursorAfter: "page-2",
        errorKind: "rate_limit",
      });
    }
  });

  // Calling it partial would advance the cursor past documents nobody has
  // seen.
  it("refuses to call a run that imported nothing a partial success", () => {
    expect(
      apply("RUNNING", {
        type: "PARTIAL",
        progress: { ...progress, itemsImported: 0 },
        errorKind: "network",
        errorMessage: "timed out",
      })
    ).toMatchObject({ ok: false, rejection: { code: "PARTIAL_WITHOUT_PROGRESS" } });
  });

  // Picking up where it left off is the *next* run, not a resurrection of
  // this record — which would lose the history of what happened.
  it("makes a partial run terminal", () => {
    expect(apply("PARTIAL", { type: "RETRY" })).toMatchObject({ ok: false });
    expect(apply("PARTIAL", { type: "START" })).toMatchObject({ ok: false });
  });
});

describe("where the next run starts", () => {
  it("advances past a successful run", () => {
    expect(nextCursorAfter({ status: "SUCCEEDED", cursorBefore: "page-1", cursorAfter: "page-3" })).toBe("page-3");
  });

  it("advances to wherever a partial run actually reached", () => {
    expect(nextCursorAfter({ status: "PARTIAL", cursorBefore: "page-1", cursorAfter: "page-2" })).toBe("page-2");
  });

  // Nothing about where a failed run stopped can be trusted.
  it("does not advance past a failed run", () => {
    expect(nextCursorAfter({ status: "FAILED", cursorBefore: "page-1", cursorAfter: "page-9" })).toBe("page-1");
  });

  it("knows which runs are over", () => {
    expect(["SUCCEEDED", "PARTIAL", "FAILED"].every((s) => isSyncFinished(s as SyncRunStatus))).toBe(true);
    expect(["PENDING", "RUNNING", "RETRYING"].some((s) => isSyncFinished(s as SyncRunStatus))).toBe(false);
  });
});

describe("a sync never overwrites a local edit", () => {
  const existing = { title: "Bescheid 2026", documentDate: "2026-01-04", url: "https://paperless.internal/1" };

  it("writes the provider's own fields when they change", () => {
    const patch = applyProviderUpdate(existing, {
      externalId: "1",
      title: "Bescheid 2026 (korrigiert)",
      documentDate: "2026-01-06",
      url: "https://paperless.internal/1",
    });

    expect(patch).toEqual({ title: "Bescheid 2026 (korrigiert)", documentDate: "2026-01-06" });
  });

  // A sync that rewrites unchanged rows churns updatedAt and makes "what
  // did this run actually do?" unanswerable.
  it("writes nothing when nothing changed", () => {
    expect(applyProviderUpdate(existing, { externalId: "1", ...existing })).toBeNull();
  });

  // The structural guarantee: the household's fields are different
  // columns, so a sync cannot reach them however it is written.
  it("cannot touch the household's own title or note", () => {
    const patch = applyProviderUpdate(existing, {
      externalId: "1",
      title: "Something else entirely",
      documentDate: null,
      url: null,
    });

    expect(patch).not.toHaveProperty("titleOverride");
    expect(patch).not.toHaveProperty("note");
  });

  it("shows the household's title when there is one", () => {
    expect(displayTitle({ title: "Bescheid 2026", titleOverride: null })).toBe("Bescheid 2026");
    expect(displayTitle({ title: "Bescheid 2026", titleOverride: "Lukas — Pflegegrad" })).toBe("Lukas — Pflegegrad");
  });
});

describe("document links", () => {
  it("accepts ordinary http and https links", () => {
    expect(isSafeDocumentUrl("https://paperless.internal/documents/1")).toBe(true);
    expect(isSafeDocumentUrl("http://192.168.1.10:8000/documents/1")).toBe(true);
    expect(isSafeDocumentUrl(null)).toBe(true);
  });

  // This is the one place external input becomes an href, and a
  // javascript: URL there is script execution in the user's session.
  it("refuses a scheme that would execute", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd"]) {
      expect(isSafeDocumentUrl(url), url).toBe(false);
    }
  });

  it("refuses something that is not a URL at all", () => {
    expect(isSafeDocumentUrl("not a url")).toBe(false);
    expect(isSafeDocumentUrl("//evil.example")).toBe(false);
  });
});
