// Liveness probe: "is the process up", no dependency checks. Docker Compose
// restart policies / an external monitor should treat a non-200 here as
// "restart the container", not "degrade gracefully" — that's what
// /api/ready is for (docs/architecture/target-architecture.md "Failure
// behavior").
export async function GET() {
  return Response.json({ status: "ok" });
}
