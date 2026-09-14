import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { deadlines } from "../../../db/schema";
import { getHouseholdTimezone, getTasks, type TaskListItem } from "../tasks/getTasks";
import { getCases, type CaseListItem } from "../cases/getCases";
import { getReimbursements, type ReimbursementListItem } from "../finance/getFinance";
import { getTrips, type TripListItem } from "../travel/getTrips";
import { getAssets, type AssetListItem } from "../assets/getAssets";
import { getCalendarOccurrences, type CalendarOccurrence } from "../calendar/getCalendarEvents";
import { householdToday } from "../../time";
import { wallClockToInstant } from "../../../domain/calendar/timezone";
import {
  projectAttention,
  toIsoDate,
  type AttentionCandidate,
  type AttentionItem,
  type AttentionRuleConfig,
} from "../../../domain/attention/rules";
import type { Actor } from "../../policies/authorize";
import { canAccess } from "../../policies/authorize";

/**
 * The Attention projection.
 *
 * Computed on read from the same rows everything else uses — there is no
 * attention table, because product-spec.md is explicit that attention is
 * "a projection, not stored truth". Storing it would create a second copy
 * of the truth that can silently disagree with the first.
 *
 * Tasks, cases, claims, trips and assets are ranked in one list rather
 * than five: the household has one attention budget, and splitting it by
 * aggregate would leave the reader to merge the lists in their head —
 * which is the work this view exists to do for them.
 *
 * Each aggregate maps itself onto the rules' normalised candidate at its
 * own edge, below. The rules never see a status enum, so a new state on
 * any aggregate cannot silently change what surfaces.
 */
export async function getAttention(
  actor: Actor,
  householdId: string,
  now: Date = new Date(),
  config?: AttentionRuleConfig
): Promise<{ items: AttentionItem[]; todayIso: string }> {
  const timezone = await getHouseholdTimezone(householdId);
  const todayIso = householdToday(timezone, now);

  // getTrips needs the household's "today" to derive each trip's phase,
  // so it cannot start until the timezone is resolved.
  const [tasks, cases, claims, trips, assets] = await Promise.all([
    getTasks(actor, householdId),
    getCases(actor, householdId),
    getReimbursements(actor, householdId),
    getTrips(actor, householdId, todayIso),
    getAssets(actor, householdId),
  ]);

  const items = projectAttention(
    [
      ...tasks.map(taskToCandidate),
      ...cases.map(caseToCandidate),
      ...claims.map(reimbursementToCandidate),
      ...trips.map(tripToCandidate),
      ...assets.map(assetToCandidate),
    ],
    todayIso,
    now,
    config
  );

  return { items, todayIso };
}

/**
 * Maps an open claim onto the rules' normalised shape.
 *
 * product-spec.md lists "unresolved reimbursement" as an attention
 * trigger. It needs no new rule: a claim sitting on a counterparty *is* a
 * wait, so FOLLOW_UP_DUE, WAITING_TOO_LONG and WAITING_INDEFINITELY apply
 * unchanged. That reuse is exactly what normalising the candidate shape in
 * Phase 3 was for.
 *
 * A claim that has been APPROVED but not yet paid is treated as waiting
 * too, with its waiting clock running from the decision: an approval that
 * never turns into money is precisely the case a household forgets about.
 * PLANNED is actionable rather than waiting — nobody else is holding it
 * up; it is sitting in the household's own inbox.
 */
function reimbursementToCandidate(claim: ReimbursementListItem): AttentionCandidate {
  const waitingOnCounterparty = claim.status === "WAITING" || claim.status === "SUBMITTED";
  const awaitingMoney = claim.status === "APPROVED" || claim.status === "PARTIALLY_REIMBURSED";

  return {
    id: claim.id,
    kind: "reimbursement",
    title: claim.title,
    // Claims carry no priority of their own; NORMAL keeps them ranked by
    // how long they have actually been stuck rather than by a number
    // nobody set.
    priority: "NORMAL",
    dueOn: null,
    waiting:
      waitingOnCounterparty || awaitingMoney
        ? {
            since: claim.waitingSince,
            followUpAt: claim.followUpAt,
            indefinite: claim.followUpAt === null && claim.waitingNoFollowUpReason !== null,
          }
        : null,
    blocked: null,
    actionable: claim.status === "PLANNED",
    // A planned claim's next action is to submit it; the domain refuses to
    // submit one with nothing attached, so "no next action" here means the
    // household has opened a claim and not yet said what it is for.
    nextAction: claim.counterparty,
  };
}

/**
 * Maps a case onto the rules' normalised shape.
 *
 * A case has no due date of its own — a date the household is committed to
 * is a Deadline, linked to the case — so `dueOn` is null and the follow-up
 * date carries the time pressure instead.
 */
function caseToCandidate(kase: CaseListItem): AttentionCandidate {
  return {
    id: kase.id,
    kind: "case",
    title: kase.title,
    priority: kase.priority,
    dueOn: null,
    waiting:
      kase.status === "WAITING"
        ? {
            since: kase.waitingSince,
            followUpAt: kase.followUpAt,
            // A case waits open-endedly only by explicit choice, recorded
            // as a reason (domain/cases/case.ts).
            indefinite: kase.followUpAt === null && kase.waitingNoFollowUpReason !== null,
          }
        : null,
    blocked: kase.status === "BLOCKED" ? { reason: kase.blockedReason } : null,
    actionable: kase.status === "ACTIVE",
    nextAction: kase.nextAction,
  };
}

/**
 * Maps a task onto the rules' normalised shape. The task's status enum
 * stops here: domain/attention/rules.ts never sees it, so adding a status
 * cannot silently change what the attention rules do.
 */
function taskToCandidate(task: TaskListItem): AttentionCandidate {
  return {
    id: task.id,
    kind: "task",
    title: task.title,
    priority: task.priority,
    dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
    waiting:
      task.status === "WAITING"
        ? { since: task.waitingSince, followUpAt: task.followUpAt, indefinite: task.waitingIndefinite }
        : null,
    // Tasks have no blocked state — that distinction exists only for cases
    // (docs/domain/state-machines.md).
    blocked: null,
    actionable: task.status === "PLANNED" || task.status === "IN_PROGRESS",
    nextAction: task.nextAction,
  };
}

/**
 * Maps a trip onto the rules' normalised shape.
 *
 * The trip's start date is its `dueOn`: nothing is *late* about an
 * upcoming trip, but the window to prepare for it closes on that day, and
 * the preparation counts are what the rules judge against it
 * (product-spec.md, "trip readiness").
 *
 * A trip that has already begun is not preparation any more, so only
 * upcoming trips are handed over — the household is on the train.
 */
function tripToCandidate(trip: TripListItem): AttentionCandidate {
  return {
    id: trip.id,
    kind: "trip",
    title: trip.title,
    priority: "NORMAL",
    dueOn: trip.phase === "UPCOMING" ? trip.startsOn : null,
    waiting: null,
    blocked: null,
    // A trip is something the household acts on itself rather than waits
    // for, and its "next action" is whatever is still outstanding — which
    // the preparation counts already say, so MISSING_NEXT_ACTION would
    // just be noise on top of PREPARATION_INCOMPLETE.
    actionable: false,
    nextAction: trip.destination,
    preparation: { outstanding: trip.readiness.outstanding, unverified: trip.readiness.unverified },
  };
}

/**
 * Maps an asset onto the rules' normalised shape.
 *
 * An asset carries the two dates that mean different things, and carries
 * them in different fields on purpose: a service is *due* by its date (so
 * it can be overdue), while cover *expires* on its date (so there is
 * nothing to do once it has). product-spec.md names "upcoming warranty" as
 * an attention trigger; this is that, plus the service history's own
 * answer to when the thing is next due.
 *
 * An asset with neither date produces no reasons at all and never appears,
 * which is right: a bookshelf is not something that needs attention.
 */
function assetToCandidate(asset: AssetListItem): AttentionCandidate {
  return {
    id: asset.id,
    kind: "asset",
    title: asset.name,
    priority: "NORMAL",
    dueOn: asset.nextServiceDueOn,
    expiresOn: asset.coverEndsOn,
    waiting: null,
    blocked: null,
    // Never nagged about a missing next action: "book the service" is
    // already what an overdue service date says, and saying it twice is
    // how a list stops being read.
    actionable: false,
    nextAction: asset.location,
  };
}

export interface TodayView {
  todayIso: string;
  /** Tasks due on or before today, plus anything whose follow-up has come up. */
  dueToday: TaskListItem[];
  waiting: TaskListItem[];
  deadlines: { id: string; title: string; dueOn: Date }[];
  events: CalendarOccurrence[];
}

/**
 * Today = what is actually on the household's plate right now.
 *
 * CLAUDE.md §4.3: "It must not become a statistics dashboard." So this
 * returns the specific records due, waiting, and committed to — not counts.
 */
export async function getToday(actor: Actor, householdId: string, now: Date = new Date()): Promise<TodayView> {
  const [timezone, allTasks] = await Promise.all([getHouseholdTimezone(householdId), getTasks(actor, householdId)]);
  const todayIso = householdToday(timezone, now);

  const dueToday = allTasks.filter((task) => {
    if (task.status === "WAITING") return false;
    if (!task.dueOn) return false;
    return toIsoDate(task.dueOn) <= todayIso;
  });

  const waiting = allTasks.filter(
    (task) => task.status === "WAITING" && (!task.followUpAt || task.followUpAt.getTime() <= now.getTime())
  );

  const deadlineRows = await db
    .select()
    .from(deadlines)
    .where(
      and(
        eq(deadlines.householdId, householdId),
        isNull(deadlines.metAt),
        isNull(deadlines.archivedAt),
        lte(deadlines.dueOn, new Date(`${todayIso}T00:00:00Z`))
      )
    )
    .orderBy(asc(deadlines.dueOn))
    .limit(100);

  // The household's own day, in its own timezone — not a rolling 24h from
  // "now", which would spill tomorrow morning's events into tonight.
  const dayStart = wallClockToInstant({ year: Number(todayIso.slice(0, 4)), month: Number(todayIso.slice(5, 7)), day: Number(todayIso.slice(8, 10)), hour: 0, minute: 0 }, timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const events = await getCalendarOccurrences(actor, householdId, dayStart, dayEnd);

  const visibleDeadlines = deadlineRows
    .filter((row) =>
      canAccess(actor, "read", {
        householdId: row.householdId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
        ownerUserId: row.createdBy ?? undefined,
      })
    )
    .map((row) => ({ id: row.id, title: row.title, dueOn: row.dueOn }));

  return { todayIso, dueToday, waiting, deadlines: visibleDeadlines, events };
}
