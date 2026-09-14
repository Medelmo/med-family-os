import { sql } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";

// Readiness probe: "can this instance actually serve requests right now".
// docs/architecture/target-architecture.md: "PostgreSQL unavailable:
// Readiness fails; app returns safe dependency error. No writes are
// accepted as successful." A reverse proxy/orchestrator should stop
// routing traffic here on a non-200, without restarting the container the
// way a failed liveness probe (/api/health) would.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "not_ready" }, { status: 503 });
  }
}
