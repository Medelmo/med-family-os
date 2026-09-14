"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  submitAddTripItem,
  submitCreateTrip,
  submitToggleTripItem,
  submitTripTransition,
  submitVerifyTripItem,
  type TripFormState,
} from "./actions";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { SelectField, type SelectOption } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { useHydrated } from "../../../components/ui/useHydrated";
import styles from "./trips.module.css";

const EMPTY: TripFormState = {};

const ERROR_KEYS = {
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
  illegal_transition: "errorIllegalTransition",
  dates_out_of_order: "errorDatesOutOfOrder",
  date_outside_trip: "errorDateOutsideTrip",
  trip_not_over: "errorTripNotOver",
  title_required: "errorTitleRequired",
  source_required: "errorSourceRequired",
  wrong_item_kind: "errorWrongItemKind",
} as const;

function ErrorLine({ error }: { error?: string }) {
  const t = useTranslations("trips");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput")}
    </p>
  );
}

export function PlanTripForm({ today, people }: { today: string; people: { id: string; name: string }[] }) {
  const t = useTranslations("trips");
  const [state, formAction, isPending] = useActionState(submitCreateTrip, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("planTrip")}</h2>
      <form action={formAction} className={styles.form}>
        <TextField label={t("titleLabel")} name="title" required autoComplete="off" />
        <TextField label={t("destinationLabel")} name="destination" autoComplete="off" />
        <TextField label={t("startsOnLabel")} name="startsOn" type="date" required defaultValue={today} />
        <TextField label={t("endsOnLabel")} name="endsOn" type="date" required defaultValue={today} />

        {people.length > 0 && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t("whoIsGoing")}</legend>
            {/* Naming who is going is not decoration: a child sees a trip
                because they are on it (application/policies/travel.ts). */}
            <p className={styles.hint}>{t("whoIsGoingHint")}</p>
            {people.map((person) => (
              <label key={person.id} className={styles.checkboxRow}>
                <input type="checkbox" name="participantPersonIds" value={person.id} />
                <span>{person.name}</span>
              </label>
            ))}
          </fieldset>
        )}

        <ErrorLine error={state.error} />
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("planTrip")}
        </Button>
      </form>
    </Card>
  );
}

export function TripActionForm({
  tripId,
  version,
  action,
  label,
  withReason = false,
}: {
  tripId: string;
  version: number;
  action: string;
  label: string;
  withReason?: boolean;
}) {
  const t = useTranslations("trips");
  const [state, formAction, isPending] = useActionState(submitTripTransition, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.actionForm}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="action" value={action} />
      {withReason && <TextField label={t("reasonLabel")} name="reason" autoComplete="off" />}
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant={action === "confirm" ? "primary" : "secondary"}>
        {label}
      </Button>
    </form>
  );
}

export function AddTripItemForm({
  tripId,
  kind,
  heading,
  withDate,
  people,
}: {
  tripId: string;
  kind: string;
  heading: string;
  withDate: boolean;
  people: { id: string; name: string }[];
}) {
  const t = useTranslations("trips");
  const [state, formAction, isPending] = useActionState(submitAddTripItem, EMPTY);
  const hydrated = useHydrated();

  const peopleOptions: SelectOption[] = [
    { value: "", label: t("forEveryone") },
    ...people.map((person) => ({ value: person.id, label: person.name })),
  ];

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="kind" value={kind} />
      <TextField label={heading} name="title" required autoComplete="off" />
      {withDate && <TextField label={t("onDateLabel")} name="onDate" type="date" />}
      {people.length > 0 && (
        <SelectField label={t("forWhomLabel")} name="personId" options={peopleOptions} defaultValue="" />
      )}
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("addItem")}
      </Button>
    </form>
  );
}

/**
 * A checkbox that is a form.
 *
 * Not a live checkbox with an onChange: the state lives on the server, and
 * a box that ticks itself optimistically and then silently fails to save
 * is worse on a packing list than one that takes a moment — the whole
 * value of the list is that it is right.
 */
export function ToggleItemForm({
  tripId,
  itemId,
  version,
  done,
  label,
}: {
  tripId: string;
  itemId: string;
  version: number;
  done: boolean;
  label: string;
}) {
  const t = useTranslations("trips");
  const [state, formAction, isPending] = useActionState(submitToggleTripItem, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.toggleForm}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {done ? t("markNotDone", { title: label }) : t("markDone", { title: label })}
      </Button>
    </form>
  );
}

export function VerifyItemForm({
  tripId,
  itemId,
  version,
  today,
}: {
  tripId: string;
  itemId: string;
  version: number;
  today: string;
}) {
  const t = useTranslations("trips");
  const [state, formAction, isPending] = useActionState(submitVerifyTripItem, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.verifyForm}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="expectedVersion" value={version} />
      {/* The source is the feature: "step-free" is worth nothing without
          who said so and when. */}
      <TextField label={t("sourceLabel")} name="source" required autoComplete="off" hint={t("sourceHint")} />
      <TextField label={t("verifiedOnLabel")} name="verifiedOn" type="date" required defaultValue={today} />
      <SelectField
        label={t("answerLabel")}
        name="status"
        options={[
          { value: "CONFIRMED", label: t("answerConfirmed") },
          { value: "REFUSED", label: t("answerRefused") },
        ]}
        defaultValue="CONFIRMED"
      />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("recordAnswer")}
      </Button>
    </form>
  );
}
