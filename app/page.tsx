import { redirect } from "next/navigation";
import { isSetupComplete } from "../application/queries/household/isSetupComplete";
import { auth } from "../infrastructure/auth/auth";

export default async function RootPage() {
  if (!(await isSetupComplete())) {
    redirect("/setup");
  }

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Lands on Today, not a dashboard: the product's whole thesis is
  // "what needs my attention, and what context do I need to act"
  // (docs/requirements/product-spec.md), and Today answers that directly.
  // docs/design/screen-inventory.md's richer Dashboard (attention strip,
  // deadlines, family events, trips, recent activity) is deferred until the
  // aggregates it summarises exist — a placeholder overview nothing links
  // to would be dead weight now.
  redirect("/today");
}
