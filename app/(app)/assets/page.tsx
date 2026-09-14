import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getAssets } from "../../../application/queries/assets/getAssets";
import { getHouseholdMembers } from "../../../application/queries/household/getHouseholdMembers";
import { getHouseholdTimezone } from "../../../application/queries/tasks/getTasks";
import { householdToday } from "../../../application/time";
import { authorizeAssetAccess } from "../../../application/policies/assets";
import { ASSET_CATEGORIES } from "../../../domain/assets/asset";
import { Card } from "../../../components/ui/Card";
import { AddAssetForm } from "./AssetsClient";
import styles from "./assets.module.css";

export default async function AssetsPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("assets");
  const tCategories = await getTranslations("assets.categories");

  const timezone = await getHouseholdTimezone(householdId);
  const today = householdToday(timezone);

  // Decided on the server from the same policy the command enforces. A
  // posted form is still refused; this only avoids showing someone a form
  // that can only fail.
  const canAdd = authorizeAssetAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    createdBy: actor.userId,
    personScopeIds: [],
  });

  const [assets, members] = await Promise.all([
    getAssets(actor, householdId),
    canAdd ? getHouseholdMembers(actor, householdId) : Promise.resolve([]),
  ]);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {assets.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {assets.map((asset) => (
            <li key={asset.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <h2 className={styles.itemTitle}>
                    <Link href={`/assets/${asset.id}`}>{asset.name}</Link>
                  </h2>
                  <span className={styles.category}>{tCategories(asset.category)}</span>
                </div>

                {(asset.location || asset.personName) && (
                  <p className={styles.meta}>
                    {[asset.location, asset.personName].filter(Boolean).join(" · ")}
                  </p>
                )}

                {/* The two dates mean different things, so they are said
                    differently: a service is owed by its date, cover ends
                    on its own (ADR-017). */}
                <p className={styles.meta}>
                  {asset.nextServiceDueOn ? t("nextService", { date: asset.nextServiceDueOn }) : t("noServiceDue")}
                </p>
                <p className={coverClass(asset.coverEndsOn, today, styles)}>
                  {asset.coverEndsOn
                    ? asset.coverEndsOn >= today
                      ? t("coverUntil", { date: asset.coverEndsOn })
                      : t("coverLapsed", { date: asset.coverEndsOn })
                    : t("noCover")}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <AddAssetForm
          categories={ASSET_CATEGORIES.map((category) => ({ value: category, label: tCategories(category) }))}
          people={members.map((member) => ({ id: member.personId, name: member.displayName }))}
        />
      )}
    </div>
  );
}

function coverClass(coverEndsOn: string | null, today: string, css: Record<string, string>): string {
  if (!coverEndsOn) return css.meta;
  return coverEndsOn >= today ? css.coverActive : css.coverLapsed;
}
