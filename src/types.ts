/** Shared types. Money is integer minor units (cents) — never floats. */

export type Currency = "USD" | "GBP" | "EUR";

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
}

export interface InvoiceDraft {
  clientName: string;
  clientEmail: string;
  description: string;
  items: InvoiceItem[];
  totalCents: number;
  currency: Currency;
  /** ISO date (YYYY-MM-DD) the invoice is due, or null when not stated. */
  dueDate: string | null;
  /** Payment terms in days, when stated or defaulted. */
  dueDays: number | null;
  /** Fields the free text did not supply; invoice creation is blocked until filled. */
  missingFields: string[];
  /** What the parser understood, in plain language, for the user to confirm. */
  understood: string[];
  /** Raw free text, kept so a human can audit the draft against what was said. */
  sourceText: string;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "CANCELLED";

export interface InvoiceRecord {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string;
  description: string;
  items: InvoiceItem[];
  totalCents: number;
  currency: Currency;
  dueDate: string;
  /** PayPal invoice id (mock id in mock mode, real sandbox id in live mode), or null before creation. */
  paypalInvoiceId: string | null;
  /** Payment link returned by PayPal (mock link in mock mode). Null before sending. */
  paymentLink: string | null;
  status: InvoiceStatus;
  /** True only when the record came from the mock sandbox. */
  mock: boolean;
  remindersSent: number;
  createdAt: string;
  paidAt: string | null;
}

export interface FollowUp {
  invoiceId: string;
  invoiceNumber: string;
  tone: "polite" | "firm" | "final";
  daysOverdue: number;
  subject: string;
  body: string;
  /** What the agent recommends doing next, in plain language. */
  recommendedAction: string;
}

export interface RiskSummary {
  totalOutstandingCents: number;
  totalOverdueCents: number;
  overdueCount: number;
  unpaidCount: number;
  paidCount: number;
  oldestOverdueDays: number | null;
  /** Share of outstanding money owed by the single largest debtor, 0–100. */
  largestDebtorSharePct: number;
  largestDebtor: string | null;
  summary: string;
  recommendedAction: string;
  /** ISO date the summary was computed against (injected for tests). */
  asOf: string;
}

export function formatMoney(cents: number, currency: Currency): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
  return `${sign}${symbol}${(abs / 100).toFixed(2)}`;
}

/** Rounding rule for fractional quantities (e.g. fractional hours).
 *
 * A line amount is always the unit amount rounded to whole cents, then
 * multiplied: amountCents = Math.round(quantity * unitAmountCents). The
 * parser follows the same rule for hourly work: it rounds the hourly rate
 * to whole cents first, then sets the line amount to
 * Math.round(rateCents * hours). So a fractional-hours line can differ by
 * a cent or two from the raw rate x hours product in the text — that
 * rounded amount is what the preview shows, and it is what the total
 * must match. See draftTotalError. */
export const FRACTIONAL_QUANTITY_ROUNDING_RULE =
  "Line amount = Math.round(quantity x unit amount in cents); the total must equal the sum of the rounded line amounts.";

/** Returns an error message when a draft's money does not add up, else null.
 * Used by both the agent (before any PayPal call) and the server schema, so
 * a hand-edited draft cannot bypass the check through the API. */
export function draftTotalError(draft: { items: InvoiceItem[]; totalCents: number }): string | null {
  for (const item of draft.items) {
    const expected = Math.round(item.quantity * item.unitAmountCents);
    if (item.amountCents !== expected) {
      return `Line item "${item.description}" amount ${item.amountCents} does not equal quantity x unit amount (${expected}). ${FRACTIONAL_QUANTITY_ROUNDING_RULE}`;
    }
  }
  const sum = draft.items.reduce((s, i) => s + i.amountCents, 0);
  if (sum !== draft.totalCents) {
    return `Invoice total ${draft.totalCents} does not match the sum of line items ${sum}.`;
  }
  return null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Today in UTC, YYYY-MM-DD. Injectable "today" is passed explicitly everywhere else. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T00:00:00.000Z`).getTime() - new Date(`${fromIso}T00:00:00.000Z`).getTime();
  return Math.round(ms / 86_400_000);
}
