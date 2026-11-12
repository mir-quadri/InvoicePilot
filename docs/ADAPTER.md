# Gemini adapter (Option A) — how to run it

A tiny local proxy that lets InvoicePilot's `HttpDraftProvider`
(`src/drafting.ts`) talk to Google Gemini. No raw LLM endpoint returns the
`{ description }` contract the provider requires, so this adapter translates
between the two.

## What it does — and does not do

- Accepts the provider's POST: `{ task, clientName, items, totalCents,
  currency, sourceText }` (task must be `invoice_description`).
- Calls the Google Gemini API (`https://generativelanguage.googleapis.com`,
  model **gemini-3.8-flash** only) and returns `{ description }`.
- The model writes **ONLY the one-line invoice description**. Tone selection
  and risk summary stay deterministic in the app and are never moved into
  the model; the prompt never asks for them, nor for amounts, dates, or
  client details.
- **gemini-2.0-flash is RETIRED** (verified 404 model-not-found) and is never
  used here — not in code, docs, or tests.

## Contract enforcement (policy: REJECT, fail loudly)

- Empty model reply → HTTP 502, no `description` field, no fallback text.
- Model reply over 500 characters → HTTP 502, no `description` field.
  An exactly-500-character reply is ACCEPTED (boundary tested).
  Nothing is truncated and nothing is invented: a bad reply is an error the
  caller surfaces, never a silent success.
- Any Gemini error (non-2xx, malformed reply, missing candidates, rejected
  fetch) → HTTP 502, no `description` field, with a sanitized, key-free
  error message. A missing key refuses startup (exit 1).
- No usable item descriptions (empty/missing `items`, blank descriptions)
  → HTTP 400, no `description` field, and Gemini is never called. The
  adapter never asks the model to summarise work that was never supplied.
- Model lock: the adapter uses **gemini-3.8-flash only**. Any in-process
  caller that passes a different `model` option (including the retired
  gemini-2.0-flash) throws at handler construction, before any API call.
  The API key travels only in the `x-goog-api-key` header, never in a URL.

## Run it

The repo-root `.env` (gitignored, 0600) already holds `AI_DRAFT_API_KEY`.
The adapter reads that key at runtime — from the environment first, then
from `.env`. It is never hardcoded and never printed.

```bash
# Terminal 1 — start the adapter (listens on http://127.0.0.1:3101/)
npm run adapter
# Override the port if needed:
#   GEMINI_ADAPTER_PORT=3102 npm run adapter
# Built output also works after `npm run build`:
#   node dist/gemini-adapter.js
```

```bash
# Terminal 2 — run the app against the adapter
AI_DRAFT_ENDPOINT=http://127.0.0.1:3101/ npm run dev
# (Keep AI_DRAFT_API_KEY in .env for the adapter. The app also sends it as
# a Bearer token to the loopback adapter only; the adapter ignores it.)
```

Then use the dashboard at http://localhost:3000/ as usual: draft an invoice
and the description comes from Gemini via the adapter.

## Default behaviour is unchanged

When `AI_DRAFT_ENDPOINT` is **unset**, the app uses the local deterministic
drafting engine exactly as before. Setting the endpoint only swaps the
description writer; it never changes PayPal behaviour, tone, or risk.

## Latency — read before demoing

Free-tier Gemini is slow: live calls measured 2026-10-30 took **36.9s and 57.8s**
for HTTP 200s (and an earlier attempt returned HTTP 503 "high demand",
which the adapter surfaces as a 502 — retry, don't work around it). Both
the adapter and `HttpDraftProvider` therefore allow **180s** per call
(previously 8s/15s, which could never complete a live call). Allow ~60s
plus retries when recording the demo; the app shows no progress indicator
during that wait.

## Tests

```bash
npm test   # includes tests/geminiAdapter.test.ts (mocked Gemini responses)
# Optional live check (run from the repo root; the test reads the key from
# .env directly at runtime and prints no secrets — do NOT `source .env`
# in bash, which can mangle the key value):
RUN_LIVE_GEMINI=1 npm test -- tests/geminiAdapter.test.ts -t "live"
```

## Files

- `src/gemini-adapter.ts` — adapter server + prompt/validation helpers.
- `tests/geminiAdapter.test.ts` — mocked-Gemini tests + opt-in live test.
