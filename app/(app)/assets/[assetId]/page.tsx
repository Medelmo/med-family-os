import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { getAsset } from "../../../../application/queries/assets/getAssets";
import { getHouseholdTimezone } from "../../../../application/queries/tasks/getTasks";
import { householdToday } from "../../../../application/time";
import { authorizeAssetAccess } from "../../../../application/policies/assets";
import { NotFoundError } from "../../../../application/errors";
import { Card } from "../../../../components/ui/Card";
import { Money } from "../../../../components/ui/Money";
import { AddMaintenanceForm, AddWarrantyForm, DisposeAssetForm } from "../AssetsClient";
import styles from "../assets.module.css";

export default async function AssetDetailPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("assets");
  const tCategories = await getTranslations("assets.categories");
  const { assetId } = await params;

  const timezone = await getHouseholdTimezone(householdId);
  const today = householdToday(timezone);

  let asset;
  try {
    asset = await getAsset(actor, householdId, assetId);
  } catch (error) {
    // Not found is a 404; "you may not see this" belongs to the error
    // boundary, and the two stay distinct for a household whose members
    // all know each other.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canEdit = authorizeAssetAccess(actor, "update", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: asset.category === "MEDICAL" || asset.category === "MOBILITY" ? "SENSITIVE" : "NORMAL",
    createdBy: actor.userId,
    personScopeIds: [],
  });

  const hasDetails = Boolean(
    asset.manufacturer ||
      asset.identifier ||
      asset.location ||
      asset.personName ||
      asset.purchasedOn ||
      asset.purchasePriceMinor !== null
  );

  return (
    <div className={styles.page}>
      <p className={styles.breadcrumb}>
        <Link href="/assets">{t("title")}</Link>
      </p>

      <header>
        <h1 className={styles.title}>{asset.name}</h1>
        <p className={styles.category}>{tCategories(asset.category)}</p>
        {asset.disposedOn && (
          <p className={styles.disposed}>
            {t("disposedOn", { date: asset.disposedOn })}
            {asset.disposalNote ? ` · ${asset.disposalNote}` : ""}
          </p>
        )}
      </header>

      {/* Every field on this card is optional, so with none of them filled
          in it rendered as an empty box — a card that says nothing is
          worse than no card. */}
      {hasDetails && (
        <Card>
          <dl className={styles.definitions}>
            {asset.manufacturer && (
              <>
                <dt>{t("manufacturerLabel")}</dt>
                <dd>{asset.manufacturer}</dd>
              </>
            )}
            {asset.identifier && (
              <>
                <dt>{t("identifierLabel")}</dt>
                <dd>{asset.identifier}</dd>
              </>
            )}
            {asset.location && (
              <>
                <dt>{t("locationLabel")}</dt>
                <dd>{asset.location}</dd>
              </>
            )}
            {asset.personName && (
              <>
                <dt>{t("belongsToLabel")}</dt>
                <dd>{asset.personName}</dd>
              </>
            )}
            {asset.purchasedOn && (
              <>
                <dt>{t("purchasedOnLabel")}</dt>
                <dd>{asset.purchasedOn}</dd>
              </>
            )}
            {asset.purchasePriceMinor !== null && asset.currency && (
              <>
                <dt>{t("purchasePriceLabel")}</dt>
                <dd>
                  <Money amountMinor={asset.purchasePriceMinor} currency={asset.currency} />
                </dd>
              </>
            )}
          </dl>
        </Card>
      )}

      <section aria-labelledby="warranty-heading">
        <h2 id="warranty-heading" className={styles.subtitle}>
          {t("cover")}
        </h2>
        <Card>
          {asset.warranties.length === 0 ? (
            <p className={styles.empty}>{t("noCover")}</p>
          ) : (
            <ul className={styles.plainList}>
              {asset.warranties.map((warranty) => (
                <li key={warranty.id} className={styles.row}>
                  <span>
                    <strong>{warranty.provider}</strong>
                    <span className={styles.meta}>
                      {" "}
                      {t("coverRange", { from: warranty.startsOn, to: warranty.endsOn })}
                      {warranty.reference ? ` · ${warranty.reference}` : ""}
                    </span>
                  </span>
                  <span className={warranty.endsOn >= today ? styles.coverActive : styles.coverLapsed}>
                    {warranty.endsOn >= today ? t("coverStillActive") : t("coverExpired")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && !asset.disposedOn && <AddWarrantyForm assetId={asset.id} today={today} />}
        </Card>
      </section>

      <section aria-labelledby="service-heading">
        <h2 id="service-heading" className={styles.subtitle}>
          {t("serviceHistory")}
        </h2>
        <Card>
          <p className={styles.meta}>
            {asset.nextServiceDueOn ? t("nextService", { date: asset.nextServiceDueOn }) : t("noServiceDue")}
          </p>

          {asset.maintenance.length === 0 ? (
            <p className={styles.empty}>{t("noServices")}</p>
          ) : (
            // Append-only, like the case timeline: a service history that
            // can be edited afterwards cannot be relied on, and relying on
            // it is the point.
            <ol className={styles.plainList}>
              {asset.maintenance.map((record) => (
                <li key={record.id} className={styles.row}>
                  <span>
                    <strong>{record.performedOn}</strong> · {record.summary}
                    {record.performedBy ? ` · ${record.performedBy}` : ""}
                  </span>
                  {record.costMinor !== null && record.currency && (
                    <Money amountMinor={record.costMinor} currency={record.currency} />
                  )}
                </li>
              ))}
            </ol>
          )}

          {canEdit && !asset.disposedOn && <AddMaintenanceForm assetId={asset.id} today={today} />}
        </Card>
      </section>

      {canEdit && !asset.disposedOn && (
        <section aria-labelledby="dispose-heading">
          <h2 id="dispose-heading" className={styles.subtitle}>
            {t("disposeHeading")}
          </h2>
          <Card>
            <p className={styles.hint}>{t("disposeHint")}</p>
            <DisposeAssetForm assetId={asset.id} version={asset.version} today={today} />
          </Card>
        </section>
      )}
    </div>
  );
}
