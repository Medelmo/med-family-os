import { getCase } from "../queries/cases/getCases";
import {
  mayDisclose,
  scrubSecrets,
  summariseWithheld,
  type ProviderLocality,
  type Withheld,
} from "../../domain/ai/disclosure";
import type { SuggestionSource } from "../../domain/ai/suggestion";
import type { Actor } from "../policies/authorize";

/**
 * Everything a model is allowed to know about one case (ADR-027).
 *
 * `docs/security/threat-model.md` names the adversary this exists to stop
 * — *"AI overreach: AI receives data outside user authorization"* — and
 * gives the mitigation in one line: *"retrieve only through policy-filtered
 * application queries."*
 *
 * So this function reads nothing itself. It calls `getCase`, the same
 * query the case detail page calls, which throws if the actor may not see
 * the case and returns only what they may see of it. There is no second
 * path to the data and therefore no second place for the rule to be got
 * wrong — the same reasoning that made search build on `resolveRecords`
 * (ADR-022).
 *
 * Two gates then apply on top of authorization, and both are about the
 * model rather than the person:
 *
 * 1. **Sensitivity against provider locality.** A hosted model may see
 *    nothing above NORMAL; a model inside the house may see SENSITIVE;
 *    nothing sees HIGHLY_SENSITIVE (`domain/ai/disclosure.ts`).
 * 2. **Secret scrubbing**, as a second line behind the structural one.
 */

export interface CaseContext {
  /** The prompt body, already filtered and scrubbed. */
  text: string;
  /** What the model was shown, with versions, for provenance and staleness. */
  sources: SuggestionSource[];
  withheld: Withheld[];
  redacted: string[];
  /** False when nothing survived the gates — there is nothing to ask about. */
  usable: boolean;
}

export async function buildCaseContext(
  actor: Actor,
  householdId: string,
  caseId: string,
  locality: ProviderLocality
): Promise<CaseContext> {
  // Authorization happens here, inside the ordinary query, and throws.
  const detail = await getCase(actor, householdId, caseId);

  const withheld = summariseWithheld([{ sensitivity: detail.sensitivity }], locality);

  if (!mayDisclose(detail.sensitivity, locality)) {
    // The case itself is above the ceiling. Nothing about it may be
    // described — not its title, not how many tasks it has, not that it
    // exists. An empty context rather than a thinner one.
    return { text: "", sources: [], withheld, redacted: [], usable: false };
  }

  const lines: string[] = [];

  lines.push(`Case: ${detail.title}`);
  lines.push(`Status: ${detail.status}`);
  if (detail.description) lines.push(`Description: ${detail.description}`);
  if (detail.nextAction) lines.push(`Current next action: ${detail.nextAction}`);
  if (detail.waitingFor) lines.push(`Waiting for: ${detail.waitingFor}`);

  if (detail.tasks.length > 0) {
    lines.push("");
    lines.push("Tasks already on this case:");
    for (const task of detail.tasks) lines.push(`- [${task.status}] ${task.title}`);
  }

  if (detail.timeline.length > 0) {
    lines.push("");
    lines.push("What has happened, oldest first:");
    // Oldest first: a model reading a timeline backwards routinely
    // proposes the step that has just been taken.
    for (const entry of [...detail.timeline].reverse()) {
      lines.push(`- ${entry.createdAt.toISOString().slice(0, 10)} ${entry.type}: ${entry.summary}`);
    }
  }

  // Deliberately absent: the people the case is about. Their names add
  // nothing to "what should happen next" and are the most identifying
  // thing in the record — so they are not sent, and the suggestion comes
  // back in terms of the case rather than in terms of a child.
  const scrubbed = scrubSecrets(lines.join("\n"));

  return {
    text: scrubbed.text,
    sources: [{ type: "case", id: detail.id, version: detail.version }],
    withheld,
    redacted: scrubbed.removed,
    usable: true,
  };
}
