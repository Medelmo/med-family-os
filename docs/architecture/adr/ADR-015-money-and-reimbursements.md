# ADR-015: Money representation, expense categories, and the reimbursement state machine

**Status:** Accepted
**Date:** 2026-09-14
**Phase:** 5 (Finance)

## Context

`docs/domain/domain-model.md` defines Expense as "a financial occurrence",
Reimbursement as "a claim/process associated with one or more expenses",
and Budget as "a planning envelope, not a bank ledger". That is the whole
specification. `docs/domain/state-machines.md` gives six lines for the
reimbursement lifecycle. Several decisions therefore had to be made rather
than read off, and each one is the kind that is expensive to reverse once
the household has real data in it.

`docs/requirements/product-spec.md` also lists "banking replacement" as an
explicit anti-goal, and CLAUDE.md §0 puts the ledger outside this app.

## Decision

### 1. Money is integer minor units plus an ISO 4217 code, stored per row

`{ amountMinor: number, currency: string }`, persisted as `bigint` and
`text` with a `~ '^[A-Z]{3}$'` check.

- **Not a float.** `0.1 + 0.2 !== 0.3`. A household that cannot make its own
  expense list add up will not trust anything else the app says.
- **Not `numeric` read into a JS number.** That reintroduces the float at
  the driver boundary while looking exact in the database.
- **`bigint`, not `integer`.** `integer` caps at about 21 million euros in
  cents. That is low enough that a mis-parsed CSV row could overflow and
  corrupt a record rather than fail. `bigint` in Drizzle's `mode: "number"`
  is an ordinary JS number, exact to 2^53 minor units.
- **Currency per row, not only on the household.** A receipt from a trip
  stays in the currency it was paid in, and changing the household default
  later must not silently restate history.

Formatting lives in the UI with next-intl, which knows the user's locale
(CLAUDE.md §14). The domain layer only moves integers.

### 2. Amount parsing has an explicit, tested rule — and import confirms it

"1,234" is 1234 to a German reader and 1.234 to an American one, and a
bank CSV carries no hint. `parseAmountToMinor` resolves this with a total,
documented rule (last separator wins when both appear; a lone separator
followed by exactly three digits is grouping) rather than a locale guess.

The rule can be wrong by a factor of a thousand on genuinely ambiguous
input. That is not fixable in the parser, so it is handled in the workflow:
**CSV import shows every parsed row and its interpreted amount for
confirmation before anything is written.** This also satisfies the
"never silently discard records" principle the project applies to imports.

### 3. Expense categories are a fixed list, not free text

Free-text categories cannot be budgeted against without first solving
"Groceries" vs "groceries" vs "Food", and they cannot be translated
(CLAUDE.md §14). A fixed list of thirteen is used.

The cost is that it will not fit every household exactly, and this is the
reversible half of the trade: user-defined categories can later be added as
rows seeded from these values, whereas un-picking free text afterwards
means guessing at the household's own historical data.

### 4. Expenses default to `SENSITIVE`

Every other aggregate defaults to `NORMAL`. Expenses do not, because
CLAUDE.md §5 makes children "highly restricted" and the policy kernel
already refuses a `CHILD` any resource above `NORMAL`. §10 names "detailed
financial transactions" as something even Home Assistant must never see.

Defaulting to `NORMAL` and relying on each call site to raise it would mean
one forgotten field makes the household's finances readable by a child
account — a default that fails open. This project has already been bitten
by exactly one of those (the `canAccess` fail-open found in the Phase 0
audit), and the lesson was that the default must be the safe value.

### 5. Budgets are recurring monthly envelopes, not one row per month

A row per category per month needs something to create next month's rows —
a job that can fail, run twice, or run for a household that stopped using
budgets — and makes "what is the limit for March?" depend on whether that
job has run. A recurring envelope with `startsOn`/optional `endsOn` answers
that for any month, past or future, from data that already exists.

Stated consequence: changing a limit changes it for every month the
envelope still covers, including past ones. A household that needs "400
until June, 450 after" ends one envelope and starts another. A partial
unique index enforces at most one *open* envelope per category and
currency, because overlapping envelopes make the limit for a month
ambiguous with no principled way to choose.

Amounts in a currency other than the envelope's are **excluded, not
converted**. Converting needs a rate this app cannot verify, and a budget
quietly inflated by yesterday's exchange rate is worse than one that says
some expenses are not counted here.

### 6. Two corrections to `docs/domain/state-machines.md`

The document has been amended to match, rather than left to disagree with
the code.

**a. `WAITING -> REJECTED` is added.** The document allows refusal only
from `SUBMITTED`. But `WAITING` is precisely the state a submitted claim
occupies while the counterparty decides, so a refusal almost always arrives
while `WAITING`. Without this edge the common case has no legal path and
the household would have to falsify the record to close it. `SUBMITTED ->
REJECTED` is read as "a claim that has been submitted can be refused", and
a waiting claim is a submitted one.

**b. "Any open state -> CANCELLED" is enumerated** as `PLANNED`,
`SUBMITTED`, `WAITING`, `APPROVED`, `PARTIALLY_REIMBURSED`. `PAID` is
excluded: the money has arrived, and cancelling would make the record state
something untrue. A paid claim is closed with `COMPLETED`.

`REJECTED` stays terminal. An appeal is a new claim, so the original keeps
saying what actually happened — the same reasoning ADR-007 used to deny a
case a reopen edge.

### 7. Business rules the machine enforces

- `SUBMIT` requires a counterparty. A claim submitted to nobody cannot be
  chased, and chasing is the point of tracking one.
- `WAIT` requires a follow-up date **or** an explicit reason there is none —
  the same rule as a waiting case, and what makes "unresolved
  reimbursement" (a product-spec attention trigger) measurable at all.
- `REJECT` requires a reason.
- A "partial" payment covering the whole claim is refused rather than
  reinterpreted; it would leave the record in a state whose name
  contradicts its numbers.
- A **final** payment smaller than the claim is allowed. Insurers routinely
  pay less than was asked. `PAID` means "no more is coming", not "we got
  everything".
- `approvedAmountMinor` is optional: many counterparties approve without
  naming a figure until they pay, and requiring one would mean inventing
  data.

## Consequences

- Reimbursements reuse the normalised attention candidate from Phase 3
  (`domain/attention/rules.ts`), so `FOLLOW_UP_DUE`, `WAITING_TOO_LONG` and
  `WAITING_INDEFINITELY` apply to claims with no new rules — which is what
  that refactor was for.
- Reimbursements carry `followUpNotifiedAt`, so `scanForReminders` picks
  them up with the same structural-idempotency trick as tasks and cases.
- The fixed category list and the single-currency-per-envelope rule are
  both deliberately narrower than a general finance tool. Widening either
  later is additive.
- Nothing here converts currency, computes tax, or reconciles against a
  bank. Those are the anti-goals, and staying out of them is why this phase
  is small.
