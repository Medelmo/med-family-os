import { sql } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { users } from "../../../db/schema";

/**
 * Whether first-run bootstrap has already happened (ADR-012). Used to
 * gate /setup — it must not be reachable once at least one account exists.
 */
export async function isSetupComplete(): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return count > 0;
}
