import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "../../../application/queries/household/isSetupComplete";
import { Card } from "../../../components/ui/Card";
import { SetupForm } from "./SetupForm";
import styles from "../auth-panel.module.css";

export default async function SetupPage() {
  // Not just UX: this is also the second half of ADR-012's bootstrap gate
  // (the first half is bootstrapHousehold's own transactional check) — a
  // direct GET to this page after setup is complete must not render a form
  // that would fail anyway, it should send the visitor to sign in.
  if (await isSetupComplete()) {
    redirect("/login");
  }

  const t = await getTranslations("setup");

  return (
    <div className={styles.page}>
      <Card className={styles.panel}>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
        <SetupForm />
      </Card>
    </div>
  );
}
