"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  submitAddMaintenance,
  submitAddWarranty,
  submitCreateAsset,
  submitDisposeAsset,
  type AssetFormState,
} from "./actions";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { SelectField, type SelectOption } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { useHydrated } from "../../../components/ui/useHydrated";
import styles from "./assets.module.css";

const EMPTY: AssetFormState = {};

const ERROR_KEYS = {
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
  amount_invalid: "errorAmountInvalid",
  provider_required: "errorProviderRequired",
  warranty_dates_out_of_order: "errorWarrantyDates",
  maintenance_in_future: "errorMaintenanceInFuture",
  next_due_before_performed: "errorNextDueBeforePerformed",
  already_disposed: "errorAlreadyDisposed",
} as const;

function ErrorLine({ error }: { error?: string }) {
  const t = useTranslations("assets");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput")}
    </p>
  );
}

export function AddAssetForm({
  categories,
  people,
}: {
  categories: SelectOption[];
  people: { id: string; name: string }[];
}) {
  const t = useTranslations("assets");
  const [state, formAction, isPending] = useActionState(submitCreateAsset, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("addAsset")}</h2>
      <form action={formAction} className={styles.form}>
        <TextField label={t("nameLabel")} name="name" required autoComplete="off" />
        {/* The category is not just a label: medical and mobility items are
            raised to SENSITIVE automatically (ADR-017). */}
        <SelectField
          label={t("categoryLabel")}
          name="category"
          options={categories}
          defaultValue="OTHER"
          hint={t("categoryHint")}
        />
        <TextField label={t("locationLabel")} name="location" autoComplete="off" />
        <TextField label={t("manufacturerLabel")} name="manufacturer" autoComplete="off" />
        <TextField label={t("identifierLabel")} name="identifier" autoComplete="off" hint={t("identifierHint")} />
        <TextField label={t("purchasedOnLabel")} name="purchasedOn" type="date" />
        <TextField label={t("purchasePriceLabel")} name="purchasePrice" inputMode="decimal" autoComplete="off" />
        {people.length > 0 && (
          <SelectField
            label={t("belongsToLabel")}
            name="personId"
            options={[{ value: "", label: t("belongsToHousehold") }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            defaultValue=""
          />
        )}
        <ErrorLine error={state.error} />
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("addAsset")}
        </Button>
      </form>
    </Card>
  );
}

export function AddWarrantyForm({ assetId, today }: { assetId: string; today: string }) {
  const t = useTranslations("assets");
  const [state, formAction, isPending] = useActionState(submitAddWarranty, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="assetId" value={assetId} />
      <TextField label={t("providerLabel")} name="provider" required autoComplete="off" />
      <TextField label={t("coverFromLabel")} name="startsOn" type="date" required defaultValue={today} />
      <TextField label={t("coverToLabel")} name="endsOn" type="date" required defaultValue={today} />
      {/* Cover nobody can invoke is not cover. */}
      <TextField label={t("referenceLabel")} name="reference" autoComplete="off" hint={t("referenceHint")} />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("addWarranty")}
      </Button>
    </form>
  );
}

export function AddMaintenanceForm({ assetId, today }: { assetId: string; today: string }) {
  const t = useTranslations("assets");
  const [state, formAction, isPending] = useActionState(submitAddMaintenance, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="assetId" value={assetId} />
      <TextField label={t("serviceSummaryLabel")} name="summary" required autoComplete="off" />
      {/* Bounded to today: a service record is something that happened. */}
      <TextField label={t("performedOnLabel")} name="performedOn" type="date" required defaultValue={today} max={today} />
      <TextField label={t("performedByLabel")} name="performedBy" autoComplete="off" />
      <TextField label={t("costLabel")} name="cost" inputMode="decimal" autoComplete="off" />
      <TextField label={t("nextDueLabel")} name="nextDueOn" type="date" hint={t("nextDueHint")} />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("addService")}
      </Button>
    </form>
  );
}

export function DisposeAssetForm({
  assetId,
  version,
  today,
}: {
  assetId: string;
  version: number;
  today: string;
}) {
  const t = useTranslations("assets");
  const [state, formAction, isPending] = useActionState(submitDisposeAsset, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="assetId" value={assetId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <TextField label={t("disposedOnLabel")} name="disposedOn" type="date" required defaultValue={today} />
      <TextField label={t("disposalNoteLabel")} name="note" autoComplete="off" hint={t("disposalNoteHint")} />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("dispose")}
      </Button>
    </form>
  );
}
