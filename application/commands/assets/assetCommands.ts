import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { assets, maintenanceRecords, warranties } from "../../../db/schema";
import {
  ASSET_CATEGORIES,
  defaultSensitivityFor,
  validateMaintenance,
  validateWarranty,
} from "../../../domain/assets/asset";
import { parseAmountToMinor } from "../../../domain/finance/money";
import { getHouseholdTimezone } from "../../queries/tasks/getTasks";
import { householdToday } from "../../time";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeAssetAccess } from "../../policies/assets";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class AssetRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssetRuleError";
    this.code = code;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.");

const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(300),
  category: z.enum(ASSET_CATEGORIES).default("OTHER"),
  location: z.string().trim().max(200).nullish(),
  manufacturer: z.string().trim().max(200).nullish(),
  identifier: z.string().trim().max(200).nullish(),
  purchasedOn: isoDate.nullish(),
  /** Text, parsed by the single documented money rule (ADR-015 §2). */
  purchasePrice: z.string().trim().max(30).nullish(),
  currency: currency.default("EUR"),
  personId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type CreateAssetInput = z.input<typeof createAssetSchema>;

/**
 * Records something the household owns.
 *
 * Sensitivity is decided from the category, not accepted from the caller:
 * a MEDICAL or MOBILITY asset is raised to SENSITIVE automatically,
 * because the safe answer has to be the automatic one. The same argument
 * that made every expense SENSITIVE by default (ADR-015 §4) — a default
 * that depends on someone remembering fails open.
 */
export async function createAsset(actor: Actor, householdId: string, input: CreateAssetInput) {
  const parsed = createAssetSchema.parse(input);

  let purchasePriceMinor: number | null = null;
  if (parsed.purchasePrice) {
    const amount = parseAmountToMinor(parsed.purchasePrice, parsed.currency);
    if (!amount.ok) throw new AssetRuleError("AMOUNT_INVALID", `That price could not be read (${amount.reason}).`);
    if (amount.amountMinor < 0) throw new AssetRuleError("AMOUNT_INVALID", "A price cannot be negative.");
    purchasePriceMinor = amount.amountMinor;
  }

  const sensitivity = defaultSensitivityFor(parsed.category);

  const authorized = authorizeAssetAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity,
    createdBy: actor.userId,
    personScopeIds: parsed.personId ? [parsed.personId] : [],
  });
  if (!authorized) throw new AuthorizationError("Not permitted to add an asset to this household.");

  return db.transaction(async (tx) => {
    const [asset] = await tx
      .insert(assets)
      .values({
        householdId,
        name: parsed.name,
        category: parsed.category,
        location: parsed.location ?? null,
        manufacturer: parsed.manufacturer ?? null,
        identifier: parsed.identifier ?? null,
        purchasedOn: parsed.purchasedOn ?? null,
        purchasePriceMinor,
        currency: purchasePriceMinor === null ? null : parsed.currency,
        personId: parsed.personId ?? null,
        notes: parsed.notes ?? null,
        sensitivity,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "asset.created",
        resourceType: "asset",
        resourceId: asset.id,
        // The category, never the name or the price: an audit log is read
        // by people who may not be able to open the record itself.
        metadata: { category: parsed.category, sensitivity },
      },
      tx
    );

    return asset;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadAssetForUpdate(tx: Tx, actor: Actor, householdId: string, assetId: string) {
  const [row] = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Asset not found.");

  const authorized = authorizeAssetAccess(actor, "update", {
    householdId: row.householdId,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    createdBy: row.createdBy,
    personScopeIds: row.personId ? [row.personId] : [],
  });
  if (!authorized) throw new AuthorizationError("Not permitted to change this asset.");

  return row;
}

const warrantySchema = z.object({
  provider: z.string().trim().min(1).max(200),
  startsOn: isoDate,
  endsOn: isoDate,
  reference: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type AddWarrantyInput = z.input<typeof warrantySchema>;

export async function addWarranty(actor: Actor, householdId: string, assetId: string, input: AddWarrantyInput) {
  const parsed = warrantySchema.parse(input);

  const validated = validateWarranty(parsed);
  if (!validated.ok) throw new AssetRuleError(validated.rejection.code, validated.rejection.message);

  return db.transaction(async (tx) => {
    await loadAssetForUpdate(tx, actor, householdId, assetId);

    const [warranty] = await tx
      .insert(warranties)
      .values({
        assetId,
        householdId,
        provider: validated.value.provider,
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn,
        reference: parsed.reference ?? null,
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "warranty.added",
        resourceType: "warranty",
        resourceId: warranty.id,
        metadata: { assetId },
      },
      tx
    );

    return warranty;
  });
}

const maintenanceSchema = z.object({
  performedOn: isoDate,
  summary: z.string().trim().min(1).max(300),
  performedBy: z.string().trim().max(200).nullish(),
  cost: z.string().trim().max(30).nullish(),
  currency: currency.default("EUR"),
  nextDueOn: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type AddMaintenanceInput = z.input<typeof maintenanceSchema>;

/**
 * Records a service that happened.
 *
 * Append-only: there is no update or delete path, for the same reason the
 * case timeline has none. A service history that can be edited afterwards
 * cannot answer "when was the boiler last serviced?", and answering that
 * is the point.
 */
export async function addMaintenanceRecord(
  actor: Actor,
  householdId: string,
  assetId: string,
  input: AddMaintenanceInput,
  now: Date = new Date()
) {
  const parsed = maintenanceSchema.parse(input);

  const timezone = await getHouseholdTimezone(householdId);
  const todayIso = householdToday(timezone, now);

  const validated = validateMaintenance({ performedOn: parsed.performedOn, nextDueOn: parsed.nextDueOn }, todayIso);
  if (!validated.ok) throw new AssetRuleError(validated.rejection.code, validated.rejection.message);

  let costMinor: number | null = null;
  if (parsed.cost) {
    const amount = parseAmountToMinor(parsed.cost, parsed.currency);
    if (!amount.ok) throw new AssetRuleError("AMOUNT_INVALID", `That cost could not be read (${amount.reason}).`);
    if (amount.amountMinor < 0) throw new AssetRuleError("AMOUNT_INVALID", "A cost cannot be negative.");
    costMinor = amount.amountMinor;
  }

  return db.transaction(async (tx) => {
    await loadAssetForUpdate(tx, actor, householdId, assetId);

    const [record] = await tx
      .insert(maintenanceRecords)
      .values({
        assetId,
        householdId,
        performedOn: parsed.performedOn,
        summary: parsed.summary,
        performedBy: parsed.performedBy ?? null,
        costMinor,
        currency: costMinor === null ? null : parsed.currency,
        nextDueOn: parsed.nextDueOn ?? null,
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "asset.serviced",
        resourceType: "asset",
        resourceId: assetId,
      },
      tx
    );

    return record;
  });
}

/**
 * Records that an asset has left the household.
 *
 * The only transition an asset has, and it happens once — see
 * domain/assets/asset.ts for why there is no state machine here. Disposing
 * of it takes it out of Attention: a warranty on a machine that is gone is
 * not something anybody needs reminding about.
 */
export async function disposeAsset(
  actor: Actor,
  householdId: string,
  assetId: string,
  expectedVersion: number,
  input: { disposedOn: string; note?: string | null },
  now: Date = new Date()
) {
  const parsed = z.object({ disposedOn: isoDate, note: z.string().trim().max(500).nullish() }).parse(input);

  return db.transaction(async (tx) => {
    const row = await loadAssetForUpdate(tx, actor, householdId, assetId);

    if (row.disposedOn) {
      throw new AssetRuleError("ALREADY_DISPOSED", "This asset has already been disposed of.");
    }

    const updated = await tx
      .update(assets)
      .set({ disposedOn: parsed.disposedOn, disposalNote: parsed.note ?? null, updatedAt: now, version: row.version + 1 })
      .where(and(eq(assets.id, assetId), eq(assets.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This asset was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "asset.disposed",
        resourceType: "asset",
        resourceId: assetId,
      },
      tx
    );

    return updated[0];
  });
}
