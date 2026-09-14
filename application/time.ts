/**
 * Resolves the household's current date in its own IANA timezone.
 *
 * CLAUDE.md §7: "Never infer a timezone from the browser for stored domain
 * meaning." Today and Attention both hinge on what "today" is, so that
 * answer comes from the household's configured timezone
 * (`household.timezone`), not from the server's locale or the viewer's
 * device.
 *
 * Uses Intl rather than a date library: the "en-CA" locale formats as
 * YYYY-MM-DD, which is exactly the date-only representation
 * domain/attention/rules.ts compares against, so this needs no dependency.
 */
export function householdToday(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown timezone string must not take down Today/Attention.
    // Falling back to UTC keeps the projection working and merely
    // off-by-at-most-a-day, which is far better than an error page.
    return now.toISOString().slice(0, 10);
  }
}
