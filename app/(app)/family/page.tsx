import { getTranslations } from "next-intl/server";
import { auth } from "../../../infrastructure/auth/auth";
import { getHouseholdMembers } from "../../../application/queries/household/getHouseholdMembers";
import { Card } from "../../../components/ui/Card";
import { AddMemberForm } from "./AddMemberForm";
import styles from "./family.module.css";

export default async function FamilyPage() {
  const session = await auth();
  const t = await getTranslations("family");

  if (!session?.user?.householdId || !session.user.role) {
    return null;
  }

  const actor = {
    userId: session.user.id,
    householdId: session.user.householdId,
    role: session.user.role,
    personIds: session.user.personIds,
  };
  const members = await getHouseholdMembers(actor, session.user.householdId);
  const canAddMembers = actor.role === "OWNER" || actor.role === "ADMIN";

  return (
    <div className={styles.grid}>
      <Card>
        <h1 className={styles.title}>{t("title")}</h1>
        <ul className={styles.list}>
          {members.map((member) => (
            <li key={member.personId} className={styles.row}>
              <span>{member.displayName}</span>
              <span className={styles.meta}>{member.role ?? t("noAccount")}</span>
            </li>
          ))}
        </ul>
      </Card>
      {canAddMembers && (
        <Card>
          <h2 className={styles.subtitle}>{t("addMember")}</h2>
          <AddMemberForm />
        </Card>
      )}
    </div>
  );
}
