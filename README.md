# 💸 InvoicePilot — the freelancer invoice + payment-chasing agent

**PayPal AI Hackathon (Devpost) — Submission Period, per Official Rules §1:
Oct 1, 2026 (9:15am PT) – Nov 12, 2026 (12:00pm PT / 3:00pm ET). Judging
Dec 1–15, 2026; winners announced on or around Dec 21, 2026.**
Prize wording — read carefully: the Devpost page header says **$69,750** in
total prizes and the prizes section says "$67,500+", but Official Rules §8
lists individual prizes (1st $12,000, 2nd $8,000, 3rd $5,000; five $5,000
honorable-mention awards; sponsor prizes including AG Grid / APIMatic /
Bryntum / Channel3 / Render) whose face total does not reconcile to $69,750
on its own. Per Official Rules §11.4, the Official Rules prevail over other
Hackathon materials in case of discrepancy. **This README does not state a
verified total prize figure.** Re-check the Official Rules page before
submitting. Eligibility (Rules §3: age of majority, excluded jurisdictions
including Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and
U.S.-sanctioned countries; no Promotion-Entity employees/family) is for Mir
to confirm at registration — it is not verified by this code.

> "I finished the logo on Tuesday. Can you just… invoice them? And chase it
> if they don't pay?" — InvoicePilot does exactly that, without the freelancer
> becoming a debt collector.

**Who it helps:** solo freelancers and very small studios who do the work
well but delay invoicing and dread chasing payment — people with no finance
team, for whom one unpaid invoice can be a month's cash flow.
**The problem:** the invoice sits unwritten because drafting it is friction,
and the reminder sits unsent because chasing feels confrontational. Every
week it slips is a week unpaid.
**What it is:** a freelancer describes work in plain language. InvoicePilot
drafts a clear invoice, creates it in PayPal, tracks paid / unpaid / overdue,
and drafts polite, professional follow-up reminders that escalate in tone
only with how overdue the invoice is. The freelancer always confirms the
draft before anything reaches PayPal, and follow-ups are drafts for the
freelancer to send — **InvoicePilot never emails anyone and never handles
card details. No real money moves in this build: sandbox/test only (see below).**

## What it does

| Step | What happens |
|---|---|
| **Draft** | Free text → client, email, amount(s), currency, due terms, work items. Anything missing is reported as `missingFields`, never invented. |
| **Confirm** | The dashboard shows the full draft. The freelancer can correct client/email/due date before creation. |
| **Create (PayPal)** | Creates a PayPal invoice **as a draft** via the PayPal client. Default: mock sandbox (tested). Live: PayPal Invoicing API v2 client, sandbox only, verified live Oct 30, 2026 — sandbox invoice INV2-NJBB-56P2-6CS3-SUQP created as DRAFT and sent (PayPal status SCHEDULED, app status SENT); test data only (Acme Studio, $800 USD, due 2026-11-13). Full evidence: `docs/LIVE-RUN-EVIDENCE.md`. |
| **Send** | Sends the invoice via PayPal. The client pays through PayPal; InvoicePilot sees only the status. |
| **Track** | Dashboard: paid / unpaid / overdue (overdue is derived from the due date), plus a payment-risk summary — outstanding total, overdue total, oldest overdue, largest debtor share. |
| **Chase** | Follow-up draft per invoice: polite (≤7 days overdue) → firm (8–30) → final (>30). Always professional, never threatening, always with the amount, due date, and payment link. |
| **Test helper** | In mock mode only, "Mark paid (mock)" simulates the payer paying. Refused in live mode. |

## How PayPal and AI are both central (not bolt-ons)

- **PayPal is central:** no invoice exists outside PayPal. Creation, sending,
  status, and the payment link all go through the `PayPalClient` interface.
  Remove PayPal and there is no product — only a text parser.
- **AI — hosted model implemented via a local proxy adapter; default remains deterministic when the endpoint is unset:** when `AI_DRAFT_ENDPOINT` is set, `HttpDraftProvider` (`src/drafting.ts`) POSTs the verified draft to the Gemini adapter (`src/gemini-adapter.ts`, run with `npm run adapter` on `http://127.0.0.1:3101/`, overridable via `GEMINI_ADAPTER_PORT`), which calls Google Gemini model gemini-3.8-flash only (gemini-2.0-flash is retired and never used) and returns `{description}`. The model writes ONLY the one-line invoice description; tone selection from overdue age and the risk summary stay deterministic by design, and the adapter rejects fail-loud (HTTP 502, no description) on empty or over-500-character replies. The adapter is built, reviewed, fixed, and live-tested (see `docs/ADAPTER.md`); the full suite is 63 passed, 1 skipped, with typecheck/build clean. When `AI_DRAFT_ENDPOINT` is unset, the app uses the local deterministic drafting engine exactly as before, and no model output is faked. The demo video was recorded Nov 11, 2026 with the deterministic engine (no hosted model) after the Gemini adapter's live calls failed seven straight times with 503 "high demand" — see below. See `src/drafting.ts`, `src/gemini-adapter.ts`, and `docs/ADAPTER.md`.

## Run it (2 minutes, no keys, no money)

```bash
npm install
npm run dev          # http://localhost:3000/ — dashboard
```

```bash
npm test             # unit + agent + HTTP tests
npm run typecheck
npm run build
npm run smoke        # boots the server: draft -> mock PayPal create -> send
curl -s localhost:3000/health
```

Try it: paste
`Invoice Acme Studio for logo design, $800, net 14, billing@acme.example`,
press **Draft invoice**, confirm, **Create in PayPal (as draft)**, then **Send**,
then **Follow-up** once the due date passes (or use a past due date in the text).

## For judges — testing access (no credentials needed in the default build)

In the default (mock) mode, judges need **no accounts, keys, or test
credentials of any kind**: `npm install && npm run dev`, then use the
dashboard as described above. Every PayPal id/link in that mode is visibly
mock (`MOCK-INV-…`, `mock-sandbox://…`). No test credentials are bundled
because none exist for this build. For the live sandbox, judges would use
their own free PayPal Developer sandbox app (see below) — never shared
credentials. All submission materials are in English.

## Live PayPal sandbox (verified live Oct 30, 2026 — sandbox only)

A PayPal Developer sandbox app (PayPilot) and sandbox credentials exist locally (gitignored `.env` only, never committed). Live run Oct 30, 2026: OAuth passed (HTTP 200, invoicing scope present), invoice INV2-NJBB-56P2-6CS3-SUQP created as DRAFT, sent (PayPal status SCHEDULED, app status SENT), and the send response returned the payer-view payment link. Test data only. The mock sandbox remains the default mode; live mode runs only with sandbox credentials set. Full evidence: `docs/LIVE-RUN-EVIDENCE.md`. To run live:

```bash
PAYPAL_MODE=live-sandbox \
PAYPAL_CLIENT_ID=<sandbox app client id> \
PAYPAL_CLIENT_SECRET=<sandbox app secret> \
npm run dev
```

`LivePayPalSandbox` (`src/paypal/live.ts`) is implemented (OAuth
client-credentials; Invoicing API v2 `POST /v2/invoicing/invoices`,
`.../send`, `GET ...`; exact sandbox-host allowlist; never logs credentials)
and was run live Oct 30, 2026 — see above and `docs/LIVE-RUN-EVIDENCE.md`.
Shape fixes from the PayPal Developer sample/reference (2026-10-26) are
documented in `src/paypal/live.ts`. Live-validated Oct 30, 2026: the
invoicing scope on the app token, invoicer omission (accepted; the draft is
retrievable and the invoicer is stored as `{}`), the send-response shape
(202 + payer-view href object — the payer-view link comes from the send
response, not from GET links), and same-number create rejection (422
DUPLICATE_INVOICE_NUMBER — no silent duplicate). Still unvalidated:
fractional-quantity strings. **Sandbox only. Test accounts only. Never use
production credentials or real money with this app.** The hosted-model
endpoint above (`AI_DRAFT_ENDPOINT` via the Gemini adapter) is built and
live-tested — see `docs/ADAPTER.md`. The demo video was recorded Nov 11, 2026 using the deterministic engine (no hosted model) after the adapter's live calls failed with 503 "high demand" — demo video: https://www.youtube.com/watch?v=_xTSgz_EYBQ.

## Validation rules (fix pass, 2026-10-26)

- **Multi-item pairing is in text order.** "logo $200 and hosting $800"
  pairs $200 with logo and $800 with hosting. (An earlier build sorted the
  amounts in place, reversing them while the total still looked right.)
- **Totals must add up, at both the agent and the API boundary.**
  A draft is rejected if the sum of line items differs from `totalCents`,
  or if any line amount differs from `quantity x unit amount`.
- **Fractional quantities round to whole cents.** Line amount =
  `Math.round(quantity x unit amount in cents)`; for hourly work the rate
  is rounded to whole cents first, then the line amount is
  `Math.round(rate x hours)`. The rounded amount is what the preview
  shows and what the total must match.
- **Mixed currency is rejected, not relabelled.** Text containing two
  currencies (e.g. $ and £) produces no items and a `currency` missing
  field; creation is blocked until the user uses one currency.
- **Startup misconfiguration fails loudly.** A bad `PAYPAL_MODE` /
  credential setup is reported as a PayPal configuration error and a bad
  `AI_DRAFT_ENDPOINT` as a draft-provider error; neither silently falls
  back to mock/local mode. Fix the environment and restart.
- **Live PayPal shapes were corrected from the docs, then validated
  against the live sandbox Oct 30, 2026** (see above): billing name as a
  `{given_name, surname}` object, `payment_term` with `term_type`,
  `invoice_date`, no empty `invoicer` object, `unit_of_measure: QUANTITY`,
  send responses handled by the requested id plus the payer-view link from
  the send response, and PayPal's full status enum mapped so
  cancelled/refunded states become CANCELLED (never DRAFT) and
  partially-paid stays SENT (unpaid). One live-observed correction: create
  returns 201 with a self-link object only, so the invoice id is extracted
  from the link href (see `src/paypal/live.ts`).

```
src/parse.ts            Free-text -> invoice draft (missing fields reported, never invented)
src/drafting.ts         DraftProvider: local engine + HttpDraftProvider (hosted model, unconfigured), follow-up tones, risk summary
src/types.ts            Money in integer cents, statuses, OVERDUE derivation, date helpers
src/store.ts            In-memory invoice store (restart clears it, by design)
src/paypal/types.ts     PayPalClient interface
src/paypal/mock.ts      Mock sandbox: deterministic ids, mock-sandbox:// links, markPaid test helper
src/paypal/live.ts      Live sandbox client: Invoicing API v2, sandbox only, verified live Oct 30, 2026
src/paypal/index.ts     createPayPalClient(): mock by default, live-sandbox only with credentials
src/agent/agent.ts      Draft -> confirm -> create -> send -> chase orchestration
src/server.ts           Express API + static dashboard, JSON errors, rate-limited /api; createAgent() fails startup loudly on bad config (no mock fallback)
public/index.html       Dashboard: draft, confirm, list, send, follow-up, risk summary; "Mark paid (mock)" hidden in live mode
tests/                  Vitest: parsing, drafting, hosted-provider stub, agent lifecycle, HTTP API, startup config, live-client shape helpers (docs + live-observed shapes)
scripts/smoke.ts        End-to-end smoke against the mock sandbox
docs/                   Demo script + draft Devpost description (NOT submitted)
```

## What it does NOT do — honest limits

- **Does not** email anyone, send SMS, or contact a client in any way.
  Follow-ups are drafts for the freelancer to review and send.
- **Does not** handle card details, bank details, or real money. Sandbox/test
  only in every mode this build supports.
- **Does not** guarantee payment, give legal or accounting advice, or threaten
  legal action, debt collection, or credit reporting. It is not a lawyer,
  debt collector, or accountant.
- **Does not** use a hosted AI model in its default build (endpoint unset — see the AI section
  above). When `AI_DRAFT_ENDPOINT` is set to the Gemini adapter, the model output (one-line description only) must be labelled as
  model output and reviewed before use.
- **Does not** invent clients, amounts, dates, users, payments, or results.
  Every figure on screen comes from the user's text or from PayPal/mock
  state. Parsing, drafting, agent, HTTP, configuration, and live-client
  shape behaviours are covered by the tests in `tests/` — but coverage is
  not exhaustive, and no claim is made that every figure is individually
  test-covered. Always check the preview before sending.
- Storage is in-memory. A production version needs a database, authentication,
  and proper handling of client contact data before any real deployment.
- Amounts are parsed from what the user wrote. If the text is ambiguous, the
  draft says so — check the preview, especially the total, before sending.
- Demo video recorded Nov 11, 2026 and published on YouTube: https://www.youtube.com/watch?v=_xTSgz_EYBQ (1:56, deterministic drafting engine, no hosted model; live PayPal sandbox). Live sandbox verification is done (invoice INV2-NJBB-56P2-6CS3-SUQP, Oct 30, 2026 — see `docs/LIVE-RUN-EVIDENCE.md`). Note: `docs/SUBMISSION-DRAFT.md` and `docs/APPROVAL-PACK.md` predate the live run and the fallback recording — they describe the earlier hosted-model plan and are stale; the README and `docs/LIVE-RUN-EVIDENCE.md` describe the build as shipped.
- Third-party code used is limited to open-source packages under their own
  licenses (Express, zod, Vitest — see `package.json`/`package-lock.json`)
  and the PayPal Developer platform under its sandbox terms. No other
  third-party SDK, API, or dataset is integrated, and no third-party
  trademarks, music, or copyrighted material appear in the app; the demo
  script avoids them too (PayPal is named only to describe the required
  integration, in the hackathon context).

## License

MIT — see `LICENSE`.
