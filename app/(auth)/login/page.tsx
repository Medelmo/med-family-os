import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSetupComplete } from "../../../application/queries/household/isSetupComplete";
import { auth } from "../../../infrastructure/auth/auth";
import { Card } from "../../../components/ui/Card";
import { LoginForm } from "./LoginForm";
import styles from "../auth-panel.module.css";

export default async function LoginPage() {
  if (!(await isSetupComplete())) {
    redirect("/setup");
  }

  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  const t = await getTranslations("login");

  return (
    <div className={styles.page}>
      <Card className={styles.panel}>
        <h1 className={styles.title}>{t("title")}</h1>
        <LoginForm />
      </Card>
    </div>
  );
}
