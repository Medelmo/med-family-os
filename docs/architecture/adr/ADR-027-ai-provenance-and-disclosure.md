# ADR-027: What a model may be told, and what it may never do

**Status:** Accepted
**Date:** 2026-09-15
**Phase:** 8 (AI / advanced automation)

Implements ADR-005, which said "AI may propose; humans confirm" and left
every mechanism open.

## Context

CLAUDE.md §11 draws the whole pipeline in one line:

> `AI suggestion -> visible provenance -> human review -> explicit
> confirmation -> domain command`

with three hard rules: *AI is optional and cannot be required for core
operation*, *AI cannot directly mutate sensitive records*, and *never send
passwords to AI*. `docs/security/threat-model.md` names **AI overreach**
as its own adversary — "AI receives data outside user authorization" —
and prescribes the mitigation: "retrieve only through policy-filtered
application queries."

The brief adds a blunter rule: *never expose sensitive data in logs,
analytics, exception messages, URLs, notifications, **AI prompts**,
telemetry.*

Phase 8 was gated on authorization, audit and provenance being proven.
The first two now are. This builds the third.

## Decision

### 1. Locality decides what a model may be shown

Read literally, "never expose sensitive data in AI prompts" bans AI from
this application entirely: a household operating system's records are
almost all SENSITIVE by default, so a model that may only see NORMAL data
can summarise nothing worth summarising.

The distinction that rule is actually drawing is **where the data goes**.
Every other channel it lists — logs, analytics, telemetry, URLs — is a
place data *leaves the household*. A model running on the household's own
machine is not one of those places; a hosted API unambiguously is.

So locality is part of the provider interface, not part of its
configuration, and it sets the ceiling:

| Sensitivity | Local model | Remote model |
|---|---|---|
| NORMAL | yes | yes |
| SENSITIVE | yes | **no** |
| HIGHLY_SENSITIVE | **no** | **no** |

`HIGHLY_SENSITIVE` is a floor no provider clears. A household marks
something that way to say "nothing clever touches this", and an
on-premises model is still something clever.

Above the ceiling, **nothing** is described — not the title, not the
status, not that the record exists. An empty context, not a thinner one.
And the refusal is audited, because "the assistant was asked and was told
nothing" is exactly what a household should be able to verify afterwards.

**Locality is never inferred.** "localhost means local" is true until
somebody puts a reverse proxy in front of a hosted API, and a wrong guess
there is a data leak rather than a misconfiguration — so an unset or
unrecognised `ASSISTANT_LOCALITY` disables the assistant entirely rather
than defaulting to the permissive answer.

### 2. Context comes only through policy-filtered queries

`buildCaseContext` reads nothing itself. It calls `getCase` — the same
query the case detail page calls — which refuses a case the actor may not
see and returns only what they may see of it. There is no second path to
the data and therefore no second place for the rule to be got wrong, the
same reasoning that made search build on `resolveRecords` (ADR-022).

Names are left out even when authorized: they add nothing to "what should
happen next" and are the most identifying thing in the record.

### 3. Secret scrubbing, as the second line

The structural defence is that context comes from queries that never
select `integration_credential` or `user`, so a token has no path into a
prompt. `scrubSecrets` exists because "has no path" is a statement about
today's code — a household pastes an API key into a case note, somebody
adds a context source in a hurry.

It replaces rather than deletes: a model handed `[redacted:token]` knows
something was there, where a silent deletion leaves a sentence that reads
as complete and is wrong. What was removed is recorded as provenance; the
values never are.

### 4. Accepting runs the ordinary command

This is the load-bearing decision, and it is why "AI cannot directly
mutate sensitive records" needed no rule about AI at all.

`acceptSuggestion` does not apply the suggestion. It calls
`setCaseNextAction` — the same function the form calls — with the
accepting person as the actor, through the same policy kernel, the same
state machine, the same optimistic-concurrency check and the same audit
trail. If they may not change that case, accepting fails exactly as
typing it would have.

There is no code path from a model's output to a row. There is only a path
from a *person's decision* to a row, and that path already existed.

The `expectedVersion` passed to that command is the version the model was
**shown**, straight from the provenance. So the ordinary concurrency check
is also the staleness check: advice about a case that has changed since is
refused by the mechanism that already stops two people overwriting each
other, rather than by something invented for AI.

### 5. Provenance is visible, not discoverable

Recorded per suggestion and rendered next to the sentence it produced:
which model, whether it ran inside the house or outside it, which prompt
version, when, what was withheld and what was scrubbed.

Not a tooltip and not a details pane. The reader is about to decide
whether to act on it, and those facts are what the decision is made of.
Locality in particular is a chip in its own right — it is the one fact
that says whether anything left the house.

Rejected suggestions are kept. What a household *declined* is part of the
trail too, and a model that keeps proposing something they keep refusing
is a fact somebody should be able to see.

### 6. Unconfigured means absent

No `ASSISTANT_BASE_URL` and the AI surfaces do not render — no disabled
button, no explanation, nothing. That is the difference between
implementing "AI is optional" and claiming it, and it is asserted by an
E2E test that also proves every ordinary thing on the page still works.

Configuration lives in the environment rather than a database row, like
the Home Assistant token and the credential keyring: an assistant is a
deployment fact for a self-hosted application.

### 7. One adapter, for the protocol rather than the product

`openAiCompatible.ts` speaks the OpenAI chat-completions shape, which
means one file serves Ollama, llama.cpp, LM Studio, vLLM and LocalAI —
every way a household is realistically going to run a model on their own
hardware.

## Consequences

- **Running it against a real Ollama found two things no stub would
  have.** A reasoning model (qwen3) spent its entire token budget on a
  thinking trace and returned an empty `content` with
  `finish_reason: "length"` — reported now as `unusable` rather than
  `malformed`, because the remedy is a bigger budget rather than a
  suspect server, and the budget was raised from 60 to 512. And a cold
  7B model on CPU took 62 seconds, past a 45-second timeout, so the
  timeout is 120s and configurable.
- The token budget governs the model's *process*; the output guard
  governs what is kept. A model that thinks for four hundred tokens and
  then writes a paragraph is still refused.
- A reply that ignored the format is discarded rather than cleaned up: it
  cannot be trusted to have followed the *other* instructions either,
  including the one about not inventing reference numbers.
- `CaseListItem` gained `sensitivity`, because the disclosure gate has to
  make a decision about it rather than merely be filtered by it.

## Alternatives considered

- **Letting AI write directly, with a rule forbidding sensitive records.**
  Rejected: a rule is a thing that can be forgotten in a new code path.
  Having no write path at all cannot be.
- **A cloud provider by default.** Rejected outright. The default posture
  of a self-hosted household application cannot be "send the family's
  medical admin to a third party", and making remote *possible but
  restricted to NORMAL* is the honest middle.
- **A chat interface.** Rejected: every capability here is "given this
  context, produce this one thing", and a chat box invites the assistant
  to become a place people type rather than a thing that proposes — which
  is a different product with a different threat model.
- **Storing the prompt text with each suggestion.** Rejected for now: the
  prompt is reconstructible from `promptVersion` and the sources, and
  storing the assembled context would mean keeping a second copy of
  household data in a table that has no sensitivity of its own.
