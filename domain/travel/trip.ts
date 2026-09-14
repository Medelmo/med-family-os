import type { Sensitivity, Visibility } from "../shared/types";

export type TripStatus = "PLANNED" | "CONFIRMED" | "CANCELLED" | "ARCHIVED";

export interface Trip {
  id: string;
  householdId: string;
  title: string;
  destination: string | null;
  /** Date-only, "YYYY-MM-DD". A trip spans days, not moments. */
  startsOn: string;
  endsOn: string;
  status: TripStatus;
  notes: string | null;

  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  archivedAt: Date | null;

  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `docs/domain/state-machines.md` says nothing about trips, so this is
 * defined here and recorded in ADR-016. The shape is deliberately small,
 * and the reason is worth stating because it is the same argument the
 * attention engine rests on:
 *
 * **There is no IN_PROGRESS or COMPLETED state.** Whether a trip is
 * upcoming, happening now or over is a fact about today's date and the
 * trip's own dates. Storing it as well would create a second copy of that
 * truth which needs a job to keep current, can disagree with the dates,
 * and is wrong for every household whose instance was switched off over
 * the weekend. `tripPhase()` below computes it instead.
 *
 * What *is* stored is what a date cannot tell you: whether the household
 * has actually committed (CONFIRMED), given up (CANCELLED), or finished
 * with the record (ARCHIVED).
 *
 * CONFIRMED -> PLANNED exists because bookings fall through, and a
 * household that cannot record that would be left either lying or
 * cancelling a trip it is still taking.
 */
const ALLOWED_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  PLANNED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PLANNED", "CANCELLED", "ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export type TripCommand =
  | { type: "CONFIRM" }
  | { type: "UNCONFIRM"; reason?: string | null }
  | { type: "CANCEL"; reason?: string | null }
  | { type: "ARCHIVE" };

export type TripRejection =
  | { code: "ILLEGAL_TRANSITION"; message: string }
  | { code: "TRIP_NOT_OVER"; message: string }
  | { code: "DATES_OUT_OF_ORDER"; message: string };

export interface TripTransition {
  status: TripStatus;
  patch: Partial<Trip>;
  auditAction: string;
  timelineSummary: string;
}

export type TripTransitionResult =
  | { ok: true; transition: TripTransition }
  | { ok: false; rejection: TripRejection };

function targetStatusFor(command: TripCommand): TripStatus {
  switch (command.type) {
    case "CONFIRM":
      return "CONFIRMED";
    case "UNCONFIRM":
      return "PLANNED";
    case "CANCEL":
      return "CANCELLED";
    case "ARCHIVE":
      return "ARCHIVED";
  }
}

/**
 * @param todayIso the household's current date, resolved in its own
 *   timezone by the caller — never inferred here (CLAUDE.md §7).
 */
export function applyTripCommand(trip: Trip, command: TripCommand, now: Date, todayIso: string): TripTransitionResult {
  const target = targetStatusFor(command);

  if (!ALLOWED_TRANSITIONS[trip.status].includes(target)) {
    return {
      ok: false,
      rejection: { code: "ILLEGAL_TRANSITION", message: `A trip cannot go from ${trip.status} to ${target}.` },
    };
  }

  switch (command.type) {
    case "CONFIRM":
      return {
        ok: true,
        transition: {
          status: "CONFIRMED",
          patch: { status: "CONFIRMED", confirmedAt: now },
          auditAction: "trip.confirmed",
          timelineSummary: "Trip confirmed",
        },
      };

    case "UNCONFIRM":
      return {
        ok: true,
        transition: {
          status: "PLANNED",
          patch: { status: "PLANNED", confirmedAt: null },
          auditAction: "trip.unconfirmed",
          timelineSummary: command.reason ? `Back to planning: ${command.reason}` : "Back to planning",
        },
      };

    case "CANCEL":
      return {
        ok: true,
        transition: {
          status: "CANCELLED",
          patch: { status: "CANCELLED", cancelledAt: now, cancelReason: command.reason?.trim() || null },
          auditAction: "trip.cancelled",
          timelineSummary: command.reason ? `Trip cancelled: ${command.reason}` : "Trip cancelled",
        },
      };

    case "ARCHIVE": {
      // Archiving a trip that has not happened yet would take it off every
      // view that exists to prepare for it — which is precisely how a
      // household arrives somewhere without the thing it needed.
      if (trip.status === "CONFIRMED" && trip.endsOn >= todayIso) {
        return {
          ok: false,
          rejection: { code: "TRIP_NOT_OVER", message: "This trip has not happened yet. Cancel it instead." },
        };
      }
      return {
        ok: true,
        transition: {
          status: "ARCHIVED",
          patch: { status: "ARCHIVED", archivedAt: now },
          auditAction: "trip.archived",
          timelineSummary: "Trip archived",
        },
      };
    }
  }
}

export type TripPhase = "UPCOMING" | "CURRENT" | "PAST";

/** Derived from dates, never stored — see the note on ALLOWED_TRANSITIONS. */
export function tripPhase(trip: Pick<Trip, "startsOn" | "endsOn">, todayIso: string): TripPhase {
  if (todayIso < trip.startsOn) return "UPCOMING";
  if (todayIso > trip.endsOn) return "PAST";
  return "CURRENT";
}

export const OPEN_TRIP_STATUSES: readonly TripStatus[] = ["PLANNED", "CONFIRMED"];

export function isTripOpen(status: TripStatus): boolean {
  return OPEN_TRIP_STATUSES.includes(status);
}

export function datesAreOrdered(startsOn: string, endsOn: string): boolean {
  return startsOn <= endsOn;
}

/** Whole days from today until the trip starts; negative once it has begun. */
export function daysUntilStart(startsOn: string, todayIso: string): number {
  const from = Date.parse(`${todayIso}T00:00:00Z`);
  const to = Date.parse(`${startsOn}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}
