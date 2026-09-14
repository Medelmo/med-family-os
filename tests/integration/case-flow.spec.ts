import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
  caseEvents,
  casePeople,
  caseTasks,
  cases,
  deadlines,
  households,
  householdMemberships,
  inboxItems,
  notifications,
  outboxEvents,
  people,
  sessionRevocations,
  taskPeople,
  tasks,
  users,
} from "../../db/schema";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { createCase } from "../../application/commands/cases/createCase";
import { transitionCase, IllegalCaseTransitionError } from "../../application/commands/cases/transitionCase";
import { addCaseNote, linkTaskToCase, setCaseNextAction } from "../../application/commands/cases/caseContext";
import { getCase, getCases } from "../../application/queries/cases/getCases";
import { getAttention } from "../../application/queries/attention/getAttention";
import { captureInboxItem } from "../../application/commands/inbox/captureInboxItem";
import { triageInboxItemToTask } from "../../application/commands/inbox/triageInboxItem";
import { AuthorizationError, ConflictError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * Case -> next action -> waiting -> timeline -> linked work
 * (docs/implementation/implementation-plan.md vertical slice 3), against a
 * real database. Requires DATABASE_URL to point at a disposable
 * development database.
 */

async function resetDatabase() {
  await db.execute(
    sql`truncate table ${caseEvents}, ${caseTasks}, ${casePeople}, ${cases}, ${notifications}, ${outboxEvents}, ${auditEvents}, ${deadlines}, ${taskPeople}, ${tasks}, ${inboxItems}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );
}

beforeEach(resetDatabase);
afterAll(resetDatabase);

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor, personId: person.id };
}

const FOLLOW_UP = new Date("2026-09-28T10:00:00Z");

describe("case creation and timeline", () => {
  it("opens a case as ACTIVE and starts its timeline", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place for Lukas" });

    expect(kase.status).toBe("ACTIVE");

    const detail = await getCase(actor, householdId, kase.id);
    expect(detail.timeline).toHaveLength(1);
    expect(detail.timeline[0].type).toBe("CREATED");
  });

  it("can open a case as a draft instead", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Maybe move house", activate: false });
    expect(kase.status).toBe("DRAFT");
  });

  it("records every status change on the timeline and in the audit log", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    const waiting = await transitionCase(actor, householdId, kase.id, kase.version, {
      type: "WAIT",
      waitingFor: "the Amt",
      followUpAt: FOLLOW_UP,
      externalReference: "AZ 12/345",
    });
    await transitionCase(actor, householdId, kase.id, waiting.version, { type: "RESUME" });

    const detail = await getCase(actor, householdId, kase.id);
    const summaries = detail.timeline.map((e) => e.summary);
    expect(summaries).toContain("Waiting for the Amt");
    expect(summaries).toContain("Picked the case back up");

    const actions = (await db.select().from(auditEvents)).map((r) => r.action);
    expect(actions).toContain("case.waiting");
    expect(actions).toContain("case.resumed");
  });

  it("keeps notes on the same timeline as status changes", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    await addCaseNote(actor, householdId, { caseId: kase.id, body: "Rang them, nobody picked up." });

    const detail = await getCase(actor, householdId, kase.id);
    expect(detail.timeline.map((e) => e.type)).toContain("NOTE");
    expect(detail.timeline.find((e) => e.type === "NOTE")?.summary).toBe("Rang them, nobody picked up.");
  });

  it("does not require a version to add a note, because appending cannot conflict", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    await addCaseNote(actor, householdId, { caseId: kase.id, body: "First" });
    await addCaseNote(actor, householdId, { caseId: kase.id, body: "Second" });

    const detail = await getCase(actor, householdId, kase.id);
    expect(detail.timeline.filter((e) => e.type === "NOTE")).toHaveLength(2);
  });
});

describe("case state machine through the command layer", () => {
  it("rejects a transition the domain does not allow", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place", activate: false });

    // DRAFT -> COMPLETED is not an edge (ADR-007).
    await expect(
      transitionCase(actor, householdId, kase.id, kase.version, { type: "COMPLETE" })
    ).rejects.toBeInstanceOf(IllegalCaseTransitionError);
  });

  it("refuses to park a case as waiting with neither a date nor a reason", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    await expect(
      transitionCase(actor, householdId, kase.id, kase.version, { type: "WAIT", waitingFor: "the Amt", followUpAt: null })
    ).rejects.toBeInstanceOf(IllegalCaseTransitionError);
  });

  it("rejects a stale version rather than overwriting a concurrent change", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });
    await transitionCase(actor, householdId, kase.id, kase.version, { type: "BLOCK", reason: "missing certificate" });

    // RESUME is legal from BLOCKED, so this gets past the state machine and
    // is rejected purely on the stale version — which is what this test is
    // about. (A command that were *also* illegal from the new state would
    // be rejected earlier, by the domain, and prove nothing about
    // concurrency.)
    await expect(
      transitionCase(actor, householdId, kase.id, kase.version, { type: "RESUME" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("runs a case through to archived", async () => {
    const { householdId, actor } = await household();
    let kase = await createCase(actor, householdId, { title: "Kindergarten place" });
    kase = await transitionCase(actor, householdId, kase.id, kase.version, { type: "COMPLETE" });
    kase = await transitionCase(actor, householdId, kase.id, kase.version, { type: "ARCHIVE" });

    expect(kase.status).toBe("ARCHIVED");
    expect(kase.archivedAt).not.toBeNull();
    // Archived cases drop out of the open list.
    expect(await getCases(actor, householdId)).toHaveLength(0);
  });
});

describe("case context", () => {
  it("links an existing task and shows it on the case", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    const item = await captureInboxItem(actor, householdId, { capturedText: "Send the form" });
    const task = await triageInboxItemToTask(actor, householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "Send the form",
      priority: "NORMAL",
      aboutPersonIds: [],
    });

    await linkTaskToCase(actor, householdId, { caseId: kase.id, taskId: task.id });

    const detail = await getCase(actor, householdId, kase.id);
    expect(detail.tasks.map((t) => t.title)).toEqual(["Send the form"]);
    expect(detail.timeline.map((e) => e.type)).toContain("TASK_LINKED");
  });

  it("refuses to link a task from another household", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    // A well-formed UUID that belongs to no task in this household. (Zod 4
    // validates UUID version bits, so a hand-written all-zero id is
    // rejected as malformed before the lookup is even reached.)
    await expect(
      linkTaskToCase(actor, householdId, { caseId: kase.id, taskId: crypto.randomUUID() })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("sets the next action and records it on the timeline", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    const updated = await setCaseNextAction(actor, householdId, {
      caseId: kase.id,
      expectedVersion: kase.version,
      nextAction: "Ring the Amt on Monday",
    });
    expect(updated.nextAction).toBe("Ring the Amt on Monday");

    const detail = await getCase(actor, householdId, kase.id);
    expect(detail.timeline.map((e) => e.type)).toContain("NEXT_ACTION_SET");
  });
});

describe("cases in the attention projection", () => {
  it("flags an active case with no next action", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "Kindergarten place" });

    const { items } = await getAttention(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("case");
    expect(items[0].reasons.map((r) => r.code)).toContain("MISSING_NEXT_ACTION");
  });

  it("flags a blocked case with the blocking reason", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place", nextAction: "Ring them" });
    await transitionCase(actor, householdId, kase.id, kase.version, { type: "BLOCK", reason: "missing certificate" });

    const { items } = await getAttention(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(items[0].reasons).toContainEqual({ code: "BLOCKED", context: { reason: "missing certificate" } });
  });

  it("flags a waiting case once its follow-up date arrives, and not before", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place", nextAction: "Ring them" });
    await transitionCase(actor, householdId, kase.id, kase.version, {
      type: "WAIT",
      waitingFor: "the Amt",
      followUpAt: FOLLOW_UP,
    });

    const before = await getAttention(actor, householdId, new Date("2026-09-20T10:00:00Z"));
    expect(before.items.map((i) => i.reasons.map((r) => r.code)).flat()).not.toContain("FOLLOW_UP_DUE");

    const after = await getAttention(actor, householdId, new Date("2026-09-29T10:00:00Z"));
    expect(after.items[0].reasons.map((r) => r.code)).toContain("FOLLOW_UP_DUE");
  });

  it("keeps a case waiting with no date visible rather than letting it disappear", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place", nextAction: "Ring them" });
    await transitionCase(actor, householdId, kase.id, kase.version, {
      type: "WAIT",
      waitingFor: "the Amt",
      followUpAt: null,
      noFollowUpReason: "they said they would write to us",
    });

    const { items } = await getAttention(actor, householdId, new Date("2026-09-15T10:00:00Z"));
    expect(items[0].reasons.map((r) => r.code)).toContain("WAITING_INDEFINITELY");
  });

  it("ranks tasks and cases together in one list", async () => {
    const { householdId, actor } = await household();
    await createCase(actor, householdId, { title: "A case", nextAction: "Ring them", priority: "HIGH" });

    const item = await captureInboxItem(actor, householdId, { capturedText: "An overdue task" });
    await triageInboxItemToTask(actor, householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "An overdue task",
      priority: "NORMAL",
      dueOn: new Date("2026-09-01T00:00:00Z"),
      nextAction: "Do it",
      aboutPersonIds: [],
    });

    const { items } = await getAttention(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(items.map((i) => i.kind)).toEqual(["task", "case"]);
  });
});

describe("case authorization", () => {
  it("hides a case scoped to one person from a household member who is not that person", async () => {
    const { householdId, actor, personId } = await household();
    await createCase(actor, householdId, { title: "Private matter", aboutPersonIds: [personId] });

    const otherChild: Actor = {
      userId: "00000000-0000-0000-0000-0000000000ff",
      householdId,
      role: "CHILD",
      personIds: ["00000000-0000-0000-0000-0000000000ee"],
    };

    expect(await getCases(otherChild, householdId)).toHaveLength(0);
    expect(await getCases(actor, householdId)).toHaveLength(1);
  });

  it("refuses to open a case detail the actor may not read", async () => {
    const { householdId, actor, personId } = await household();
    const kase = await createCase(actor, householdId, { title: "Private matter", aboutPersonIds: [personId] });

    const otherChild: Actor = {
      userId: "00000000-0000-0000-0000-0000000000ff",
      householdId,
      role: "CHILD",
      personIds: ["00000000-0000-0000-0000-0000000000ee"],
    };

    // Knowing the id is not authorization (BOLA).
    await expect(getCase(otherChild, householdId, kase.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a VIEWER any write to a case", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });

    const viewerPerson = await addHouseholdMember(actor, householdId, {
      displayName: "Viewer",
      role: "VIEWER",
      account: { email: "viewer@example.test", temporaryPassword: "a long enough password" },
    });
    const viewer: Actor = {
      userId: viewerPerson.accountUserId!,
      householdId,
      role: "VIEWER",
      personIds: [viewerPerson.id],
    };

    await expect(
      transitionCase(viewer, householdId, kase.id, kase.version, { type: "COMPLETE" })
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(addCaseNote(viewer, householdId, { caseId: kase.id, body: "nope" })).rejects.toBeInstanceOf(
      AuthorizationError
    );
    // ...but reading is fine.
    expect((await getCases(viewer, householdId)).map((c) => c.title)).toEqual(["Kindergarten place"]);
  });
});
