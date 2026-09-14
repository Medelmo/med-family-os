import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { recordLinks } from "../../../db/schema";
import { LINKABLE_TYPES, otherEnd, validateLink, type RecordRef } from "../../../domain/links/recordLink";
import { resolveRecords, key } from "../../links/resolveRecords";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, NotFoundError } from "../../errors";

export class LinkRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LinkRuleError";
    this.code = code;
  }
}

const refSchema = z.object({ type: z.enum(LINKABLE_TYPES), id: z.string().uuid() });

const linkSchema = z.object({
  from: refSchema,
  to: refSchema,
  note: z.string().trim().max(500).nullish(),
});

export type LinkRecordsInput = z.input<typeof linkSchema>;

/**
 * Links two records.
 *
 * **Both ends must be readable by the actor.** Linking is a statement
 * about context, and a household member who cannot see a record has no
 * business asserting what it relates to — nor learning it exists by
 * linking to it and seeing whether the call succeeded.
 *
 * Readability is checked through `resolveRecords`, which runs each end
 * through the policy kernel exactly as that record's own page would. A
 * record the actor cannot read is reported as not found rather than
 * forbidden: for the far end of a link, "you may not see this" and "this
 * does not exist" should look the same, or the refusal itself becomes a
 * way to test whether something is there.
 */
export async function linkRecords(actor: Actor, householdId: string, input: LinkRecordsInput) {
  const parsed = linkSchema.parse(input);

  const validated = validateLink(parsed.from as RecordRef, parsed.to as RecordRef);
  if (!validated.ok) throw new LinkRuleError(validated.rejection.code, validated.rejection.message);

  const { source, target } = validated.value;

  const resolved = await resolveRecords(actor, householdId, [source, target]);
  if (!resolved.has(key(source)) || !resolved.has(key(target))) {
    throw new NotFoundError("One of those records does not exist, or is not yours to link.");
  }

  return db.transaction(async (tx) => {
    const [link] = await tx
      .insert(recordLinks)
      .values({
        householdId,
        sourceType: source.type,
        sourceId: source.id,
        targetType: target.type,
        targetId: target.id,
        note: parsed.note ?? null,
        createdBy: actor.userId,
      })
      // Linking something twice is a no-op, not an error. Two people
      // reaching the same conclusion about two records is not a conflict
      // worth interrupting either of them for.
      .onConflictDoNothing()
      .returning();

    if (link) {
      await recordAuditEvent(
        {
          householdId,
          actorUserId: actor.userId,
          action: "link.created",
          resourceType: "record_link",
          resourceId: link.id,
          // Types only. The ids would be fine, but the titles would not,
          // and keeping the shape uniform avoids the question.
          metadata: { from: source.type, to: target.type },
        },
        tx
      );
    }

    return link ?? null;
  });
}

/**
 * Removes a link.
 *
 * Both ends must still be readable, for the same reason as creating one:
 * otherwise removing a link would be a way to probe for records, and
 * somebody who cannot see a record could quietly detach it from the case
 * that explains it.
 */
export async function unlinkRecords(actor: Actor, householdId: string, linkId: string) {
  const [existing] = await db
    .select()
    .from(recordLinks)
    .where(and(eq(recordLinks.id, linkId), eq(recordLinks.householdId, householdId)))
    .limit(1);

  if (!existing) throw new NotFoundError("Link not found.");

  const source: RecordRef = { type: existing.sourceType, id: existing.sourceId };
  const target: RecordRef = { type: existing.targetType, id: existing.targetId };

  const resolved = await resolveRecords(actor, householdId, [source, target]);
  if (!resolved.has(key(source)) || !resolved.has(key(target))) {
    throw new AuthorizationError("Not permitted to change that link.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(recordLinks).where(eq(recordLinks.id, linkId));

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "link.removed",
        resourceType: "record_link",
        resourceId: linkId,
        metadata: { from: existing.sourceType, to: existing.targetType },
      },
      tx
    );
  });
}

export interface LinkedRecord {
  linkId: string;
  type: (typeof LINKABLE_TYPES)[number];
  id: string;
  label: string;
  href: string | null;
  note: string | null;
}

/**
 * What a record is linked to, as far as this actor is concerned.
 *
 * Both columns are searched because storage is canonical rather than
 * directional — a case may sit in either one depending on how the type
 * names sorted.
 */
export async function getLinksFor(actor: Actor, householdId: string, self: RecordRef): Promise<LinkedRecord[]> {
  const rows = await db
    .select()
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.householdId, householdId),
        or(
          and(eq(recordLinks.sourceType, self.type), eq(recordLinks.sourceId, self.id)),
          and(eq(recordLinks.targetType, self.type), eq(recordLinks.targetId, self.id))
        )
      )
    )
    .limit(100);

  if (rows.length === 0) return [];

  const others = rows.map((row) => otherEnd(row, self));
  const resolved = await resolveRecords(actor, householdId, others);

  return rows.flatMap((row) => {
    const other = otherEnd(row, self);
    const record = resolved.get(key(other));
    // Absent means either deleted or not visible to this actor. Both are
    // silence, deliberately — see resolveRecords.
    if (!record) return [];

    return [{ linkId: row.id, type: record.type, id: record.id, label: record.label, href: record.href, note: row.note }];
  });
}
