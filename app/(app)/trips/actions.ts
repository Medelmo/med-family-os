"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import {
  addTripItem,
  createTrip,
  setTripItemDone,
  transitionTrip,
  verifyTripItem,
  TripRuleError,
} from "../../../application/commands/travel/tripCommands";
import { AuthorizationError, ConflictError, NotFoundError } from "../../../application/errors";
import type { TripCommand } from "../../../domain/travel/trip";

export interface TripFormState {
  error?: string;
}

/** See app/(app)/finance/actions.ts for why the code, not the message, crosses this boundary. */
function toErrorCode(error: unknown): string {
  if (error instanceof TripRuleError) {
    switch (error.code) {
      case "DATES_OUT_OF_ORDER":
        return "dates_out_of_order";
      case "DATE_OUTSIDE_TRIP":
        return "date_outside_trip";
      case "TRIP_NOT_OVER":
        return "trip_not_over";
      case "TITLE_REQUIRED":
        return "title_required";
      case "SOURCE_REQUIRED":
        return "source_required";
      case "NOT_A_CHECKLIST_ITEM":
      case "NOT_AN_ACCESSIBILITY_ITEM":
        return "wrong_item_kind";
      default:
        return "illegal_transition";
    }
  }
  if (error instanceof AuthorizationError) return "not_authorized";
  if (error instanceof ConflictError || error instanceof NotFoundError) return "conflict";
  if (error instanceof ZodError) return "invalid_input";
  throw error;
}

function revalidateTrip(tripId?: string) {
  revalidatePath("/trips");
  revalidatePath("/attention");
  if (tripId) revalidatePath(`/trips/${tripId}`);
}

export async function submitCreateTrip(_prev: TripFormState, formData: FormData): Promise<TripFormState> {
  const { actor, householdId } = await requireActor();

  try {
    await createTrip(actor, householdId, {
      title: String(formData.get("title") ?? ""),
      destination: String(formData.get("destination") ?? "").trim() || null,
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? ""),
      // getAll: a trip usually has more than one person on it, and taking
      // only the first would quietly leave a child off their own holiday.
      participantPersonIds: formData.getAll("participantPersonIds").map(String).filter(Boolean),
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateTrip();
  return {};
}

export async function submitTripTransition(_prev: TripFormState, formData: FormData): Promise<TripFormState> {
  const { actor, householdId } = await requireActor();

  const tripId = String(formData.get("tripId") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);
  const action = String(formData.get("action") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;

  let command: TripCommand;
  switch (action) {
    case "confirm":
      command = { type: "CONFIRM" };
      break;
    case "unconfirm":
      command = { type: "UNCONFIRM", reason };
      break;
    case "cancel":
      command = { type: "CANCEL", reason };
      break;
    case "archive":
      command = { type: "ARCHIVE" };
      break;
    default:
      return { error: "invalid_input" };
  }

  try {
    await transitionTrip(actor, householdId, tripId, expectedVersion, command);
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateTrip(tripId);
  return {};
}

export async function submitAddTripItem(_prev: TripFormState, formData: FormData): Promise<TripFormState> {
  const { actor, householdId } = await requireActor();
  const tripId = String(formData.get("tripId") ?? "");

  try {
    await addTripItem(actor, householdId, tripId, {
      kind: String(formData.get("kind") ?? "PACKING") as never,
      title: String(formData.get("title") ?? ""),
      onDate: String(formData.get("onDate") ?? "").trim() || null,
      personId: String(formData.get("personId") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateTrip(tripId);
  return {};
}

export async function submitToggleTripItem(_prev: TripFormState, formData: FormData): Promise<TripFormState> {
  const { actor, householdId } = await requireActor();
  const tripId = String(formData.get("tripId") ?? "");

  try {
    await setTripItemDone(
      actor,
      householdId,
      String(formData.get("itemId") ?? ""),
      Number(formData.get("expectedVersion") ?? 0),
      String(formData.get("done") ?? "") === "true"
    );
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateTrip(tripId);
  return {};
}

export async function submitVerifyTripItem(_prev: TripFormState, formData: FormData): Promise<TripFormState> {
  const { actor, householdId } = await requireActor();
  const tripId = String(formData.get("tripId") ?? "");

  try {
    await verifyTripItem(
      actor,
      householdId,
      String(formData.get("itemId") ?? ""),
      Number(formData.get("expectedVersion") ?? 0),
      {
        status: String(formData.get("status") ?? "CONFIRMED") as never,
        source: String(formData.get("source") ?? ""),
        verifiedOn: String(formData.get("verifiedOn") ?? ""),
      }
    );
  } catch (error) {
    return { error: toErrorCode(error) };
  }

  revalidateTrip(tripId);
  return {};
}
