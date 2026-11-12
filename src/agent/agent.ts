/**
 * InvoicePilot agent: draft -> confirm -> PayPal create -> send -> chase.
 * No step is skipped silently: a draft with missing fields cannot be created,
 * a draft is never sent without the user confirming the preview, and a
 * follow-up is always returned as a draft for the user to send themselves —
 * InvoicePilot never emails anyone.
 */
import { LocalDraftProvider, type DraftProvider } from "../drafting.js";
import { parseFreeText } from "../parse.js";
import type { PayPalClient } from "../paypal/index.js";
import { MockPayPalSandbox } from "../paypal/mock.js";
import { InvoiceStore } from "../store.js";
import { daysBetween, draftTotalError, isValidEmail, todayIso, type FollowUp, type InvoiceDraft, type InvoiceRecord, type RiskSummary } from "../types.js";

export function deriveStatus(status: InvoiceRecord["status"], dueDate: string, today: string): InvoiceRecord["status"] {
  if (status === "SENT" && daysBetween(dueDate, today) > 0) return "OVERDUE";
  return status;
}

export interface AgentDeps {
  paypal: PayPalClient;
  store: InvoiceStore;
  drafts: DraftProvider;
  /** Injectable clock for tests. */
  today?: string;
}

export class InvoicePilotAgent {
  private readonly paypal: PayPalClient;
  private readonly store: InvoiceStore;
  private readonly drafts: DraftProvider;
  private readonly today: string;

  constructor(deps: Partial<AgentDeps> = {}) {
    this.paypal = deps.paypal ?? new MockPayPalSandbox();
    this.store = deps.store ?? new InvoiceStore();
    this.drafts = deps.drafts ?? new LocalDraftProvider();
    this.today = deps.today ?? todayIso();
  }

  get paypalMode(): string {
    return this.paypal.mode;
  }

  draftFromText(text: string): InvoiceDraft {
    if (!text || text.trim().length < 5) {
      throw new Error("Describe the work done — e.g. 'Invoice Acme Studio, logo design, $800, net 14, acme@example.com'.");
    }
    if (text.length > 2000) throw new Error("Description is too long (max 2000 characters).");
    return parseFreeText(text, this.today);
  }

  /** Create a PayPal invoice from a confirmed draft. Throws on missing/invalid fields. */
  async createInvoice(draft: InvoiceDraft, overrides: Partial<Pick<InvoiceDraft, "clientName" | "clientEmail" | "dueDate">> = {}): Promise<InvoiceRecord> {
    const clientName = (overrides.clientName ?? draft.clientName).trim();
    const clientEmail = (overrides.clientEmail ?? draft.clientEmail).trim();
    const dueDate = overrides.dueDate ?? draft.dueDate ?? "";
    const missing: string[] = [];
    if (!clientName) missing.push("client name");
    if (!isValidEmail(clientEmail)) missing.push("a valid client email");
    if (draft.items.length === 0 || draft.totalCents <= 0) missing.push("an amount greater than zero");
    if (!dueDate) missing.push("a due date");
    if (missing.length) {
      throw new Error(`Missing or invalid: ${missing.join(", ")} — not in the description. Add ${missing.join(" and ")} before creating the invoice.`);
    }
    // Totals must add up before anything reaches PayPal — the same check
    // the server schema enforces, so a hand-edited draft cannot bypass it.
    if (draft.items.length > 0) {
      const totalError = draftTotalError(draft);
      if (totalError) throw new Error(totalError);
    }
    if (this.store.count >= 200) throw new Error("Invoice limit reached (200). This demo store is capped; restart to clear it.");

    const number = this.store.nextNumber();
    const description = await this.drafts.invoiceDescription(draft);
    const created = await this.paypal.createInvoice({
      clientName, clientEmail, description,
      items: draft.items, totalCents: draft.totalCents, currency: draft.currency,
      dueDate, invoiceNumber: number,
    });
    const record: InvoiceRecord = {
      id: `inv_${number.toLowerCase()}`,
      number, clientName, clientEmail, description,
      items: draft.items, totalCents: draft.totalCents, currency: draft.currency,
      dueDate, paypalInvoiceId: created.paypalInvoiceId, paymentLink: created.paymentLink,
      status: "DRAFT", mock: created.mock, remindersSent: 0,
      createdAt: new Date().toISOString(), paidAt: null,
    };
    return this.store.add(record);
  }

  async sendInvoice(id: string): Promise<InvoiceRecord> {
    const rec = this.store.get(id);
    if (!rec) throw new Error(`Invoice not found: ${id}`);
    if (!rec.paypalInvoiceId) throw new Error("Invoice has no PayPal invoice id — it was not created in PayPal.");
    if (rec.status === "PAID") throw new Error("Invoice is already paid.");
    if (rec.status === "CANCELLED") throw new Error("Invoice is cancelled and cannot be sent.");
    if (rec.status === "SENT" || rec.status === "OVERDUE") return this.refresh(rec);
    const sent = await this.paypal.sendInvoice(rec.paypalInvoiceId);
    this.store.update(id, { status: "SENT", paymentLink: sent.paymentLink });
    return this.refresh(this.store.get(id)!);
  }

  /** Mock-only test helper: record a payment in the mock sandbox. Refused in live mode. */
  markPaid(id: string): InvoiceRecord {
    const rec = this.store.get(id);
    if (!rec) throw new Error(`Invoice not found: ${id}`);
    if (this.paypal.mode !== "mock" || !(this.paypal instanceof MockPayPalSandbox) || !rec.paypalInvoiceId) {
      throw new Error("markPaid is a mock-sandbox test helper only. In the live sandbox, payment is recorded when the payer pays via PayPal.");
    }
    this.paypal.markPaid(rec.paypalInvoiceId);
    this.store.update(id, { status: "PAID", paidAt: new Date().toISOString() });
    return this.store.get(id)!;
  }

  /** Refresh a record's PayPal status and derive OVERDUE from the due date. */
  async refresh(rec: InvoiceRecord): Promise<InvoiceRecord> {
    if (rec.paypalInvoiceId && (rec.status === "SENT" || rec.status === "OVERDUE" || rec.status === "DRAFT")) {
      try {
        const current = await this.paypal.getInvoice(rec.paypalInvoiceId);
        if (current.status === "PAID") {
          this.store.update(rec.id, { status: "PAID", paidAt: rec.paidAt ?? new Date().toISOString(), paymentLink: current.paymentLink ?? rec.paymentLink });
        } else if (current.status === "SENT") {
          this.store.update(rec.id, { status: "SENT", paymentLink: current.paymentLink ?? rec.paymentLink });
        } else if (current.status === "CANCELLED") {
          // PayPal cancelled/refunded states collapse to CANCELLED here:
          // the local record must not keep looking sendable or overdue.
          this.store.update(rec.id, { status: "CANCELLED", paymentLink: current.paymentLink ?? rec.paymentLink });
        }
      } catch {
        // PayPal unreachable: keep local state, do not invent a status.
      }
    }
    const fresh = this.store.get(rec.id)!;
    const derived = deriveStatus(fresh.status, fresh.dueDate, this.today);
    if (derived !== fresh.status) this.store.update(fresh.id, { status: derived });
    return this.store.get(rec.id)!;
  }

  list(): InvoiceRecord[] {
    return this.store.list().map((r) => {
      const derived = deriveStatus(r.status, r.dueDate, this.today);
      return derived === r.status ? r : { ...r, status: derived };
    });
  }

  get(id: string): InvoiceRecord | undefined {
    const rec = this.store.get(id);
    if (!rec) return undefined;
    const derived = deriveStatus(rec.status, rec.dueDate, this.today);
    return derived === rec.status ? rec : { ...rec, status: derived };
  }

  followUp(id: string): FollowUp {
    const rec = this.get(id);
    if (!rec) throw new Error(`Invoice not found: ${id}`);
    if (rec.status === "PAID") throw new Error("Invoice is paid — no follow-up is needed.");
    if (rec.status === "DRAFT") throw new Error("Invoice has not been sent yet — send it before chasing payment.");
    const followUp = this.drafts.followUp(rec, this.today);
    this.store.update(id, { remindersSent: rec.remindersSent + 1 });
    return followUp;
  }

  summary(): RiskSummary {
    return this.drafts.riskSummary(this.list(), this.today);
  }
}
