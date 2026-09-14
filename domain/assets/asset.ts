import type { Sensitivity, Visibility } from "../shared/types";

/**
 * docs/domain/domain-model.md: "A durable household object."
 *
 * **An asset has no state machine, and that is deliberate.** Cases, trips
 * and reimbursement claims each have one because each is a *process* the
 * household is working through, where the legal next steps are the whole
 * point. A washing machine is not a process. It is owned, and then one day
 * it is not — sold, broken, given away — which is a single fact with a
 * date, not a lifecycle.
 *
 * Inventing PLANNED/ACTIVE/RETIRED here would have produced states nobody
 * transitions deliberately and which would drift out of date the moment
 * someone forgot to update one. `disposedOn` says the only thing there is
 * to say.
 */
export interface Asset {
  id: string;
  householdId: string;
  name: string;
  category: AssetCategory;
  /** Where it is — "kitchen", "loft", "Lukas's room". */
  location: string | null;
  manufacturer: string | null;
  /** Model or serial number, for a warranty claim or a service booking. */
  identifier: string | null;
  purchasedOn: string | null;
  /** Minor units; the household's own money rules apply (ADR-015). */
  purchasePriceMinor: number | null;
  currency: string | null;
  /** Whose it is, when it belongs to one person rather than the household. */
  personId: string | null;
  notes: string | null;

  /** The day it left the household. Set once; nothing transitions back. */
  disposedOn: string | null;
  disposalNote: string | null;
  archivedAt: Date | null;

  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A short fixed list, for the same reasons as the expense categories
 * (ADR-015 §3): free text cannot be filtered on or translated, and
 * un-picking it afterwards means guessing at the household's own data.
 */
export const ASSET_CATEGORIES = [
  "APPLIANCE",
  "ELECTRONICS",
  "FURNITURE",
  "MOBILITY",
  "MEDICAL",
  "VEHICLE",
  "TOOL",
  "OTHER",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export function isAssetCategory(value: string): value is AssetCategory {
  return (ASSET_CATEGORIES as readonly string[]).includes(value);
}

/**
 * `MOBILITY` and `MEDICAL` default to SENSITIVE; everything else is
 * NORMAL.
 *
 * A wheelchair or a nebuliser in the asset list says something about a
 * household member's health, which CLAUDE.md §5 keeps away from child
 * accounts and §10 keeps out of the Home Assistant projection. A
 * dishwasher says nothing about anybody.
 *
 * Doing this by category rather than asking the person recording it means
 * the safe answer is the automatic one — the same argument that made every
 * expense SENSITIVE by default.
 */
export function defaultSensitivityFor(category: AssetCategory): Sensitivity {
  return category === "MEDICAL" || category === "MOBILITY" ? "SENSITIVE" : "NORMAL";
}

export interface Warranty {
  id: string;
  assetId: string;
  householdId: string;
  /** Who is on the hook — the retailer, the manufacturer, an insurer. */
  provider: string;
  startsOn: string;
  endsOn: string;
  /** Their claim or policy number, so the cover can actually be used. */
  reference: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  householdId: string;
  performedOn: string;
  /** What was done: "annual service", "replaced the filter". */
  summary: string;
  performedBy: string | null;
  costMinor: number | null;
  currency: string | null;
  /** When it should next be done, if it is the recurring kind. */
  nextDueOn: string | null;
  notes: string | null;
  createdAt: Date;
}

export type AssetRejection =
  | { code: "NAME_REQUIRED"; message: string }
  | { code: "PROVIDER_REQUIRED"; message: string }
  | { code: "WARRANTY_DATES_OUT_OF_ORDER"; message: string }
  | { code: "MAINTENANCE_IN_FUTURE"; message: string }
  | { code: "NEXT_DUE_BEFORE_PERFORMED"; message: string }
  | { code: "ALREADY_DISPOSED"; message: string };

export type AssetResult<T> = { ok: true; value: T } | { ok: false; rejection: AssetRejection };

export function validateWarranty(input: {
  provider: string;
  startsOn: string;
  endsOn: string;
}): AssetResult<{ provider: string }> {
  const provider = input.provider.trim();
  if (!provider) {
    return { ok: false, rejection: { code: "PROVIDER_REQUIRED", message: "Say who the warranty is with." } };
  }
  if (input.endsOn < input.startsOn) {
    return {
      ok: false,
      rejection: { code: "WARRANTY_DATES_OUT_OF_ORDER", message: "Cover cannot end before it starts." },
    };
  }
  return { ok: true, value: { provider } };
}

/**
 * A maintenance record is a record of something that *happened*.
 *
 * Dating one in the future would make "when was it last serviced?"
 * answerable with a date nobody has reached, and would quietly satisfy a
 * service that is actually overdue — which is the exact question this
 * whole feature exists to answer.
 */
export function validateMaintenance(
  input: { performedOn: string; nextDueOn?: string | null },
  todayIso: string
): AssetResult<null> {
  if (input.performedOn > todayIso) {
    return {
      ok: false,
      rejection: { code: "MAINTENANCE_IN_FUTURE", message: "A service record is something that already happened." },
    };
  }
  if (input.nextDueOn && input.nextDueOn < input.performedOn) {
    return {
      ok: false,
      rejection: { code: "NEXT_DUE_BEFORE_PERFORMED", message: "The next service cannot be due before this one." },
    };
  }
  return { ok: true, value: null };
}

/**
 * When this asset is next due a service.
 *
 * Taken from the **most recent** record rather than the earliest
 * outstanding `nextDueOn`: each service supersedes the plan the one before
 * it set, so a machine serviced early in March is not still due the date
 * February's record predicted.
 *
 * Records are compared by the day they were performed, with the most
 * recently created winning a tie — two services on one day means somebody
 * corrected the first.
 */
export function nextMaintenanceDue(
  records: readonly Pick<MaintenanceRecord, "performedOn" | "nextDueOn" | "createdAt">[]
): string | null {
  if (records.length === 0) return null;

  const latest = [...records].sort((a, b) => {
    if (a.performedOn !== b.performedOn) return a.performedOn < b.performedOn ? 1 : -1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];

  return latest.nextDueOn;
}

/**
 * The day this asset stops being covered, or null if it never was.
 *
 * The **latest** end date across warranties: two overlapping covers (a
 * retailer's year and a manufacturer's three) leave the household
 * protected until the later one runs out, and warning them when the
 * shorter one lapses would be crying wolf.
 */
export function coverEndsOn(warranties: readonly Pick<Warranty, "endsOn">[]): string | null {
  if (warranties.length === 0) return null;
  return warranties.reduce((latest, warranty) => (warranty.endsOn > latest ? warranty.endsOn : latest), warranties[0].endsOn);
}

export function isCoverActive(warranties: readonly Pick<Warranty, "endsOn">[], todayIso: string): boolean {
  const endsOn = coverEndsOn(warranties);
  return endsOn !== null && endsOn >= todayIso;
}
