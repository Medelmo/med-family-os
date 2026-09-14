"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  submitConnect,
  submitReplaceToken,
  submitRunSync,
  submitToggleIntegration,
  type IntegrationFormState,
} from "./actions";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { SelectField } from "../../../../components/ui/SelectField";
import { TextField } from "../../../../components/ui/TextField";
import { useHydrated } from "../../../../components/ui/useHydrated";
import styles from "./integrations.module.css";

const EMPTY: IntegrationFormState = {};

const ERROR_KEYS = {
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
  keyring_unavailable: "errorKeyringUnavailable",
  disabled: "errorDisabled",
  no_adapter: "errorNoAdapter",
  no_credential: "errorNoCredential",
} as const;

function ErrorLine({ error }: { error?: string }) {
  const t = useTranslations("integrations");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput")}
    </p>
  );
}

export function ConnectForm({ keyringReady }: { keyringReady: boolean }) {
  const t = useTranslations("integrations");
  const [state, formAction, isPending] = useActionState(submitConnect, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("connect")}</h2>

      {/* Said before the form rather than after a failed submit: a
          household cannot fix this from the browser, and offering a form
          that can only fail is its own kind of broken (ADR-019). */}
      {!keyringReady && (
        <p role="status" className={styles.notice}>
          {t("keyringMissing")}
        </p>
      )}

      <form action={formAction} className={styles.form}>
        <SelectField
          label={t("providerLabel")}
          name="provider"
          defaultValue="PAPERLESS"
          options={[
            { value: "PAPERLESS", label: "Paperless-ngx" },
            { value: "NEXTCLOUD", label: "Nextcloud" },
            { value: "CALDAV", label: "CalDAV" },
          ]}
          hint={t("providerHint")}
        />
        <TextField label={t("displayNameLabel")} name="displayName" required autoComplete="off" />
        <TextField
          label={t("baseUrlLabel")}
          name="baseUrl"
          required
          inputMode="url"
          autoComplete="off"
          placeholder="https://paperless.internal"
          hint={t("baseUrlHint")}
        />
        {/* type="password" so it is not shoulder-read, and no autofill:
            this is a machine token, not a login, and a password manager
            offering to save it would be storing it a second time. */}
        <TextField
          label={t("tokenLabel")}
          name="apiToken"
          type="password"
          required
          autoComplete="off"
          hint={t("tokenHint")}
        />
        <ErrorLine error={state.error} />
        <Button type="submit" disabled={isPending || !hydrated || !keyringReady}>
          {t("connect")}
        </Button>
      </form>
    </Card>
  );
}

export function SyncNowForm({ connectionId }: { connectionId: string }) {
  const t = useTranslations("integrations");
  const [state, formAction, isPending] = useActionState(submitRunSync, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {isPending ? t("syncing") : t("syncNow")}
      </Button>
      <ErrorLine error={state.error} />
      {/* The counts come from the persisted run, not an optimistic guess:
          a toast is not proof a side effect completed (CLAUDE.md §8). */}
      {state.synced && (
        <p role="status" className={styles.result}>
          {t("syncResult", { imported: state.synced.imported, skipped: state.synced.skipped })}
        </p>
      )}
    </form>
  );
}

export function ToggleIntegrationForm({
  connectionId,
  version,
  enabled,
}: {
  connectionId: string;
  version: number;
  enabled: boolean;
}) {
  const t = useTranslations("integrations");
  const [state, formAction, isPending] = useActionState(submitToggleIntegration, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="connectionId" value={connectionId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {enabled ? t("disable") : t("enable")}
      </Button>
      <ErrorLine error={state.error} />
    </form>
  );
}

export function ReplaceTokenForm({ connectionId }: { connectionId: string }) {
  const t = useTranslations("integrations");
  const [state, formAction, isPending] = useActionState(submitReplaceToken, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="connectionId" value={connectionId} />
      <TextField
        label={t("newTokenLabel")}
        name="apiToken"
        type="password"
        required
        autoComplete="off"
        hint={t("newTokenHint")}
      />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("replaceToken")}
      </Button>
    </form>
  );
}
