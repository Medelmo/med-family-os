/**
 * Bulk-import household context into a Med Family OS account.
 *
 * Built for one situation: a freshly deployed instance that is empty, and
 * a pile of real household context that lives somewhere else — exported
 * conversations, notes, a spreadsheet, a list someone typed out.
 *
 * It goes through the application's own command layer and nothing else.
 * That is the whole design: `captureInboxItem` and `createCase` each
 * validate their input with Zod, check authorization against a real
 * Actor, and write an audit event in the same transaction as the record.
 * A script that INSERTed rows directly would be faster to write and would
 * skip every one of those, producing rows the application would never
 * have accepted and no audit trail saying where they came from.
 *
 * Run with tsx, because the commands are TypeScript with extensionless
 * imports that plain node cannot resolve:
 *
 *   npx tsx scripts/import-context.ts --email you@example.com --file items.jsonl
 *   npx tsx scripts/import-context.ts --email you@example.com --file items.jsonl --apply
 *
 * Without `--apply` it changes nothing and prints what it would do.
 */

import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../infrastructure/db/client";
import { householdMemberships, inboxItems, people, users, cases } from "../db/schema";
import { captureInboxItem } from "../application/commands/inbox/captureInboxItem";
import { createCase } from "../application/commands/cases/createCase";
import type { Actor } from "../application/policies/authorize";

/* ------------------------------------------------------------------ *
 * the file format
 * ------------------------------------------------------------------ */

/**
 * One JSON object per line. Deliberately JSONL rather than one big JSON
 * document: the file is meant to be *reviewed and edited by a person*
 * before it is applied, and deleting a line you disagree with should not
 * be able to break the syntax of everything after it.
 */
type Item =
  | { kind: "inbox"; text: string }
  | {
      kind: "case";
      title: string;
      description?: string;
      nextAction?: string;
      priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
      /** false leaves it in DRAFT — for a matter that is not live yet. */
      activate?: boolean;
    };

function parseItems(path: string): Item[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const items: Item[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Blank lines and # comments are skipped so the file can carry notes
    // to whoever is reviewing it.
    if (!trimmed || trimmed.startsWith("#")) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`Line ${index + 1} is not valid JSON: ${trimmed.slice(0, 80)}`);
    }

    const item = parsed as Item;
    if (item.kind !== "inbox" && item.kind !== "case") {
      throw new Error(`Line ${index + 1}: kind must be "inbox" or "case", got ${JSON.stringify((item as { kind?: unknown }).kind)}`);
    }
    if (item.kind === "inbox" && !item.text?.trim()) {
      throw new Error(`Line ${index + 1}: an inbox item needs text.`);
    }
    if (item.kind === "case" && !item.title?.trim()) {
      throw new Error(`Line ${index + 1}: a case needs a title.`);
    }

    items.push(item);
  });

  return items;
}

/* ------------------------------------------------------------------ *
 * who the import runs as
 * ------------------------------------------------------------------ */

/**
 * Builds a real Actor from an email address.
 *
 * Not a synthetic "system" actor with the rules switched off. Every
 * imported record is therefore attributed to an actual account, is subject
 * to that account's role, and appears in the audit log as something that
 * person's session did — which is the truth, since they asked for it.
 *
 * Mirrors infrastructure/auth/currentActor.ts, which builds the same shape
 * from a session instead of from the database.
 */
async function resolveActor(email: string): Promise<{ actor: Actor; userName: string }> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No account with the email ${email}. Check it against the sign-in you use.`);

  const [membership] = await db
    .select()
    .from(householdMemberships)
    .where(eq(householdMemberships.userId, user.id))
    .limit(1);
  if (!membership) throw new Error(`${email} exists but belongs to no household.`);

  const personRows = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.householdId, membership.householdId), eq(people.accountUserId, user.id)));

  return {
    actor: {
      userId: user.id,
      householdId: membership.householdId,
      role: membership.role,
      personIds: personRows.map((row) => row.id),
    },
    userName: user.name ?? email,
  };
}

/* ------------------------------------------------------------------ *
 * not importing the same thing twice
 * ------------------------------------------------------------------ */

/**
 * Re-running the import must not double everything.
 *
 * There is no dedupe key on an inbox item — nothing in the domain needed
 * one, because a person capturing the same thought twice is a person, not
 * a bug. So this compares against what is already there by exact text and
 * title. Crude, and honest about being crude: it catches the realistic
 * case (the same file applied twice) and does not pretend to catch a
 * reworded duplicate.
 */
async function existingContent(householdId: string) {
  const [inboxRows, caseRows] = await Promise.all([
    db.select({ text: inboxItems.capturedText }).from(inboxItems).where(eq(inboxItems.householdId, householdId)),
    db.select({ title: cases.title }).from(cases).where(eq(cases.householdId, householdId)),
  ]);

  return {
    inbox: new Set(inboxRows.map((row) => row.text.trim())),
    cases: new Set(caseRows.map((row) => row.title.trim())),
  };
}

/* ------------------------------------------------------------------ *
 * the run
 * ------------------------------------------------------------------ */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = arg("email");
  const file = arg("file");
  const apply = process.argv.includes("--apply");

  if (!email || !file) {
    console.error(
      [
        "Usage:",
        "  npx tsx scripts/import-context.ts --email <you@example.com> --file <items.jsonl> [--apply]",
        "",
        "Without --apply nothing is written and the plan is printed.",
      ].join("\n")
    );
    process.exit(2);
  }

  const items = parseItems(file);
  const { actor, userName } = await resolveActor(email);
  const existing = await existingContent(actor.householdId);

  console.log(`Importing as ${userName} <${email}> — role ${actor.role}, household ${actor.householdId}`);
  console.log(`${items.length} item(s) in ${file}`);
  console.log(apply ? "MODE: apply — this will write.\n" : "MODE: dry run — nothing will be written.\n");

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, item] of items.entries()) {
    const label = item.kind === "inbox" ? item.text.trim() : item.title.trim();
    const shortLabel = label.length > 70 ? `${label.slice(0, 67)}…` : label;

    const alreadyThere = item.kind === "inbox" ? existing.inbox.has(label) : existing.cases.has(label);
    if (alreadyThere) {
      console.log(`  skip   [${item.kind}] ${shortLabel}  (already present)`);
      skipped += 1;
      continue;
    }

    if (!apply) {
      console.log(`  would  [${item.kind}] ${shortLabel}`);
      created += 1;
      continue;
    }

    try {
      if (item.kind === "inbox") {
        await captureInboxItem(actor, actor.householdId, { capturedText: item.text });
        existing.inbox.add(label);
      } else {
        await createCase(actor, actor.householdId, {
          title: item.title,
          description: item.description ?? null,
          nextAction: item.nextAction ?? null,
          priority: item.priority ?? "NORMAL",
          activate: item.activate ?? true,
        });
        existing.cases.add(label);
      }
      console.log(`  ok     [${item.kind}] ${shortLabel}`);
      created += 1;
    } catch (error) {
      // One bad row must not abandon the rest half-imported: each command
      // is its own transaction, so a failure here has left nothing behind
      // and the remaining items are still worth attempting.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL   [${item.kind}] line ${index + 1}: ${message}`);
      failed += 1;
    }
  }

  console.log(
    `\n${apply ? "Created" : "Would create"} ${created}, skipped ${skipped} already present` +
      (failed ? `, ${failed} failed` : "")
  );

  if (!apply && created > 0) {
    console.log("\nRe-run with --apply to write these.");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
