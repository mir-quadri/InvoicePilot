# APPROVAL PACK — InvoicePilot (PayPal AI Hackathon)
**Status: DRAFTS ONLY — NOT submitted, NO video recorded, NO repo published.**
**Deadline: Nov 12, 2026, 12:00pm PT / 3:00pm ET.**
**Mir: approve or edit the exact wording below before anything is submitted or published.**

## DO NOT SUBMIT UNTIL these gates clear (all must be true at submit time)
- [ ] G1 — Live PayPal sandbox run completed (free PayPal Developer account + sandbox app + test accounts; see "What Mir must supply" below). Until then, no live-PayPal claim is true.
- [ ] G2 — Hosted-model endpoint enabled AND demoed (see "Hosted-model options" below). Until then, no hosted-model claim is true.
- [ ] G3 — Demo video recorded (under 3:00, public on YouTube) using the script below, in the mode the gates allow.
- [ ] G4 — Public repo published (one step: add remote, push, flip to public) with the README patch in "Repo flip" below applied.
- [ ] G5 — Eligibility confirmed at registration (Official Rules §3) by Mir.

## What Mir must supply (nothing else is missing)
1. **PayPal sandbox credentials (G1 — PARTIAL):** the credential lines are now present in local gitignored `.env` (PayPal sandbox lines + AI key line; sandbox OAuth token check passed Oct 29). Still outstanding: sandbox test accounts and the live draft→create→send run with recorded invoice evidence. Credentials stay in local `.env` only (never committed, never shared with judges — judges use their own sandbox app). Needed env vars: `PAYPAL_MODE=live-sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
2. **Hosted-model decision (G2 — decision effectively taken, NOT yet enabled or demoed):** Option A — free-tier Gemini key was created Oct 29 and verified working Oct 30 with model gemini-3.8-flash; the adapter is still unbuilt, `AI_DRAFT_ENDPOINT` is still unset, and nothing has been demoed. See options below.
3. **Exact-wording approval (this file)** and video approval after recording.

## Hosted-model options (decision effectively taken — Option A — but NOT yet enabled or demoed)
**Why this matters:** the Devpost page requires projects to "meaningfully incorporate AI" and to name the model/AI service used and how it was used. The current build's drafting engine is deterministic, not a hosted model — honest, but weak against that requirement.

- **Option A (TAKEN, NOT yet enabled): free-tier Gemini + tiny adapter.** Free-tier Google AI Studio API key created Oct 29 (project CareerProof) and verified working Oct 30 with model gemini-3.8-flash (gemini-2.0-flash is retired — do not use it). Still to build: a small adapter (serverless function or local proxy used during the recorded demo) that accepts `HttpDraftProvider`'s POST (`{task, clientName, items, totalCents, currency, sourceText}`) and returns `{description}` after calling Gemini. Tone selection and risk summary stay deterministic by design; the model writes only the one-line invoice description, which the freelancer reviews before anything reaches PayPal. Effort: ~1–2 hours plus demo re-record. Cost: $0 at demo volume on the free tier.
- **Option B (fallback, weaker): submit without hosted-model claims.** Describe the deterministic drafting engine and agent orchestration as the AI, and leave the "model used" field stating no hosted model was used. Honest, but risks a low AI-incorporation score.
- **Option C (REJECTED):** do not claim the stub-tested provider as real AI use. It has never run against a real model, and claiming otherwise would be false.

Note: a raw OpenAI/Anthropic API endpoint will NOT work directly — `HttpDraftProvider` requires a `{description}` JSON reply, so any provider needs the adapter in Option A regardless of model choice.

## EXACT demo-video script (for Mir's approval; target 2:30, hard cap 3:00)
Format: screen capture of the live dashboard, narrated. Public YouTube. No music, no third-party trademarks beyond PayPal's own sandbox UI if shown. On-screen line throughout: "Sandbox only — no real money."
Record ONLY after G1 and G2 clear; if either gate fails, do not record this version — re-cut with the fallback lines at the bottom.

### 0:00–0:25 — The problem
"Freelancers finish the work, then the invoice sits. Not because the work is unclear — because writing the invoice and chasing payment is awkward, and every week it slips is a week unpaid. InvoicePilot: describe the work in plain language, and let the agent draft it, put it in PayPal, and chase it politely."

### 0:25–1:00 — Draft from plain language (hosted model on)
Type: "Invoice Acme Studio for logo design, $800, net 14, billing@acme.example".
Show the preview: client, total $800.00, due date, items, and the understood summary. Say: "The hosted model writes the one-line description from the verified draft — and it didn't invent anything. If the email were missing, it would say so and wait." Correct nothing; confirm.

### 1:00–1:45 — Create and send in PayPal (LIVE sandbox)
Press "Create in PayPal (as draft)". Show the real sandbox invoice id and DRAFT status. Press "Send". Show SENT status and the payment link. Say: "This is the live PayPal sandbox — test accounts only, no real money. The client pays through PayPal. InvoicePilot never sees a card."

### 1:45–2:20 — Overdue + follow-up + risk
Switch to an overdue invoice (past due date). Show the dashboard status OVERDUE and the risk summary: outstanding total, overdue total, largest debtor. Press "Follow-up". Read the draft subject/body: polite tone, amount, due date, payment link, no threats. Say: "This is a draft. The freelancer sends it — the agent never emails anyone."

### 2:20–2:30 — Close
"Describe the work, confirm the draft, PayPal handles the money, and the chasing stays professional. InvoicePilot — get paid without becoming a debt collector. Sandbox only; no real money in this demo."

### Recording notes (from Oct 30 verification — apply on recording day)
- 1:45–2:20: read only the follow-up subject + key lines aloud — reading the full body (~110 words) exceeds the segment's 35s budget.
- 1:00–1:45: show the payment link via the follow-up draft or the PayPal payer view, NOT the invoice table — the table does not render `paymentLink`.
- Burn "Sandbox only — no real money" in over any non-dashboard shots (e.g., cuts to PayPal's own UI).
- Pre-seed a SENT invoice with a past due date before recording — there is no make-overdue button.
- Do not show the dashboard's "How it works — honestly" section on camera unless it is first updated to match the hosted-model demo.

### Fallback lines (use ONLY if a gate fails — never mix with the lines above)
- If G2 fails (no hosted model): replace the 0:25–1:00 model sentence with: "A deterministic drafting engine extracts the client, amount, and terms from the verified draft — no hosted model is used in this build."
- If G1 fails (no live sandbox): replace the 1:00–1:45 sandbox sentence with: "This is the mock sandbox — clearly labelled mock ids and links. The live-sandbox client is implemented but has not been run."

## EXACT Devpost submission text (for Mir's approval)
### Title
InvoicePilot — describe the work, get paid: an AI invoice + payment-chasing agent on PayPal

### Description
Freelancers finish the work, then the invoice sits. Writing it feels awkward, chasing payment feels worse, and every week it slips is a week unpaid.

InvoicePilot is an agent for solo freelancers and very small studios who delay invoicing and dread chasing payment. Describe the work in plain language — "Invoice Acme Studio for logo design, $800, net 14" — and InvoicePilot drafts a clear invoice, creates it in PayPal, tracks whether it is paid, unpaid, or overdue, and drafts polite, professional follow-up reminders that escalate in tone only with how overdue the invoice is. It never emails anyone, never handles card details, and never moves real money: sandbox/test only.

How it works:
- **Drafting (AI):** a hosted model writes the one-line invoice description from the verified draft through the `HttpDraftProvider` interface; anything missing from the freelancer's text is reported, never invented, and the freelancer confirms the preview before anything reaches PayPal. Tone selection (polite ≤7 days overdue, firm 8–30, final >30) and the risk summary stay deterministic by design — the model writes prose, it does not decide amounts, dates, or escalation.
- **PayPal (central):** invoices are created as drafts and sent through a PayPal client — create, send, and status calls are the only way an invoice comes into existence in this app. The client pays through PayPal; InvoicePilot sees only status and the payment link, never card details. The demo runs against the live PayPal sandbox with test accounts only.
- **Chasing:** follow-ups are drafts for the freelancer to send. Polite, firm, final — always professional, never threatening, always with amount, due date, and payment link.
- **Risk view:** outstanding and overdue totals, oldest overdue invoice, and largest-debtor share, so a freelancer knows where to start.

Built with TypeScript, Express, and Vitest (44 tests passing). Run instructions and the sandbox setup are in the public repository. Demo video (under 3 minutes) shows the full flow working end to end in the live sandbox. All materials are in English. The project is newly created during the Submission Period (Oct 1–Nov 12, 2026), is original work, and uses only open-source packages, the PayPal Developer platform under its sandbox terms, and the Google Gemini API under its terms. (The Gemini half of this sentence becomes true only when G2 clears — adapter built and demoed.)

Tools used: PayPal Developer platform (Invoicing API v2, sandbox environment, live run demonstrated); hosted-model drafting via `HttpDraftProvider` (model named here once Mir picks Option A — update this line with the exact model + adapter before submitting); TypeScript/Express/Vitest.

### What is NOT claimed in this text
No real money moved, no production credentials were used, no client was ever emailed by the agent, no card details were handled, and no payment is guaranteed. If G1 or G2 is not cleared, the corresponding sentences above must be replaced with the fallback lines before submitting.

## Repo flip (one approved step, after G1–G2)
Current state (verified Oct 30): local git repo, 1 commit, clean tree, NO remote configured, 28 tracked files, `.gitignore` covers `node_modules/`, `dist/`, `.env`. `LICENSE` (MIT) present at top level. No secrets tracked in git (`.env` exists locally, gitignored, 0600, holding the PayPal sandbox credential lines and the AI key line; only `.env.example` is committed).
Flip steps: (1) create public repo on GitHub, (2) `git remote add origin <url>`, (3) push, (4) confirm public visibility + LICENSE visible.
README patch required at flip time (current README still says "no repo was published, no demo video recorded" and "Those steps remain open" — replace those lines with the live-sandbox + hosted-model results and the demo video URL; do not flip with stale "not yet" lines). No invented traction, testimonials, or claims anywhere in the README — verified: none present.
