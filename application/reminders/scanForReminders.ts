import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import { cases, deadlines, tasks } from "../../db/schema";
import { emitOutboxEvent } from "../outbox/emitOutboxEvent";
import { toIsoDate } from "../../domain/attention/rules";

/**
 * How far ahead a deadline starts producing reminders. Deliberately longer
 * than the attention engine's "due soon" window: Attention answers "what
 * should I look at when I open the app", a reminder answers "what should
 * make the app interrupt me", and a commitment deserves more warning than
 * a task.
 */
export const DEADLINE_REMINDER_WINDOW_DAYS = 7;

export interface ReminderScanResult {
  taskFollowUps: number;
  caseFollowUps: number;
  deadlines: number;
}

/**
 * The scheduled producer for the transactional outbox (ADR-004/ADR-013).
 *
 * Everything else in this application emits outbox events as a
 * *consequence of someone acting*. Reminders are the exception: nobody
 * acts when a follow-up date arrives — that is precisely the problem
 * reminders exist to solve — so something has to notice the passage of
 * time instead. This is that something.
 *
 * Each scan claims its rows with the same `FOR UPDATE SKIP LOCKED`
 * discipline the outbox worker uses, and marks what it has announced in
 * the same transaction as the event it emits, so a crash between the two
 * is impossible.
 *
 * Idempotency is structural rather than remembered: the "already
 * announced" columns store *which* moment was announced, not a boolean, so
 * moving a follow-up date later re-arms the reminder by itself and no
 * command has to remember to reset a flag.
 */
export async function scanForReminders(now: Date = new Date()): Promise<ReminderScanResult> {
  const result: ReminderScanResult = { taskFollowUps: 0, caseFollowUps: 0, deadlines: 0 };

  result.taskFollowUps = await scanTaskFollowUps(now);
  result.caseFollowUps = await scanCaseFollowUps(now);
  result.deadlines = await scanDeadlines(now);

  return result;
}

async function scanTaskFollowUps(now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "WAITING"),
          lte(tasks.followUpAt, now),
          // Not yet announced, or announced for an earlier follow-up
          // moment than the one currently set.
          or(isNull(tasks.followUpNotifiedAt), sql`${tasks.followUpNotifiedAt} < ${tasks.followUpAt}`)
        )
      )
      .limit(100)
      .for("update", { skipLocked: true });

    for (const task of due) {
      await emitOutboxEvent(tx, task.householdId, {
        type: "task.follow_up_due",
        payload: {
          taskId: task.id,
          taskTitle: task.title,
          waitingFor: task.waitingFor,
          ownerPersonId: task.ownerPersonId,
          createdBy: task.createdBy,
          followUpAt: (task.followUpAt ?? now).toISOString(),
        },
      });

      await tx.update(tasks).set({ followUpNotifiedAt: task.followUpAt }).where(eq(tasks.id, task.id));
    }

    return due.length;
  });
}

async function scanCaseFollowUps(now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.status, "WAITING"),
          lte(cases.followUpAt, now),
          or(isNull(cases.followUpNotifiedAt), sql`${cases.followUpNotifiedAt} < ${cases.followUpAt}`)
        )
      )
      .limit(100)
      .for("update", { skipLocked: true });

    for (const kase of due) {
      await emitOutboxEvent(tx, kase.householdId, {
        type: "case.follow_up_due",
        payload: {
          caseId: kase.id,
          caseTitle: kase.title,
          waitingFor: kase.waitingFor,
          ownerPersonId: kase.ownerPersonId,
          createdBy: kase.createdBy,
          followUpAt: (kase.followUpAt ?? now).toISOString(),
        },
      });

      await tx.update(cases).set({ followUpNotifiedAt: kase.followUpAt }).where(eq(cases.id, kase.id));
    }

    return due.length;
  });
}

async function scanDeadlines(now: Date): Promise<number> {
  // Date-only comparison, read in UTC, for the same reason the attention
  // rules do it: a deadline is a date, not a moment, and must not drift a
  // day under a local reading.
  const horizon = new Date(now.getTime() + DEADLINE_REMINDER_WINDOW_DAYS * 86_400_000);
  const horizonDate = new Date(`${toIsoDate(horizon)}T00:00:00Z`);

  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(deadlines)
      .where(
        and(
          isNull(deadlines.metAt),
          isNull(deadlines.archivedAt),
          lte(deadlines.dueOn, horizonDate),
          or(
            isNull(deadlines.remindedForDueOn),
            sql`${deadlines.remindedForDueOn} is distinct from ${deadlines.dueOn}`
          )
        )
      )
      .limit(100)
      .for("update", { skipLocked: true });

    for (const deadline of due) {
      await emitOutboxEvent(tx, deadline.householdId, {
        type: "deadline.approaching",
        payload: {
          deadlineId: deadline.id,
          deadlineTitle: deadline.title,
          dueOn: toIsoDate(deadline.dueOn),
          createdBy: deadline.createdBy,
        },
      });

      await tx.update(deadlines).set({ remindedForDueOn: deadline.dueOn }).where(eq(deadlines.id, deadline.id));
    }

    return due.length;
  });
}
