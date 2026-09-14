import { customType } from "drizzle-orm/pg-core";

/**
 * PostgreSQL's `tsvector`, for the generated search columns.
 *
 * Drizzle has no builder for it, and it is never read into JavaScript —
 * it exists only to be matched against and ranked. Declaring it here is
 * what lets the schema own the column and the index rather than leaving
 * them to a hand-written migration nothing else knows about.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * The text-search configuration every searchable column uses.
 *
 * `simple` means no stemming and no stop-word list: it lowercases and
 * splits on word boundaries, and that is all.
 *
 * The obvious alternative is a language configuration — `german` would
 * match "Bescheide" when the household typed "Bescheid". But CLAUDE.md
 * §14 makes this a German *and* English household from the start, a
 * generated column must name one configuration, and choosing either would
 * silently degrade the other: `german` stems English badly, `english`
 * stems German not at all. A household that searched for one of its own
 * languages and got worse results than the other would have no way to
 * know why.
 *
 * `simple` is worse than a correct stemmer and better than the wrong one
 * for half the content. Revisit when the app can store per-record
 * language, which is a bigger change than this note.
 *
 * It must also be a constant, not a runtime setting: a generated column's
 * expression has to be immutable, and `to_tsvector(text)` — the one-
 * argument form that reads `default_text_search_config` — is not.
 */
export const SEARCH_CONFIG = "simple";
