/**
 * Drafting engine — the "AI" side of InvoicePilot, behind an interface.
 *
 * Honest scope: this build ships a deterministic drafting engine. It parses
 * free text (see parse.ts), writes a clear invoice description, chooses a
 * follow-up tone from how overdue an invoice is, and summarises payment risk
 * from real invoice state. No hosted LLM key is required, and no model output
 * is faked: every sentence is a template filled only with verified invoice
 * data, and the user sees the draft before anything is sent to PayPal.
 *
 * A hosted model can replace LocalDraftProvider behind this interface without
 * touching PayPal or store code. Any such provider MUST return drafts for
 * human review first and MUST NOT invent amounts, dates, or client details.
 */
import { daysBetween, formatMoney, todayIso, type FollowUp, type InvoiceDraft, type InvoiceRecord, type RiskSummary } from "./types.js";

export interface DraftProvider {
  /** One-line, client-ready description for the invoice, from the draft's work items. May be async (hosted model). */
  invoiceDescription(draft: InvoiceDraft): string | Promise<string>;
  followUp(invoice: InvoiceRecord, today: string): FollowUp;
  riskSummary(invoices: InvoiceRecord[], today: string): RiskSummary;
}

/**
 * Hosted-model draft provider. POSTs the verified draft (client, items,
 * total, currency — never credentials) to a caller-configured endpoint and
 * requires a short, non-empty description back. Any failure, empty reply, or
 * over-long reply THROWS — it never silently falls back to the local engine,
 * so a failed model call can never be mistaken for a successful one.
 * Tone selection and risk summary stay deterministic (LocalDraftProvider):
 * a model writes prose, it does not decide amounts, dates, or escalation.
 * NOT configured in this build: no endpoint or key was supplied, so this
 * class is untested against a real model and must be enabled + demoed by
 * Mir before submission if a hosted model is to be claimed.
 */
export class HttpDraftProvider implements DraftProvider {
  private readonly local = new LocalDraftProvider();

  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    const isLoopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(endpoint);
    if (!endpoint.startsWith("https://") && !isLoopback) {
      throw new Error("HttpDraftProvider requires an https:// endpoint (loopback http is allowed for local testing only).");
    }
  }

  async invoiceDescription(draft: InvoiceDraft): Promise<string> {
    const res = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        task: "invoice_description",
        clientName: draft.clientName,
        items: draft.items,
        totalCents: draft.totalCents,
        currency: draft.currency,
        sourceText: draft.sourceText,
      }),
      // 180s, not 8s: a hosted model behind the adapter can take ~40-60s on
      // the free tier (measured 2026-10-30: 36.9s and 57.8s for 200s from Gemini).
      // The local deterministic path never touches this timeout.
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`AI draft provider failed (HTTP ${res.status}). No description was generated.`);
    const data = (await res.json()) as { description?: unknown };
    if (typeof data.description !== "string" || !data.description.trim() || data.description.length > 500) {
      throw new Error("AI draft provider returned an invalid description (empty or over 500 characters).");
    }
    return data.description.trim();
  }

  followUp(invoice: InvoiceRecord, today: string): FollowUp {
    return this.local.followUp(invoice, today);
  }

  riskSummary(invoices: InvoiceRecord[], today: string): RiskSummary {
    return this.local.riskSummary(invoices, today);
  }
}

/** Select the draft provider. Default is always the local deterministic engine. */
export function createDraftProvider(env: NodeJS.ProcessEnv = process.env): DraftProvider {
  if (env.AI_DRAFT_ENDPOINT) return new HttpDraftProvider(env.AI_DRAFT_ENDPOINT, env.AI_DRAFT_API_KEY);
  return new LocalDraftProvider();
}

export function followUpTone(daysOverdue: number): FollowUp["tone"] {
  if (daysOverdue <= 0) return "polite";
  if (daysOverdue <= 7) return "polite";
  if (daysOverdue <= 30) return "firm";
  return "final";
}

export class LocalDraftProvider implements DraftProvider {
  invoiceDescription(draft: InvoiceDraft): string {
    if (draft.items.length === 1) return draft.items[0].description;
    return draft.items.map((i) => `${i.description} (${formatMoney(i.amountCents, draft.currency)})`).join("; ");
  }

  followUp(invoice: InvoiceRecord, today: string = todayIso()): FollowUp {
    const daysOverdue = Math.max(0, daysBetween(invoice.dueDate, today));
    const tone = followUpTone(daysOverdue);
    const amount = formatMoney(invoice.totalCents, invoice.currency);
    const linkLine = invoice.paymentLink
      ? `You can pay here: ${invoice.paymentLink}`
      : "Your payment link is on the invoice I sent.";
    const firstName = invoice.clientName.split(" ")[0] || invoice.clientName;
    const base = `Hi ${firstName},\n\nI hope you're well. I'm writing about invoice ${invoice.number} for ${amount}, for ${invoice.description}, which was due on ${invoice.dueDate}.`;
    const bodies: Record<FollowUp["tone"], string> = {
      polite: `${base}\n\nThis is a friendly reminder in case it slipped through — no worries if so. ${linkLine}\n\nIf you've already paid, please ignore this note, and thank you. If there's anything about the work you'd like to discuss, just reply to this email.\n\nThanks so much,\n`,
      firm: `${base}\n\nIt's now ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue. Could you please let me know when I can expect payment, or if there's a problem I can help with? ${linkLine}\n\nI'd appreciate an update this week so I can plan accordingly.\n\nThank you,\n`,
      final: `${base}\n\nIt's now ${daysOverdue} days overdue, and I haven't heard back on my earlier reminders. Please pay ${amount} as soon as possible, or reply with a payment date. ${linkLine}\n\nIf payment isn't possible right now, please tell me so we can agree a payment plan — I'd much rather sort this out directly.\n\nThank you,\n`,
    };
    const subjects: Record<FollowUp["tone"], string> = {
      polite: `Friendly reminder: invoice ${invoice.number} for ${amount}`,
      firm: `Follow-up: invoice ${invoice.number} for ${amount} is ${daysOverdue} days overdue`,
      final: `Final reminder: invoice ${invoice.number} for ${amount} — payment needed`,
    };
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      tone,
      daysOverdue,
      subject: subjects[tone],
      body: bodies[tone],
      recommendedAction:
        tone === "polite"
          ? "Send this reminder as-is. No further action unless it stays unpaid past its due date."
          : tone === "firm"
            ? "Send this reminder and diary a check in 7 days. If the client replies with a date, record it — do not send another reminder before then."
            : "Send this final reminder, then decide whether to pause further work for this client until payment or a payment plan is agreed.",
    };
  }

  riskSummary(invoices: InvoiceRecord[], today: string = todayIso()): RiskSummary {
    const unpaid = invoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE");
    const overdue = unpaid.filter((i) => daysBetween(i.dueDate, today) > 0);
    const paid = invoices.filter((i) => i.status === "PAID");
    const outstanding = unpaid.reduce((s, i) => s + i.totalCents, 0);
    const overdueTotal = overdue.reduce((s, i) => s + i.totalCents, 0);
    const oldestOverdueDays = overdue.length
      ? Math.max(...overdue.map((i) => daysBetween(i.dueDate, today)))
      : null;
    const byClient = new Map<string, number>();
    for (const i of unpaid) byClient.set(i.clientName, (byClient.get(i.clientName) ?? 0) + i.totalCents);
    let largestDebtor: string | null = null;
    let largestCents = 0;
    for (const [name, cents] of byClient) if (cents > largestCents) { largestCents = cents; largestDebtor = name; }
    const share = outstanding > 0 ? Math.round((largestCents / outstanding) * 100) : 0;
    const currency = invoices[0]?.currency ?? "USD";
    if (invoices.length === 0) {
      return {
        totalOutstandingCents: outstanding, totalOverdueCents: overdueTotal,
        overdueCount: 0, unpaidCount: 0, paidCount: 0, oldestOverdueDays: null,
        largestDebtorSharePct: 0, largestDebtor: null,
        summary: "No invoices on record yet.",
        recommendedAction: "Draft your first invoice from plain language as work is done.",
        asOf: today,
      };
    }
    const summary = unpaid.length === 0
      ? "Nothing outstanding. Every invoice on record is paid or cancelled."
      : `${unpaid.length} invoice(s) unpaid totalling ${formatMoney(outstanding, currency)}, of which ${overdue.length} overdue totalling ${formatMoney(overdueTotal, currency)}.${oldestOverdueDays !== null ? ` The oldest overdue invoice is ${oldestOverdueDays} days past due.` : ""}${largestDebtor ? ` ${largestDebtor} owes the largest share (${share}%).` : ""}`;
    return {
      totalOutstandingCents: outstanding,
      totalOverdueCents: overdueTotal,
      overdueCount: overdue.length,
      unpaidCount: unpaid.length,
      paidCount: paid.length,
      oldestOverdueDays,
      largestDebtorSharePct: share,
      largestDebtor,
      summary,
      recommendedAction: overdue.length
        ? "Start with the oldest overdue invoice: send its follow-up draft, then work forward by due date."
        : unpaid.length
          ? "No invoices are overdue yet. Send a polite reminder on the due date for any invoice that remains unpaid."
          : "No action needed. Keep drafting new invoices from plain language as work is done.",
      asOf: today,
    };
  }
}
