# Demo script — InvoicePilot (target 2:30, hard cap 3:00)
DRAFT ONLY. No video recorded. For the live demo, the PayPal sandbox gate must
be cleared first (free PayPal Developer account + sandbox app); the script
shows the mock flow by default and must be re-shot live if the sandbox is used.

Format: screen capture of the live dashboard, narrated. Public YouTube.
No third-party trademarks beyond PayPal's own sandbox UI (if shown), no music.
On-screen line throughout: "Sandbox only — no real money."
Narration honesty: do NOT claim a hosted LLM/model was used unless the
hosted-model endpoint gate has been cleared and the demo is re-shot with it.
In the default build, say "drafting engine" / "agent logic", not "the AI
model".

## 0:00–0:25 — The problem (presenter / voiceover, dashboard empty)
"Freelancers finish the work, then the invoice sits. Not because the work is
unclear — because writing the invoice and chasing payment is awkward, and
every week it slips is a week unpaid. InvoicePilot: describe the work in
plain language, and let the agent draft it, put it in PayPal, and chase it
politely."

## 0:25–1:00 — Draft from plain language
Type: "Invoice Acme Studio for logo design, $800, net 14, billing@acme.example".
Show the preview: client, total $800.00, due date, items, and the understood
summary. Point out: "It didn't invent anything — if the email were missing,
it would say so and wait." Correct nothing; confirm.

## 1:00–1:45 — Create and send in PayPal (sandbox)
Press "Create in PayPal (as draft)". Show the PayPal invoice id and DRAFT
status. Press "Send". Show SENT status and the payment link. Say plainly which
mode is running: mock sandbox by default; live sandbox only with sandbox
credentials, test accounts only. "The client pays through PayPal. InvoicePilot
never sees a card."

## 1:45–2:20 — Overdue + follow-up + risk
Switch to an overdue invoice (past due date). Show the dashboard status
OVERDUE and the risk summary: outstanding total, overdue total, largest
debtor. Press "Follow-up". Read the draft subject/body: polite tone, amount,
due date, payment link, no threats. "This is a draft. The freelancer sends
it — the agent never emails anyone."

## 2:20–2:30 — Close
"Describe the work, confirm the draft, PayPal handles the money, and the
chasing stays professional. InvoicePilot — get paid without becoming a debt
collector. Sandbox only; no real money in this demo."
