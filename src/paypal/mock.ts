/**
 * Mock PayPal sandbox. Deterministic, in-memory, no network.
 * Ids are clearly mock ids (MOCK-INV-...) and payment links use a
 * mock-sandbox:// scheme so they can never be mistaken for real PayPal links.
 * markPaid() is a TEST helper only: in the live sandbox, payment happens when
 * the payer pays via PayPal; this app never records a payment it did not see.
 */
import type { PayPalClient, PayPalInvoiceInput, PayPalInvoiceResult } from "./types.js";

interface MockRecord { input: PayPalInvoiceInput; status: "DRAFT" | "SENT" | "PAID"; }

export class MockPayPalSandbox implements PayPalClient {
  readonly mode = "mock" as const;
  private seq = 0;
  private records = new Map<string, MockRecord>();

  async createInvoice(input: PayPalInvoiceInput): Promise<PayPalInvoiceResult> {
    this.seq += 1;
    const id = `MOCK-INV-${String(this.seq).padStart(4, "0")}`;
    this.records.set(id, { input, status: "DRAFT" });
    return { paypalInvoiceId: id, status: "DRAFT", paymentLink: null, mock: true };
  }

  async sendInvoice(paypalInvoiceId: string): Promise<PayPalInvoiceResult> {
    const rec = this.records.get(paypalInvoiceId);
    if (!rec) throw new Error(`Mock PayPal invoice not found: ${paypalInvoiceId}`);
    if (rec.status === "PAID") throw new Error("Mock PayPal invoice is already paid and cannot be re-sent.");
    rec.status = "SENT";
    return {
      paypalInvoiceId,
      status: "SENT",
      paymentLink: `mock-sandbox://invoice/${paypalInvoiceId}`,
      mock: true,
    };
  }

  async getInvoice(paypalInvoiceId: string): Promise<PayPalInvoiceResult> {
    const rec = this.records.get(paypalInvoiceId);
    if (!rec) throw new Error(`Mock PayPal invoice not found: ${paypalInvoiceId}`);
    return {
      paypalInvoiceId,
      status: rec.status,
      paymentLink: rec.status === "DRAFT" ? null : `mock-sandbox://invoice/${paypalInvoiceId}`,
      mock: true,
    };
  }

  /** Test/demo helper only. Not part of the PayPalClient interface. */
  markPaid(paypalInvoiceId: string): PayPalInvoiceResult {
    const rec = this.records.get(paypalInvoiceId);
    if (!rec) throw new Error(`Mock PayPal invoice not found: ${paypalInvoiceId}`);
    if (rec.status === "DRAFT") throw new Error("Mock PayPal invoice must be sent before it can be paid.");
    rec.status = "PAID";
    return { paypalInvoiceId, status: "PAID", paymentLink: `mock-sandbox://invoice/${paypalInvoiceId}`, mock: true };
  }
}
