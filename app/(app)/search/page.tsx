import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { search, type SearchHit } from "../../../application/queries/search/search";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import fieldStyles from "../../../components/ui/TextField.module.css";
import styles from "./search.module.css";

/**
 * Global search (docs/design/screen-inventory.md §4).
 *
 * **A plain `<form method="get">`, deliberately.** Three things follow from
 * that and none of them are incidental:
 *
 * - It works before hydration, and with JavaScript switched off entirely.
 *   Every other form in this app had to be taught to disable itself until
 *   React takes over (`useHydrated`); a GET form needs no such rescue,
 *   because the browser is the thing that submits it.
 * - The back button and bookmarks behave. A result list is a place, and a
 *   place should have an address.
 * - There is no Server Action, so there is nothing here that could mutate.
 *   A read is a GET.
 *
 * The query does land in the URL, and CLAUDE.md's rule is that sensitive
 * data must never appear in one. A household's own search terms are their
 * own words rather than a record's contents, the address never leaves the
 * household's own machine, and the one place this application writes a URL
 * is the request log — which logs `pathname` and not the query string
 * (docs/security/security-model.md, "Search"). If that ever changes, this
 * form has to become a POST-and-redirect.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { actor, householdId } = await requireActor();
  const [t, tCases, tTasks, tFinance, format] = await Promise.all([
    getTranslations("search"),
    getTranslations("cases"),
    getTranslations("tasks"),
    getTranslations("finance"),
    getFormatter(),
  ]);

  /**
   * The second line of a result, in the reader's language.
   *
   * `resolveRecords` hands back the raw column — a status enum, an ISO
   * date — because it is a data layer and has no business deciding what a
   * person should read. Translating here reuses the very same labels each
   * record's own page shows, so a case that reads "Open" in the cases list
   * does not read "ACTIVE" in the search results.
   */
  const detailOf = (hit: SearchHit): string | null => {
    if (!hit.detail) return null;
    switch (hit.type) {
      case "case":
        return tCases(`status.${hit.detail}`);
      case "task":
        return tTasks(`status.${hit.detail}`);
      case "reimbursement":
        return tFinance(`claimStatus.${hit.detail}`);
      case "expense":
      case "trip":
      case "document":
        // Midday UTC, not midnight: a DATE rendered in a timezone behind
        // UTC would otherwise show the day before. Same trick as calendar.
        return format.dateTime(new Date(`${hit.detail}T12:00:00Z`), { dateStyle: "medium" });
      case "asset":
        // A location the household typed. Nothing to translate.
        return hit.detail;
    }
  };

  const raw = (await searchParams).q;
  // A repeated `?q=a&q=b` arrives as an array. Take the first rather than
  // joining them: a browser never sends one, so this is somebody
  // experimenting, and the safe reading of an ambiguous query is the first
  // answer, not a combined one.
  const query = (Array.isArray(raw) ? raw[0] : raw) ?? "";

  const results = await search(actor, householdId, query);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      <form className={styles.form} method="get" action="/search" role="search">
        <div className={`${fieldStyles.field} ${styles.field}`}>
          <label className={fieldStyles.label} htmlFor="search-q">
            {t("label")}
          </label>
          <input
            id="search-q"
            className={fieldStyles.input}
            type="search"
            name="q"
            defaultValue={results.query}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={t("placeholder")}
          />
        </div>
        <Button type="submit">{t("submit")}</Button>
      </form>

      {results.emptyQuery ? (
        <Card>
          <p className={styles.hint}>{t("hint")}</p>
        </Card>
      ) : results.hits.length === 0 ? (
        <Card>
          {/* The term is echoed back so it is obvious what was searched
              for — as text, never as markup. */}
          <p className={styles.hint}>{t("noResults", { query: results.query })}</p>
        </Card>
      ) : (
        <section aria-labelledby="results-heading" className={styles.results}>
          <h2 id="results-heading" className={styles.resultsHeading}>
            {t("resultCount", { count: results.hits.length })}
          </h2>

          <ul className={styles.list}>
            {results.hits.map((hit) => {
              const detail = detailOf(hit);
              return (
                <li key={`${hit.type}:${hit.id}`}>
                  <Card className={styles.item}>
                    <div className={styles.itemHeader}>
                      <h3 className={styles.itemTitle}>
                        {hit.href ? <Link href={hit.href}>{hit.label}</Link> : hit.label}
                      </h3>
                      {/* The kind is spelled out, not shown only as a
                          colour or a glyph: WCAG 1.4.1, and the difference
                          between a claim and an expense matters. */}
                      <span className={styles.type}>{t(`type.${hit.type}`)}</span>
                    </div>
                    {detail && <p className={styles.meta}>{detail}</p>}
                  </Card>
                </li>
              );
            })}
          </ul>

          {results.truncated && <p className={styles.meta}>{t("truncated")}</p>}
        </section>
      )}
    </div>
  );
}
