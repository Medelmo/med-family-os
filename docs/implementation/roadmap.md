# Implementation Roadmap

## Phase 0
Architecture package only.

Exit criteria:
- no unresolved critical architecture contradiction
- domain/state model accepted
- permission model testable
- deployment plan verified against host
- design spec stable

## Phase 1
Foundation.

## Phase 2
Attention engine.

## Phase 3
Cases/context.

## Phase 4
Calendar/family.

## Phase 5
Finance.

## Phase 6
Travel/assets.

## Phase 7
Integrations.

## Phase 8
AI/automation. **Built** — see ADR-027.

Delivered: a suggestion pipeline that proposes a next action for a case,
with visible provenance, human confirmation, and no path from a model's
output to a household record. One adapter for any OpenAI-compatible
server, so Ollama and friends work unchanged. Disclosure is bounded by
where the model runs, and the application shows nothing at all when no
assistant is configured.

Not built, and deliberately: document summarisation, structured-data
extraction, and answering free questions over the household's records.
Each is a larger disclosure surface than a single case, and the one
capability built first is the one the attention engine already says is
missing — a case with no next action.

Every phase ends with:
- test report
- security review
- accessibility review
- migration review
- docs
- known issues
