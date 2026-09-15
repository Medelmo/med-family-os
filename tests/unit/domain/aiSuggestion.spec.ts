import { describe, expect, it } from "vitest";
import {
  applySuggestionCommand,
  isOpen,
  isStale,
  type SuggestionSource,
  type SuggestionStatus,
} from "../../../domain/ai/suggestion";

const NOW = new Date("2026-09-15T10:00:00.000Z");
const ACTOR = "user-1";

const at = (status: SuggestionStatus) => ({ status });

describe("deciding a suggestion", () => {
  it("accepts a proposal, recording who and what it produced", () => {
    const result = applySuggestionCommand(
      at("PROPOSED"),
      { type: "ACCEPT", actorUserId: ACTOR, resultType: "case", resultId: "case-1" },
      NOW
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.patch).toMatchObject({
      status: "ACCEPTED",
      decidedBy: ACTOR,
      decidedAt: NOW,
      resultType: "case",
      resultId: "case-1",
    });
    expect(result.transition.auditAction).toBe("ai.suggestion_accepted");
  });

  it("rejects a proposal, recording who", () => {
    const result = applySuggestionCommand(at("PROPOSED"), { type: "REJECT", actorUserId: ACTOR }, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.patch).toMatchObject({ status: "REJECTED", decidedBy: ACTOR });
  });

  // Nobody decided this: the world moved. So no `decidedBy`, which is the
  // difference between "we said no" and "it stopped applying".
  it("marks one stale without attributing it to a person", () => {
    const result = applySuggestionCommand(at("PROPOSED"), { type: "MARK_STALE" }, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.patch).toEqual({ status: "STALE" });
    expect(result.transition.patch).not.toHaveProperty("decidedBy");
  });

  /**
   * There is no path back from a decision.
   *
   * An accepted suggestion has already run a domain command and a rejected
   * one is a record of a judgement. Re-deciding either would make the
   * trail lie about what happened.
   */
  it.each<SuggestionStatus>(["ACCEPTED", "REJECTED"])("refuses to decide one that is already %s", (status) => {
    for (const command of [
      { type: "ACCEPT" as const, actorUserId: ACTOR, resultType: "case", resultId: "c" },
      { type: "REJECT" as const, actorUserId: ACTOR },
    ]) {
      const result = applySuggestionCommand(at(status), command, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.code).toBe("ALREADY_DECIDED");
    }
  });

  // A distinct code from ALREADY_DECIDED, because the remedy is different:
  // "somebody already answered this" versus "ask again, the case moved".
  it("refuses a stale one with its own reason", () => {
    const result = applySuggestionCommand(
      at("STALE"),
      { type: "ACCEPT", actorUserId: ACTOR, resultType: "case", resultId: "c" },
      NOW
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("STALE");
    expect(result.rejection.message).toMatch(/changed/i);
  });

  it("still lets a stale one be marked stale, so a re-check is not an error", () => {
    expect(applySuggestionCommand(at("STALE"), { type: "MARK_STALE" }, NOW).ok).toBe(true);
  });

  it.each<[SuggestionStatus, boolean]>([
    ["PROPOSED", true],
    ["ACCEPTED", false],
    ["REJECTED", false],
    ["STALE", false],
  ])("%s is open: %s", (status, open) => {
    expect(isOpen(status)).toBe(open);
  });
});

describe("whether the advice still applies", () => {
  const sources: SuggestionSource[] = [
    { type: "case", id: "case-1", version: 3 },
    { type: "task", id: "task-1", version: 1 },
  ];

  it("is fresh while every source is at the version it was read at", () => {
    const current = new Map([
      ["case:case-1", 3],
      ["task:task-1", 1],
    ]);
    expect(isStale(sources, current)).toBe(false);
  });

  it("is stale when any source has moved on", () => {
    const current = new Map([
      ["case:case-1", 4],
      ["task:task-1", 1],
    ]);
    expect(isStale(sources, current)).toBe(true);
  });

  // Not merely "greater than": a version that somehow went backwards is
  // still a version that is not the one the model was shown.
  it("is stale when a source went backwards", () => {
    const current = new Map([
      ["case:case-1", 2],
      ["task:task-1", 1],
    ]);
    expect(isStale(sources, current)).toBe(true);
  });

  // The strongest possible change.
  it("is stale when a source is gone entirely", () => {
    expect(isStale(sources, new Map([["case:case-1", 3]]))).toBe(true);
  });

  it("is fresh when there were no sources to change", () => {
    expect(isStale([], new Map())).toBe(false);
  });
});
