/**
 * PayPal client interface. ALL tests and the default server run against
 * MockPayPalSandbox — no network, no credentials, no real money.
 * LivePayPalSandbox (live.ts) implements the same interface against the
 * PayPal Invoicing API v2 in the SANDBOX environment only, and is only
 * selected when PAYPAL_MODE=live-sandbox with sandbox credentials present.
 */
import type { Currency, InvoiceItem } from "../types.js";

export interface PayPalInvoiceInput {
  clientName: string;
  clientEmail: string;
  description: string;
  items: InvoiceItem[];
  totalCents: number;
  currency: Currency;
  dueDate: string;
  invoiceNumber: string;
}

export interface PayPalInvoiceResult {
  /** PayPal invoice id, or mock id in mock mode. */
  paypalInvoiceId: string;
  /** DRAFT/SENT/PAID, plus CANCELLED for PayPal cancelled/refunded states
   * (see mapPayPalStatus in live.ts — they must not collapse to DRAFT). */
  status: "DRAFT" | "SENT" | "PAID" | "CANCELLED";
  /** Payment link, or null until the invoice is sent. */
  paymentLink: string | null;
  mock: boolean;
}

export interface PayPalClient {
  readonly mode: "mock" | "live-sandbox";
  createInvoice(input: PayPalInvoiceInput): Promise<PayPalInvoiceResult>;
  sendInvoice(paypalInvoiceId: string): Promise<PayPalInvoiceResult>;
  getInvoice(paypalInvoiceId: string): Promise<PayPalInvoiceResult>;
}
