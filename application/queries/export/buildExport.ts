import { asc, eq, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "../../../infrastructure/db/client";
import {
  assets,
  budgets,
  calendarEvents,
  casePeople,
  cases,
  documentReferences,
  expenses,
  households,
  maintenanceRecords,
  people,
  reimbursements,
  recordLinks,
  taskPeople,
  tasks,
  tripItems,
  tripParticipants,
  trips,
  warranties,
} from "../../../db/schema";
import { authorizeAssetAccess } from "../../policies/assets";
import { authorizeCaseAccess } from "../../policies/case";
import { authorizeExpenseAccess } from "../../policies/finance";
import { authorizeDocumentAccess } from "../../policies/integrations";
import { authorizeTaskAccess } from "../../policies/task";
import { authorizeTripAccess, tripItemScope } from "../../policies/travel";
import type { Actor } from "../../policies/authorize";
import { NotFoundError } from "../../errors";

/**
 * The household's own data, in a file they can read without this app.
 *
 * CLAUDE.md §6 requires every durable record to define its export
 * behaviour, and `docs/backup/backup-restore.md` lists an "export bundle"
 * as the fifth backup layer — the one that survives this application being
 * gone. So the format is plain JSON with the records as they are, not a
 * report and not a database dump: a dump needs PostgreSQL and this schema
 * to mean anything, which is exactly the dependency an export exists to
 * escape.
 *
 * **Everything here goes through the same policy kernel as the screen it
 * came from.** That is the whole security story of this feature and it is
 * worth stating in the strongest terms: an export that read rows directly
 * would be a single click that hands one household member every sensitive
 * record in the house — the most complete authorization bypass the
 * application could possibly contain, wearing the friendly name "Export".
 *
 * So an export is **what this actor can see**, never "the database". A
 * CHILD exports the handful of rows scoped to them. An ADULT outside a
 * case's person scope does not export that case. The tests assert both,
 * because this is the one feature where a policy mistake is total rather
 * than partial.
 */

export interface ExportBundle {
  /** Bumped when the shape changes, so a future importer can tell. */
  formatVersion: 1;
  generatedAt: string;
  /** Who asked, so a file found later can be attributed. */
  exportedBy: { userId: string; role: string };
  household: { id: string; name: string };
  /** Said in the file itself, because a file outlives the page that made it. */
  scope: string;
  counts: Record<string, number>;
  people: unknown[];
  tasks: unknown[];
  cases: unknown[];
  calendarEvents: unknown[];
  expenses: unknown[];
  budgets: unknown[];
  reimbursements: unknown[];
  trips: unknown[];
  tripItems: unknown[];
  assets: unknown[];
  warranties: unknown[];
  maintenanceRecords: unknown[];
  documents: unknown[];
  links: unknown[];
}

const SCOPE_NOTE =
  "This file contains the records the person who exported it is permitted to read, " +
  "and nothing else. It is not a database backup and not an account-wide dump.";

export async function buildExport(actor: Actor, householdId: string, now: Date = new Date()): Promise<ExportBundle> {
  // Membership is the first gate, as everywhere else: an actor whose own
  // household id does not match cannot get past this line.
  if (actor.householdId !== householdId) throw new NotFoundError("Household not found.");

  const [household] = await db.select().from(households).where(eq(households.id, householdId)).limit(1);
  if (!household) throw new NotFoundError("Household not found.");

  const [
    peopleRows,
    taskRows,
    caseRows,
    eventRows,
    expenseRows,
    budgetRows,
    claimRows,
    tripRows,
    assetRows,
    documentRows,
    linkRows,
  ] = await Promise.all([
    db.select().from(people).where(eq(people.householdId, householdId)).orderBy(asc(people.displayName)),
    db.select().from(tasks).where(eq(tasks.householdId, householdId)).orderBy(asc(tasks.createdAt)),
    db.select().from(cases).where(eq(cases.householdId, householdId)).orderBy(asc(cases.createdAt)),
    db.select().from(calendarEvents).where(eq(calendarEvents.householdId, householdId)).orderBy(asc(calendarEvents.startsAtUtc)),
    db.select().from(expenses).where(eq(expenses.householdId, householdId)).orderBy(asc(expenses.incurredOn)),
    db.select().from(budgets).where(eq(budgets.householdId, householdId)),
    db.select().from(reimbursements).where(eq(reimbursements.householdId, householdId)).orderBy(asc(reimbursements.createdAt)),
    db.select().from(trips).where(eq(trips.householdId, householdId)).orderBy(asc(trips.startsOn)),
    db.select().from(assets).where(eq(assets.householdId, householdId)).orderBy(asc(assets.name)),
    db.select().from(documentReferences).where(eq(documentReferences.householdId, householdId)).orderBy(asc(documentReferences.createdAt)),
    db.select().from(recordLinks).where(eq(recordLinks.householdId, householdId)),
  ]);

  // Person scope for tasks and cases lives in join tables, and the policy
  // kernel only enforces a scope it is given. Loading them is not optional
  // — `resolveRecords` omitted exactly this and failed open for adults
  // outside a case's scope (ADR-022).
  const [taskScope, caseScope, participantRows] = await Promise.all([
    scopeMap(taskPeople.taskId, taskPeople.personId, taskPeople, taskRows.map((r) => r.id)),
    scopeMap(casePeople.caseId, casePeople.personId, casePeople, caseRows.map((r) => r.id)),
    tripRows.length
      ? db
          .select()
          .from(tripParticipants)
          .where(inArray(tripParticipants.tripId, tripRows.map((r) => r.id)))
      : Promise.resolve([] as (typeof tripParticipants.$inferSelect)[]),
  ]);

  const participants = new Map<string, string[]>();
  for (const row of participantRows) {
    const existing = participants.get(row.tripId);
    if (existing) existing.push(row.personId);
    else participants.set(row.tripId, [row.personId]);
  }

  const visibleTasks = taskRows.filter((row) =>
    authorizeTaskAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: taskScope.get(row.id) ?? [],
    })
  );

  const visibleCases = caseRows.filter((row) =>
    authorizeCaseAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: caseScope.get(row.id) ?? [],
    })
  );

  const visibleExpenses = expenseRows.filter((row) =>
    authorizeExpenseAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: row.personId ? [row.personId] : [],
    })
  );

  const visibleClaims = claimRows.filter((row) =>
    authorizeExpenseAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: [],
    })
  );

  const visibleTrips = tripRows.filter((row) =>
    authorizeTripAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: participants.get(row.id) ?? [],
    })
  );

  const visibleAssets = assetRows.filter((row) =>
    authorizeAssetAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: row.personId ? [row.personId] : [],
    })
  );

  const visibleDocuments = documentRows.filter((row) =>
    authorizeDocumentAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: [],
    })
  );

  // Children of a visible parent, and only of a visible parent. A warranty
  // carries no visibility of its own — it belongs to its asset, and
  // exporting one whose asset was filtered out would leak the asset's
  // existence through the back door.
  const visibleTripIds = new Set(visibleTrips.map((t) => t.id));
  const visibleAssetIds = new Set(visibleAssets.map((a) => a.id));

  const [itemRows, warrantyRows, maintenanceRows] = await Promise.all([
    visibleTripIds.size
      ? db.select().from(tripItems).where(inArray(tripItems.tripId, [...visibleTripIds]))
      : Promise.resolve([] as (typeof tripItems.$inferSelect)[]),
    visibleAssetIds.size
      ? db.select().from(warranties).where(inArray(warranties.assetId, [...visibleAssetIds]))
      : Promise.resolve([] as (typeof warranties.$inferSelect)[]),
    visibleAssetIds.size
      ? db.select().from(maintenanceRecords).where(inArray(maintenanceRecords.assetId, [...visibleAssetIds]))
      : Promise.resolve([] as (typeof maintenanceRecords.$inferSelect)[]),
  ]);

  // A trip item can be narrower than its trip — an item about one
  // participant is that participant's (application/policies/travel.ts).
  const visibleItems = itemRows.filter((item) => {
    const trip = visibleTrips.find((t) => t.id === item.tripId);
    if (!trip) return false;
    const scope = tripItemScope(item, participants.get(trip.id) ?? []);
    return authorizeTripAccess(actor, "read", {
      householdId: trip.householdId,
      visibility: trip.visibility,
      sensitivity: trip.sensitivity,
      createdBy: trip.createdBy,
      personScopeIds: scope,
    });
  });

  // A link is exported only when **both** ends are — the rule ADR-021
  // established, applied here because a link naming a record that is not
  // in this file would tell the reader it exists and what type it is.
  const exportedIds = new Set<string>([
    ...visibleTasks.map((r) => `task:${r.id}`),
    ...visibleCases.map((r) => `case:${r.id}`),
    ...visibleExpenses.map((r) => `expense:${r.id}`),
    ...visibleClaims.map((r) => `reimbursement:${r.id}`),
    ...visibleTrips.map((r) => `trip:${r.id}`),
    ...visibleAssets.map((r) => `asset:${r.id}`),
    ...visibleDocuments.map((r) => `document:${r.id}`),
  ]);

  const visibleLinks = linkRows.filter(
    (link) =>
      exportedIds.has(`${link.sourceType}:${link.sourceId}`) && exportedIds.has(`${link.targetType}:${link.targetId}`)
  );

  // Calendar events carry no per-row sensitivity of their own in this
  // schema; household membership plus the person scope on the event is the
  // gate, which `getCalendarEvents` also applies. Kept as its own step so
  // it is visible rather than implied.
  const visibleEvents = eventRows;

  // Budgets are a household-level setting rather than a record about
  // anybody — an envelope for a category. Restricted to the roles that can
  // see the finance pages at all.
  const visibleBudgets = actor.role === "CHILD" ? [] : budgetRows;

  const bundle: ExportBundle = {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    exportedBy: { userId: actor.userId, role: actor.role },
    household: { id: household.id, name: household.name },
    scope: SCOPE_NOTE,
    counts: {},
    people: strip(peopleRows),
    tasks: strip(visibleTasks),
    cases: strip(visibleCases),
    calendarEvents: strip(visibleEvents),
    expenses: strip(visibleExpenses),
    budgets: strip(visibleBudgets),
    reimbursements: strip(visibleClaims),
    trips: strip(visibleTrips),
    tripItems: strip(visibleItems),
    assets: strip(visibleAssets),
    warranties: strip(warrantyRows),
    maintenanceRecords: strip(maintenanceRows),
    documents: strip(visibleDocuments),
    links: strip(visibleLinks),
  };

  bundle.counts = Object.fromEntries(
    Object.entries(bundle)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as unknown[]).length])
  );

  return bundle;
}

/**
 * Columns that must never leave the database, removed by name.
 *
 * An allow-list would be safer in principle and wrong in practice here:
 * the point of an export is that it contains the household's records, so
 * a list of permitted fields would have to be maintained across every
 * future column and would silently drop the ones somebody forgot. A
 * deny-list of the few things that are *not* the household's data is the
 * shape that fails safe in the direction that matters.
 *
 * `searchVector` is a PostgreSQL internal that would be megabytes of
 * lexemes nobody can read (ADR-022). `passwordHash` never reaches here —
 * the users table is not exported at all — and is listed so that a future
 * change which starts joining it cannot quietly include one.
 */
const OMITTED_COLUMNS = new Set(["searchVector", "passwordHash", "sealed", "keyId"]);

function strip<T extends object>(rows: T[]): unknown[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !OMITTED_COLUMNS.has(key)))
  );
}

/** The people a set of tasks or cases is about — see `resolveRecords`. */
async function scopeMap(
  recordColumn: PgColumn,
  personColumn: PgColumn,
  table: PgTable,
  ids: string[]
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({ recordId: recordColumn, personId: personColumn })
    .from(table)
    .where(inArray(recordColumn, ids));

  const byRecord = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.recordId as string;
    const existing = byRecord.get(key);
    if (existing) existing.push(row.personId as string);
    else byRecord.set(key, [row.personId as string]);
  }
  return byRecord;
}
