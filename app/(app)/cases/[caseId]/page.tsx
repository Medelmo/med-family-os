import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { getCase } from "../../../../application/queries/cases/getCases";
import { AuthorizationError, NotFoundError } from "../../../../application/errors";
import { getLinksFor } from "../../../../application/commands/links/linkRecords";
import { getLinkCandidates } from "../../../../application/links/linkCandidates";
import { AddNoteForm, CaseActions, NextActionForm, type CaseStatusName } from "./CaseDetailClient";
import { AskAssistantForm, SuggestionCard, type SuggestionView } from "./AssistantClient";
import {
  assistantAvailable,
  getOpenSuggestions,
} from "../../../../application/commands/ai/suggestCaseActions";
import { LinkRecordForm, UnlinkForm } from "./LinksClient";
import { Card } from "../../../../components/ui/Card";
import styles from "./caseDetail.module.css";

export default async function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("cases");
  const tAssistant = await getTranslations("assistant");
  const format = await getFormatter();

  let detail;
  try {
    detail = await getCase(actor, householdId, caseId);
  } catch (error) {
    // A case the actor may not see is indistinguishable from one that
    // isn't there, as far as this page is concerned — both render the
    // not-found page rather than leaking which it was.
    if (error instanceof NotFoundError || error instanceof AuthorizationError) notFound();
    throw error;
  }

  const tLinks = await getTranslations("links");
  const [links, candidates, openSuggestions] = await Promise.all([
    getLinksFor(actor, householdId, { type: "case", id: caseId }),
    getLinkCandidates(actor, householdId),
    getOpenSuggestions(actor, householdId, caseId),
  ]);

  const assistant = assistantAvailable();

  // Flattened for the client component: a Server Component may not hand a
  // Date across the boundary inside an arbitrary object, and the shape a
  // card needs is narrower than the row anyway.
  const suggestions: SuggestionView[] = openSuggestions.map((suggestion) => ({
    id: suggestion.id,
    nextAction: String((suggestion.payload as { nextAction?: unknown }).nextAction ?? ""),
    model: suggestion.provenance.model,
    locality: suggestion.provenance.locality,
    promptVersion: suggestion.provenance.promptVersion,
    generatedAt: new Date(suggestion.provenance.generatedAt).toISOString(),
    withheld: suggestion.provenance.withheld ?? [],
    redacted: suggestion.provenance.redacted ?? [],
  }));

  return (
    <div className={styles.page}>
      <nav aria-label={t("title")}>
        <Link href="/cases" className={styles.backLink}>
          {t("backToCases")}
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>{detail.title}</h1>
        <span className={styles.status} data-status={detail.status}>
          {t(`status.${detail.status}`)}
        </span>
      </header>

      {detail.description && <p className={styles.description}>{detail.description}</p>}

      <Card>
        <h2 className={styles.sectionTitle}>{t("nextActionTitle")}</h2>
        <NextActionForm caseId={detail.id} version={detail.version} nextAction={detail.nextAction} />

        {/*
          The assistant, and only when there is one.
          CLAUDE.md §11: "AI is optional and cannot be required for core
          operation" — so an unconfigured deployment shows nothing here at
          all, rather than a disabled control advertising a feature the
          household has not chosen to run.
        */}
        {assistant && (
          <section aria-labelledby="assistant-heading" className={styles.assistantBlock}>
            <h3 id="assistant-heading" className={styles.sectionTitle}>
              {tAssistant("title")}
            </h3>
            <p className={styles.description}>{tAssistant("intro")}</p>

            {suggestions.map((suggestion) => (
              <SuggestionCard key={suggestion.id} caseId={detail.id} suggestion={suggestion} />
            ))}

            <AskAssistantForm caseId={detail.id} />
          </section>
        )}

        <dl className={styles.meta}>
          {detail.status === "WAITING" && detail.waitingFor && (
            <>
              <div className={styles.metaRow}>
                <dt>{t("waitingForLabel")}</dt>
                <dd>{detail.waitingFor}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt>{t("followUpLabel")}</dt>
                <dd>
                  {detail.followUpAt
                    ? format.dateTime(detail.followUpAt, { dateStyle: "medium" })
                    : (detail.waitingNoFollowUpReason ?? "—")}
                </dd>
              </div>
            </>
          )}
          {detail.status === "BLOCKED" && detail.blockedReason && (
            <div className={styles.metaRow}>
              <dt>{t("blockedReasonLabel")}</dt>
              <dd>{detail.blockedReason}</dd>
            </div>
          )}
          {detail.externalReference && (
            <div className={styles.metaRow}>
              <dt>{t("externalReferenceLabel")}</dt>
              <dd>{detail.externalReference}</dd>
            </div>
          )}
          {detail.people.length > 0 && (
            <div className={styles.metaRow}>
              <dt>{t("peopleLabel")}</dt>
              <dd>{detail.people.map((p) => p.displayName).join(", ")}</dd>
            </div>
          )}
        </dl>
      </Card>

      <CaseActions caseId={detail.id} status={detail.status as CaseStatusName} version={detail.version} />

      <Card>
        <h2 className={styles.sectionTitle}>{t("linkedTasks")}</h2>
        {detail.tasks.length === 0 ? (
          <p className={styles.metaText}>{t("noLinkedTasks")}</p>
        ) : (
          <ul className={styles.taskList}>
            {detail.tasks.map((task) => (
              <li key={task.id} className={styles.taskRow}>
                <span>{task.title}</span>
                <span className={styles.metaText}>{task.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* What else this case is about. A link is shown only when its far
          end is readable by this actor — see resolveRecords — so a case
          can carry a link to something the reader is not told exists. */}
      <Card>
        <h2 className={styles.sectionTitle}>{tLinks("related")}</h2>

        {links.length === 0 ? (
          <p className={styles.metaText}>{tLinks("noneYet")}</p>
        ) : (
          <ul className={styles.linkList}>
            {links.map((link) => (
              <li key={link.linkId} className={styles.linkItem}>
                <span className={styles.linkLabel}>
                  <span className={styles.linkType}>{tLinks(`type.${link.type}`)}</span>{" "}
                  {link.href ? <Link href={link.href}>{link.label}</Link> : link.label}
                  {link.note && <span className={styles.metaText}> · {link.note}</span>}
                </span>
                <UnlinkForm caseId={detail.id} linkId={link.linkId} label={link.label} />
              </li>
            ))}
          </ul>
        )}

        <LinkRecordForm
          caseId={detail.id}
          options={candidates.map((candidate) => ({
            value: `${candidate.type}:${candidate.id}`,
            label: `${tLinks(`type.${candidate.type}`)} · ${candidate.label}`,
          }))}
        />
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>{t("timelineTitle")}</h2>
        <AddNoteForm caseId={detail.id} />
        {/* Newest first: the question a timeline answers most often is
            "what happened last", not "how did this begin". */}
        <ol className={styles.timeline}>
          {detail.timeline.map((entry) => (
            <li key={entry.id} className={styles.timelineItem}>
              <span className={styles.timelineType}>{entry.type}</span>
              <p className={styles.timelineSummary}>{entry.summary}</p>
              <time dateTime={entry.createdAt.toISOString()} className={styles.metaText}>
                {format.dateTime(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
