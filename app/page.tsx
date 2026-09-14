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

  redirect("/dashboard");
}
