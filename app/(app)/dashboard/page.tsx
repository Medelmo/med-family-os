import { getTranslations } from "next-intl/server";
import { auth } from "../../../infrastructure/auth/auth";
import { getHouseholdMembers } from "../../../application/queries/household/getHouseholdMembers";
import { Card } from "../../../components/ui/Card";
import styles from "./dashboard.module.css";

export default async function DashboardPage() {
  const session = await auth();
  const t = await getTranslations("home");

  // app/(app)/layout.tsx already redirects an unauthenticated visitor away;
  // a session with no household (e.g. a mid-setup edge case) still has
  // nothing to show here rather than crashing on a missing householdId.
  const members =
    session?.user?.householdId && session.user.role
      ? await getHouseholdMembers(
          {
            userId: session.user.id,
            householdId: session.user.householdId,
            role: session.user.role,
            personIds: session.user.personIds,
          },
          session.user.householdId
        )
      : [];

  return (
    <div className={styles.grid}>
      <Card>
        <h1 className={styles.greeting}>{t("greeting", { name: session?.user?.name ?? "" })}</h1>
        <p className={styles.memberCount}>{t("householdMembersCount", { count: members.length })}</p>
      </Card>
    </div>
  );
}
