import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { assets, maintenanceRecords, people, warranties } from "../../../db/schema";
import { coverEndsOn, nextMaintenanceDue, type AssetCategory } from "../../../domain/assets/asset";
import { authorizeAssetAccess } from "../../policies/assets";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, NotFoundError } from "../../errors";

export interface AssetListItem {
  id: string;
  name: string;
  category: AssetCategory;
  location: string | null;
  personName: string | null;
  /** From the most recent service record — see nextMaintenanceDue. */
  nextServiceDueOn: string | null;
  /** The latest end date across warranties, or null if never covered. */
  coverEndsOn: string | null;
  disposedOn: string | null;
  version: number;
}

export interface WarrantyView {
  id: string;
  provider: string;
  startsOn: string;
  endsOn: string;
  reference: string | null;
  notes: string | null;
}

export interface MaintenanceView {
  id: string;
  performedOn: string;
  summary: string;
  performedBy: string | null;
  costMinor: number | null;
  currency: string | null;
  nextDueOn: string | null;
}

export interface AssetDetail extends AssetListItem {
  manufacturer: string | null;
  identifier: string | null;
  purchasedOn: string | null;
  purchasePriceMinor: number | null;
  currency: string | null;
  notes: string | null;
  disposalNote: string | null;
  warranties: WarrantyView[];
  maintenance: MaintenanceView[];
}

/**
 * Assets the actor may see, with the two derived dates the list needs.
 *
 * Warranties and service records for every listed asset are fetched in two
 * queries rather than two per asset, so a household with forty things does
 * not make eighty round trips.
 *
 * Disposed assets are excluded by default. A warranty on a machine that is
 * gone is not something anybody needs reminding about, and that is exactly
 * why disposal exists.
 */
export async function getAssets(
  actor: Actor,
  householdId: string,
  options: { includeDisposed?: boolean; limit?: number } = {}
): Promise<AssetListItem[]> {
  const rows = await db
    .select({ asset: assets, personName: people.displayName })
    .from(assets)
    .leftJoin(people, eq(people.id, assets.personId))
    .where(
      options.includeDisposed
        ? and(eq(assets.householdId, householdId), isNull(assets.archivedAt))
        : and(eq(assets.householdId, householdId), isNull(assets.archivedAt), isNull(assets.disposedOn))
    )
    .orderBy(asc(assets.name))
    .limit(options.limit ?? 200);

  if (rows.length === 0) return [];

  const assetIds = rows.map((row) => row.asset.id);

  const [warrantyRows, maintenanceRows] = await Promise.all([
    db
      .select({ assetId: warranties.assetId, endsOn: warranties.endsOn })
      .from(warranties)
      .where(inArray(warranties.assetId, assetIds)),
    db
      .select({
        assetId: maintenanceRecords.assetId,
        performedOn: maintenanceRecords.performedOn,
        nextDueOn: maintenanceRecords.nextDueOn,
        createdAt: maintenanceRecords.createdAt,
      })
      .from(maintenanceRecords)
      .where(inArray(maintenanceRecords.assetId, assetIds)),
  ]);

  const group = <T extends { assetId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const entry of list) {
      const existing = map.get(entry.assetId);
      if (existing) existing.push(entry);
      else map.set(entry.assetId, [entry]);
    }
    return map;
  };

  const warrantiesByAsset = group(warrantyRows);
  const maintenanceByAsset = group(maintenanceRows);

  return rows
    .filter(({ asset }) =>
      authorizeAssetAccess(actor, "read", {
        householdId: asset.householdId,
        visibility: asset.visibility,
        sensitivity: asset.sensitivity,
        createdBy: asset.createdBy,
        personScopeIds: asset.personId ? [asset.personId] : [],
      })
    )
    .map(({ asset, personName }) => ({
      id: asset.id,
      name: asset.name,
      category: asset.category,
      location: asset.location,
      personName,
      nextServiceDueOn: nextMaintenanceDue(maintenanceByAsset.get(asset.id) ?? []),
      coverEndsOn: coverEndsOn(warrantiesByAsset.get(asset.id) ?? []),
      disposedOn: asset.disposedOn,
      version: asset.version,
    }));
}

export async function getAsset(actor: Actor, householdId: string, assetId: string): Promise<AssetDetail> {
  const [row] = await db
    .select({ asset: assets, personName: people.displayName })
    .from(assets)
    .leftJoin(people, eq(people.id, assets.personId))
    .where(and(eq(assets.id, assetId), eq(assets.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Asset not found.");

  const authorized = authorizeAssetAccess(actor, "read", {
    householdId: row.asset.householdId,
    visibility: row.asset.visibility,
    sensitivity: row.asset.sensitivity,
    createdBy: row.asset.createdBy,
    personScopeIds: row.asset.personId ? [row.asset.personId] : [],
  });
  if (!authorized) throw new AuthorizationError("Not permitted to view this asset.");

  // Warranties and service records inherit the asset's authorization
  // rather than carrying their own — a service record readable when the
  // machine it describes is not would be an odd kind of leak.
  const [warrantyRows, maintenanceRows] = await Promise.all([
    db.select().from(warranties).where(eq(warranties.assetId, assetId)).orderBy(desc(warranties.endsOn)),
    db
      .select()
      .from(maintenanceRecords)
      .where(eq(maintenanceRecords.assetId, assetId))
      .orderBy(desc(maintenanceRecords.performedOn), desc(maintenanceRecords.createdAt)),
  ]);

  return {
    id: row.asset.id,
    name: row.asset.name,
    category: row.asset.category,
    location: row.asset.location,
    personName: row.personName,
    nextServiceDueOn: nextMaintenanceDue(maintenanceRows),
    coverEndsOn: coverEndsOn(warrantyRows),
    disposedOn: row.asset.disposedOn,
    version: row.asset.version,
    manufacturer: row.asset.manufacturer,
    identifier: row.asset.identifier,
    purchasedOn: row.asset.purchasedOn,
    purchasePriceMinor: row.asset.purchasePriceMinor,
    currency: row.asset.currency,
    notes: row.asset.notes,
    disposalNote: row.asset.disposalNote,
    warranties: warrantyRows.map((w) => ({
      id: w.id,
      provider: w.provider,
      startsOn: w.startsOn,
      endsOn: w.endsOn,
      reference: w.reference,
      notes: w.notes,
    })),
    maintenance: maintenanceRows.map((m) => ({
      id: m.id,
      performedOn: m.performedOn,
      summary: m.summary,
      performedBy: m.performedBy,
      costMinor: m.costMinor,
      currency: m.currency,
      nextDueOn: m.nextDueOn,
    })),
  };
}
