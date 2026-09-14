/**
 * Starts the outbox worker once per server process (ADR-013).
 *
 * `register` is Next.js's server-startup hook. The runtime guard matters:
 * this file is also evaluated for the Edge runtime, where the Postgres
 * driver cannot run, so the import has to stay inside the branch rather
 * than at module scope.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.OUTBOX_WORKER_ENABLED === "false") return;
  // No database, no worker — a build or a typecheck must not try to
  // connect.
  if (!process.env.DATABASE_URL) return;

  const { startOutboxWorker } = await import("./infrastructure/outbox/worker");
  startOutboxWorker();
}
