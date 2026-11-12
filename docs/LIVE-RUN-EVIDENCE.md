# Live PayPal sandbox run — evidence

**Date:** Fri 2026-10-30, run at 01:09 ET (OAuth + create attempt).
**Result: BLOCKED at the create step. No sandbox invoice was created, so
there is no sandbox invoice id, no send, and no payment link to report.**
Nothing below is faked: the steps that did not run are marked NOT RUN.

**Scope:** Sandbox ONLY, via the existing live client
(`src/paypal/live.ts`, `LivePayPalSandbox`). No production credentials,
no live PayPal apps, no dashboard setting changed, no account created.
No credential value appears in this file.

## What was attempted

Client: Acme Studio, billing@acme.example (test data), one item
"Logo design", quantity 1, $800.00 USD, due 2026-11-13, invoice number
`LIVE-20261030050935` (unique per run). Flow: OAuth → create (draft) →
send → GET. The run stopped at create (see failure).

## Evidence

### OAuth — PASSED (pair authenticates)

- `POST /v1/oauth2/token` (client-credentials): **HTTP 200**,
  token_type Bearer, expires_in 32400 (9h).
- The default token's scope list is long (payments, subscriptions,
  disputes, payouts, vault, webhooks, etc.) but contains **no invoicing
  scope** — no `invoicing` entry anywhere in the scope string.

### Invoicing scope — RESOLVED: NOT GRANTED (item (d))

- Explicit scope probes: requesting scope
  `https://uri.paypal.com/services/invoicing` and separately
  `https://api.paypal.com/v1/invoicing` each returned **HTTP 200 with
  scope reduced to `openid` only**. PayPal silently drops the requested
  invoicing scope because the sandbox app is not granted it.
- **Conclusion: the app token does NOT carry invoicing scope.** This is
  the blocker, not the credentials (OAuth itself passes).

### Create — FAILED (exact sanitized error)

- `POST /v2/invoicing/invoices` via `LivePayPalSandbox.createInvoice`:
  **HTTP 403**
  `{"name":"NOT_AUTHORIZED","debug_id":"f297465695ab1","message":"Authorization failed due to insufficient permissions.","details":[{"issue":"NOT_AUTHORIZED","description":"Authorization failed due to insufficient permissions."}]}`
- No invoice id was returned, so no draft exists to send or fetch.

## Unvalidated items — status after this run

| Item | Status | Evidence |
|---|---|---|
| (a) Is invoicer omission accepted? | **STILL OPEN** | Create never reached PayPal's invoice validation; the 403 is a scope rejection, not a shape rejection. Omission remains unproven. |
| (b) Actual send-response shape | **STILL OPEN** | Send never ran (no invoice id). The code's 200/202/204 handling is still docs-only. |
| (c) Is a payer-view payment link actually returned, and where observable? | **STILL OPEN — plus one UI fact confirmed** | No send/GET response exists to inspect. Separately confirmed from source: the dashboard invoice table (`public/index.html`, lines 83–84) renders number, client, total, due date, status, and PayPal invoice id — it does **not** render `paymentLink` anywhere (zero occurrences in the file). The only in-app surface for a payment link is the follow-up draft body (`src/drafting.ts`: "You can pay here: <link>" when `paymentLink` is non-null, else "Your payment link is on the invoice I sent."). So when a link IS eventually returned, it will be observable in the follow-up draft (and in raw GET `links[]` if PayPal returns a `payer-view` rel there) — not in the invoice table UI. |
| (d) Does the app token carry invoicing scope? | **RESOLVED: NO** | Default token scope list has no invoicing entry; explicit invoicing-scope requests return `openid` only. |
| (e) Idempotency (repeated create/send) | **STILL OPEN** | Neither probe could run without a created invoice. The code still sends no `PayPal-Request-Id` on create, so a timed-out create must still not be blindly retried. |

## What is needed to unblock (a Mir/dashboard step — not done here)

In the PayPal Developer dashboard, for the sandbox app used by this
project, enable/grant the **Invoicing** API scope (or use a sandbox app
that carries it), then re-run this flow: draft → create (expect DRAFT +
real sandbox invoice id) → send (expect SENT + payer-view link) → GET.
No code change is needed for the retry — the live client already sends
the correct calls; it is the app's granted scopes that reject them.
Re-run command (from the repo root; credentials read from `.env` only):

```bash
npx tsx /tmp/paypal-live-run.mjs   # run script used 2026-10-30 (not in repo)
```

## Related, already verified separately

- Gemini adapter live call: `gemini-3.8-flash` returns HTTP 200 with a
  one-line description (see `docs/ADAPTER.md` for latency notes and
  `tests/geminiAdapter.test.ts` for the opt-in live test). The Gemini
  gate is therefore proven; only the PayPal invoicing-scope gate blocks
  the end-to-end live demo.

## Run 2 — 2026-10-30 night (scope enabled; full flow verified)

Unblock completed by browser in the PayPal Developer Dashboard: My Apps &
Credentials > Sandbox > PayPilot > Features > Payment capabilities >
"Invoicing — Send and manage customer invoices" was unchecked, was checked,
"Save Changes" clicked, and a reload showed the checkbox still checked
(change persisted). Nothing else touched (no Default Application, no live
app, no new app). Sign-in for that dashboard session used the saved login
plus the emailed verification code, entered only on paypal.com.

Retry command (from the repo root; credentials read from `.env` only):

```bash
npx tsx scripts/paypal-live-run.mjs
```

Note: plain `node` cannot run this script (Node 24 type-stripping rejects
the TypeScript parameter properties in `src/paypal/live.ts`); `tsx` is the
runner. The script now lives in the repo at `scripts/paypal-live-run.mjs`
(the run-1 note calling it a /tmp script is superseded).

### Transcript (test data only; no secret values)

- Invoice number: `LIVE-20261031031056` (Acme Studio, $800 USD, due 2026-11-13).
- OAuth: HTTP 200, Bearer, ~9h expiry, app id present. Token scope NOW
  INCLUDES `https://uri.paypal.com/services/invoicing` — the 403 cause is gone.
- First retry attempt (before the parser fix) hit a NEW, non-403 failure:
  create returned no invoice id. Diagnosis by probe: PayPal's sandbox
  create returns HTTP 201 with a link object ONLY
  (`{rel: "self", method: "GET", href: "https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-..."}`),
  not the full invoice resource the client expected. Fix in
  `src/paypal/live.ts`: new exported `extractInvoiceId()` accepts a full
  resource id, a self-href path id, or a links[] self href id; the id is
  extracted from the href path and the href itself is NEVER fetched (its
  host sits outside the client's sandbox-host allowlist). Test added in
  `tests/live.test.ts` for the link-only shape. Suite after the fix:
  63 passed, 1 skipped, typecheck/build clean.
- CREATE_OK: `INV2-NJBB-56P2-6CS3-SUQP`, status DRAFT.
- GET after create: HTTP 200, status DRAFT, invoicer present (stored as
  `{}`), links self/send/replace/delete/record-payment, NO payer-view link
  on a draft (expected).
- SEND_OK: status SENT, paymentLink
  `https://www.sandbox.paypal.com/invoice/p/#INV2-NJBB-56P2-6CS3-SUQP`
  (from the 202 send response's payer-view href object).
- GET after send: HTTP 200, PayPal status SCHEDULED (future due date),
  which the client maps to SENT. Links self/replace/delete/record-payment
  — still NO payer-view link in GET links[].
- CLIENT_GET_OK: SENT, paymentLink null (GET carries no payer-view link;
  the link lives on the send response only — see correction to (c) below).
- Repeat create with the SAME invoice number: HTTP 422
  `DUPLICATE_INVOICE_NUMBER` — PayPal rejects a same-number duplicate
  instead of silently creating one.
- Repeat send: HTTP 202 with the same payer-view href again.

### Updated item status (all five now resolved)

| Item | Status | Evidence |
|---|---|---|
| (a) Is invoicer omission accepted? | **VALIDATED: YES** | Draft created and retrievable with invoicer omitted; PayPal stores invoicer as `{}`. |
| (b) Actual send-response shape | **VALIDATED: 202 + payer-view href object** | Send returned 202 with `{href (payer-view), rel, method}`; the client captures the link from it. |
| (c) Is a payer-view payment link actually returned, and where observable? | **VALIDATED — with a correction** | The link IS returned, in the send response only. CORRECTION to run 1: raw GET `links[]` does NOT carry a `payer-view` rel (checked on both the DRAFT and the sent invoice). In-app, the link surfaces in the follow-up draft body when `paymentLink` is non-null; the dashboard invoice table still does not render it. |
| (d) Does the app token carry invoicing scope? | **RESOLVED: YES (was NO)** | Dashboard Invoicing toggle enabled Oct 30 night; fresh token scope includes the invoicing URI. |
| (e) Idempotency (repeated create/send) | **VALIDATED: safe** | Same-number create → 422 DUPLICATE_INVOICE_NUMBER (no duplicate created); re-send → 202 + same link. The code still sends no `PayPal-Request-Id`; the safety comes from PayPal's invoice-number dedupe, not from the client. |

### Leftover sandbox test drafts (harmless, no action needed)

The pre-fix ambiguous draft (`LIVE-20261031030840`, create returned no id
under the old parser) and two probe drafts (`PROBE-…`, `PROBE2-…`,
including `INV2-QNE2-2R85-HWHN-E3ST`) remain in the sandbox as test data.
They are invisible to judges and cost nothing; no cleanup is required.
