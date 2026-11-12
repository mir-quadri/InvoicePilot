# Draft Devpost description — InvoicePilot (NOT submitted; Mir's approval of exact wording required)

> Fix pass 2026-10-26 (not yet re-reviewed): multi-item pairing in text
> order, totals validation (agent + API), mixed-currency rejection,
> fractional-hours rounding rule, loud startup-config failure, and
> live-PayPal shape fixes from the docs (still no live PayPal run).
> Still NOT submitted, no repo published, no video recorded.

## Title (draft)
InvoicePilot — describe the work, get paid: an AI invoice + payment-chasing agent on PayPal

## Description (draft, for Mir to approve/edit)
Freelancers finish the work, then the invoice sits. Writing it feels awkward,
chasing payment feels worse, and every week it slips is a week unpaid.

InvoicePilot is an agent for solo freelancers and very small studios who
delay invoicing and dread chasing payment. Describe the work in plain
language — "Invoice Acme Studio for logo design, $800, net 14" — and
InvoicePilot drafts a clear invoice, creates it in PayPal, tracks whether it
is paid, unpaid, or overdue, and drafts polite, professional follow-up
reminders that escalate in tone only with how overdue the invoice is. It
never emails anyone, never handles card details, and never moves real money:
sandbox/test only.

How it works:
- **Drafting (AI — PARTIAL, see gate below):** in this build a deterministic
  drafting engine extracts client, email, amount, currency, and due terms
  from free text. Anything missing is reported, never invented, and the
  freelancer confirms the preview before anything reaches PayPal. A hosted-
  model provider (`HttpDraftProvider`, tested against a local stub, never
  run against a real model) sits behind the same DraftProvider interface;
  tone and risk decisions stay deterministic by design. No hosted model was
  used in this build, and no model output is claimed.
- **PayPal (central):** invoices are created as drafts and sent through a
  PayPal client interface — create, send, and status calls are the only way
  an invoice comes into existence in this app. The client pays through
  PayPal; InvoicePilot sees only status and the payment link, never card
  details. The default build runs against an in-memory mock sandbox (clearly
  labelled mock ids/links, tested end to end); a live-sandbox client for the
  Invoicing API v2 is implemented in code but has never been run. Sandbox
  only — no real money.
- **Chasing:** follow-ups are drafts for the freelancer to send. Polite
  (≤7 days overdue), firm (8–30), final (>30) — always professional, never
  threatening, always with amount, due date, and payment link.
- **Risk view:** outstanding and overdue totals, oldest overdue invoice, and
  largest-debtor share, so a freelancer knows where to start.

Built with TypeScript, Express, and Vitest. Tests, run instructions, and the
sandbox setup are in the repository (to be published). Demo video (under
3 minutes, to be recorded) shows the full flow working end to end. All
materials are in English. The project is newly created during the Submission
Period (Oct 1–Nov 12, 2026), is original work, and uses only open-source
packages plus the PayPal Developer platform under its sandbox terms.

Tools used: PayPal Developer platform (Invoicing API, sandbox environment;
live client implemented, not yet run — mock sandbox tested); drafting engine
behind a DraftProvider interface (deterministic local engine by default; a
hosted-model provider is implemented and stub-tested but no hosted model was
used in this build — no hosted-model use is claimed); TypeScript/Express/Vitest.

## Submission checklist (from the Official Rules + Devpost page, re-read live 2026-10-26)
- [ ] Text description (this draft, after Mir approves exact wording)
- [ ] Functional demo — judges need NO credentials in mock mode (run instructions in repo); hosted demo URL optional
- [ ] Tools listed, with how each was used (above — no hosted model claimed)
- [ ] Public code repository (GitHub/GitLab/Bitbucket) with LICENSE visible at the top — NOT yet published
- [ ] Demo video under 3 minutes, public on YouTube, link on the form — NOT yet recorded; no third-party trademarks/music without permission
- [ ] Live PayPal sandbox demo (needs Mir's free PayPal Developer account + sandbox app) — OPEN GATE
- [ ] Hosted-model endpoint enabled + demoed (needs Mir's choice of model/endpoint) — OPEN GATE
- [ ] Eligibility confirmed at registration (Rules §3) — Mir to confirm
- [ ] Deadline: Nov 12, 2026, 12:00pm PT / 3:00pm ET (Rules §1). Prize wording: the page header says $69,750 and the prizes section says $67,500+, but Rules §8 lists individual prizes and §11.4 says the Official Rules prevail in case of discrepancy — no total prize figure is stated here as verified fact.

## What is NOT claimed
No live PayPal call was made in this build, no PayPal account was created, no
hosted model was run, and no demo video or repo was published. Do not submit
until both open gates are cleared, a live (sandbox) demo is recorded, and Mir
approves the wording.
