/**
 * The things a trip needs doing about it.
 *
 * One aggregate with a `kind`, not three tables. An itinerary entry, a
 * packing line and an accessibility requirement all answer the same
 * question — "is this trip ready?" — and all carry the same shape: a
 * title, who it concerns, and whether it is settled. Splitting them would
 * mean three queries, three authorization paths and three chances for the
 * readiness count to disagree with itself.
 *
 * What differs between them is which fields carry meaning, and that is
 * documented on each field rather than enforced by a separate table.
 */
export const TRIP_ITEM_KINDS = ["ITINERARY", "PACKING", "ACCESSIBILITY"] as const;
export type TripItemKind = (typeof TRIP_ITEM_KINDS)[number];

export function isTripItemKind(value: string): value is TripItemKind {
  return (TRIP_ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * Where an accessibility requirement has got to.
 *
 * `CONFIRMED` and `REFUSED` both count as answered: a household that knows
 * the hotel has no lift can act on that, and treating it as an open
 * question would nag them about something they have already settled.
 * Being told "no" is information, not an unfinished task.
 */
export const VERIFICATION_STATUSES = ["UNVERIFIED", "CONFIRMED", "REFUSED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface TripItem {
  id: string;
  tripId: string;
  householdId: string;
  kind: TripItemKind;
  title: string;
  /** ITINERARY: the day it happens. Null for packing and requirements. */
  onDate: string | null;
  /** Who it is for — a medicine or a wheelchair belongs to someone. */
  personId: string | null;
  /** PACKING and ITINERARY: settled or not. Meaningless for ACCESSIBILITY. */
  done: boolean;
  /** ACCESSIBILITY only. */
  verification: VerificationStatus;
  /** ACCESSIBILITY: who said so — "phoned the hotel, spoke to Frau Müller". */
  verificationSource: string | null;
  /** ACCESSIBILITY: when they said it, so a stale answer is visible as stale. */
  verifiedOn: string | null;
  notes: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export type TripItemRejection =
  | { code: "TITLE_REQUIRED"; message: string }
  | { code: "SOURCE_REQUIRED"; message: string }
  | { code: "NOT_AN_ACCESSIBILITY_ITEM"; message: string }
  | { code: "DATE_OUTSIDE_TRIP"; message: string };

export type TripItemResult<T> = { ok: true; value: T } | { ok: false; rejection: TripItemRejection };

export interface NewTripItem {
  kind: TripItemKind;
  title: string;
  onDate?: string | null;
  personId?: string | null;
  notes?: string | null;
}

/**
 * Validates a new item against the trip it is being added to.
 *
 * An itinerary entry outside the trip's own dates is almost always a typo,
 * and one that silently lands a day early is exactly the kind of error a
 * household discovers at an airport.
 */
export function validateNewTripItem(
  input: NewTripItem,
  trip: { startsOn: string; endsOn: string }
): TripItemResult<Required<Pick<NewTripItem, "kind" | "title">> & NewTripItem> {
  const title = input.title.trim();
  if (!title) return { ok: false, rejection: { code: "TITLE_REQUIRED", message: "Give the item a name." } };

  const onDate = input.kind === "ITINERARY" ? (input.onDate?.trim() || null) : null;
  if (onDate && (onDate < trip.startsOn || onDate > trip.endsOn)) {
    return {
      ok: false,
      rejection: {
        code: "DATE_OUTSIDE_TRIP",
        message: `That day is outside the trip (${trip.startsOn} to ${trip.endsOn}).`,
      },
    };
  }

  return { ok: true, value: { ...input, title, onDate } };
}

export interface VerificationCommand {
  status: Exclude<VerificationStatus, "UNVERIFIED">;
  source: string;
  /** The day the answer was given — not necessarily today. */
  verifiedOn: string;
}

/**
 * Records an answer to an accessibility question.
 *
 * A source is required, and that is the point of the whole feature: "the
 * hotel is step-free" is worth nothing without who said so and when,
 * because the household has to be able to weigh it, re-check it, or hold
 * someone to it on arrival.
 */
export function applyVerification(
  item: Pick<TripItem, "kind">,
  command: VerificationCommand
): TripItemResult<Partial<TripItem>> {
  if (item.kind !== "ACCESSIBILITY") {
    return {
      ok: false,
      rejection: { code: "NOT_AN_ACCESSIBILITY_ITEM", message: "Only an access requirement can be verified." },
    };
  }

  const source = command.source.trim();
  if (!source) {
    return {
      ok: false,
      rejection: { code: "SOURCE_REQUIRED", message: "Say who confirmed it, and how." },
    };
  }

  return {
    ok: true,
    value: {
      verification: command.status,
      verificationSource: source,
      verifiedOn: command.verifiedOn,
    },
  };
}

export interface TripReadiness {
  /** Packing and itinerary entries not yet ticked off. */
  outstanding: number;
  /** Access requirements nobody has an answer for yet. */
  unverified: number;
  /** Requirements that were answered with "no" — not outstanding, but worth seeing. */
  refused: number;
  total: number;
}

/**
 * How ready a trip is, counted from its items.
 *
 * Computed, never stored, for the same reason attention is: a stored
 * counter has to be maintained by every write path and is wrong the first
 * time one forgets.
 */
export function tripReadiness(items: readonly Pick<TripItem, "kind" | "done" | "verification">[]): TripReadiness {
  let outstanding = 0;
  let unverified = 0;
  let refused = 0;

  for (const item of items) {
    if (item.kind === "ACCESSIBILITY") {
      if (item.verification === "UNVERIFIED") unverified += 1;
      else if (item.verification === "REFUSED") refused += 1;
    } else if (!item.done) {
      outstanding += 1;
    }
  }

  return { outstanding, unverified, refused, total: items.length };
}
