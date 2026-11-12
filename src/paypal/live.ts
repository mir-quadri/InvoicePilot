/**
 * LIVE PayPal sandbox client — Invoicing API v2, SANDBOX ONLY.
 *
 * Live sandbox runs are recorded in docs/LIVE-RUN-EVIDENCE.md; the mock
 * sandbox remains the default when PAYPAL_MODE is not live-sandbox.
 * To run it live:
 *   1. Create a FREE PayPal Developer account and a sandbox app (test accounts only).
 *   2. Set PAYPAL_MODE=live-sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET.
 *   3. Never set a production base URL — this client accepts exactly one
 *      host (api-m.sandbox.paypal.com) and refuses everything else.
 *
 * OAuth: client-credentials grant, access token cached until expiry.
 * API surface used: POST /v2/invoicing/invoices (draft), POST /v2/invoicing/invoices/{id}/send,
 * GET /v2/invoicing/invoices/{id}. Amounts are converted from integer cents.
 * Errors from PayPal are surfaced with their name/message; no credentials are logged.
 *
 * SHAPE FIXES (2026-10-26, from the PayPal Developer sample request and
 * API reference — still NOT validated against a real sandbox call):
 * - billing_info.name is an object {given_name, surname}, not a plain
 *   string (the old code sent the full name as a string).
 * - detail.payment_term carries term_type DUE_ON_DATE_SPECIFIED plus
 *   due_date, and detail.invoice_date is sent (the old code sent only due_date).
 * - invoicer is OMITTED rather than sent as an empty object: the sample
 *   shows a populated invoicer, and {} is not a documented valid shape.
 *   PayPal is expected to default the invoicer to the authenticated
 *   sandbox account — this is UNVALIDATED until a real sandbox run.
 * - Items carry unit_of_measure QUANTITY, as in the sample.
 * - Send: the documented responses conflict (a 200 with invoice info vs a
 *   202 with a payer-view href object), and neither reliably carries the
 *   invoice id. The code therefore trusts the id it asked to send, takes
 *   the payment link from a payer-view href if one is present, and treats
 *   any 2xx (including an empty 204) as sent. It never reads data.id.
 * - Get: PayPal's status enum is far wider than DRAFT/SENT/PAID
 *   (SCHEDULED, SHARED, PAYMENT_PENDING, PARTIALLY_PAID, UNPAID,
 *   MARKED_AS_PAID, PAID_EXTERNAL, CANCELLED, AUTO_CANCELLED, REFUNDED,
 *   PARTIALLY_REFUNDED, MARKED_AS_REFUNDED, REFUNDED_EXTERNAL). The old
 *   code collapsed everything except PAID/SENT to DRAFT, so a cancelled
 *   invoice looked like a fresh draft. Now: paid variants -> PAID,
 *   cancelled/refunded variants -> CANCELLED, everything unpaid -> SENT.
 *   PARTIALLY_PAID therefore stays SENT (unpaid), and the partial amount
 *   is NOT tracked — a remaining gap, documented here, not hidden.
 * - Fractional quantities are sent as a decimal string (e.g. "2.5");
 *   whether PayPal accepts non-integer quantities is UNVALIDATED.
 *
 * LIVE-OBSERVED 2026-10-30 (sandbox): the token carries the invoicing scope
 * (dashboard toggle enabled); create returns 201 with a self-link object only
 * ({rel, method, href}) — the id is extracted from the href path, never by
 * fetching that href; invoicer omission is accepted (draft retrievable,
 * invoicer stored as {}).
 * STILL UNVALIDATED: send-response shape, fractional quantity strings, and
 * idempotency: create sends NO PayPal-Request-Id header, so a timed-out
 * create must NOT be blindly retried — check PayPal first, or a duplicate
 * draft may be created.
 */
import type { PayPalClient, PayPalInvoiceInput, PayPalInvoiceResult } from "./types.js";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Split "Acme Studio" into PayPal's name object. A single token becomes
 * given_name only; an empty surname is omitted, never sent as "". */
export function splitPayPalName(fullName: string): { given_name: string; surname?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const given_name = parts[0] ?? "";
  const surname = parts.slice(1).join(" ") || undefined;
  return surname ? { given_name, surname } : { given_name };
}

/** Map PayPal's full invoice-status enum onto this app's four states.
 * Unpaid states (including PARTIALLY_PAID) map to SENT, never to PAID or DRAFT. */
export function mapPayPalStatus(status: string): PayPalInvoiceResult["status"] {
  if (status === "PAID" || status === "MARKED_AS_PAID" || status === "PAID_EXTERNAL") return "PAID";
  if (
    status === "CANCELLED" || status === "AUTO_CANCELLED" ||
    status === "REFUNDED" || status === "PARTIALLY_REFUNDED" ||
    status === "MARKED_AS_REFUNDED" || status === "REFUNDED_EXTERNAL"
  ) return "CANCELLED";
  if (status === "DRAFT") return "DRAFT";
  return "SENT";
}

/** Extract a created invoice id from a PayPal create response.
 * Live sandbox shape (observed 2026-10-30): create returns 201 with a link
 * object only ({rel: "self", method: "GET", href: ".../invoices/INV2-..."}),
 * NOT the full invoice resource — so the id comes from the self href path,
 * never by fetching that href (its host sits outside this client's
 * allowlist). Also accepts a full-resource body (data.id) and a links[]
 * self entry. */
export function extractInvoiceId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { id?: unknown; href?: unknown; links?: unknown };
  if (typeof d.id === "string" && d.id) return d.id;
  const fromHref = (href: unknown): string | null => {
    if (typeof href !== "string") return null;
    const m = href.match(/\/v2\/invoicing\/invoices\/([^/?#]+)/);
    return m ? m[1] : null;
  };
  const viaHref = fromHref(d.href);
  if (viaHref) return viaHref;
  if (Array.isArray(d.links)) {
    for (const l of d.links) {
      if (l && typeof l === "object" && (l as { rel?: unknown }).rel === "self") {
        const id = fromHref((l as { href?: unknown }).href);
        if (id) return id;
      }
    }
  }
  return null;
}

/** Extract a payer-view payment link from a PayPal response, if present.
 * Handles both a top-level href and a links[] array with rel "payer-view". */
export function extractPayerLink(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { href?: unknown; links?: unknown };
  if (typeof d.href === "string" && d.href) return d.href;
  if (Array.isArray(d.links)) {
    const link = d.links.find(
      (l): l is { rel: string; href: string } =>
        !!l && typeof l === "object" && (l as { rel?: unknown }).rel === "payer-view" && typeof (l as { href?: unknown }).href === "string",
    );
    if (link) return link.href;
  }
  return null;
}

export class LivePayPalSandbox implements PayPalClient {
  readonly mode = "live-sandbox" as const;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private readonly baseUrl: string;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    baseUrl: string | undefined = SANDBOX_BASE,
  ) {
    // Exact allowlist, not a substring check: "sandbox" appearing anywhere
    // in a host (e.g. evil-sandbox.example.com) must never be accepted.
    const normalized = baseUrl.replace(/\/+$/, "");
    if (normalized !== SANDBOX_BASE) {
      throw new Error(`LivePayPalSandbox accepts only ${SANDBOX_BASE}. Sandbox only.`);
    }
    this.baseUrl = normalized;
    if (!clientId || !clientSecret) throw new Error("LivePayPalSandbox needs sandbox client ID and secret.");
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`PayPal sandbox OAuth failed (HTTP ${res.status}). Check sandbox credentials.`);
    const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string" || !data.access_token) {
      throw new Error("PayPal sandbox OAuth returned no access token.");
    }
    const expiresIn = typeof data.expires_in === "number" && data.expires_in > 60 ? data.expires_in : 3600;
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
    return this.token;
  }

  private async call<T>(path: string, method: string, body?: unknown): Promise<T | undefined> {
    const token = await this.accessToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PayPal sandbox API ${method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    return JSON.parse(text) as T;
  }

  async createInvoice(input: PayPalInvoiceInput): Promise<PayPalInvoiceResult> {
    const body = {
      detail: {
        invoice_number: input.invoiceNumber,
        reference: input.description.slice(0, 120),
        invoice_date: todayIso(),
        currency_code: input.currency,
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: input.dueDate },
      },
      // No invoicer object: PayPal defaults it to the authenticated sandbox
      // account. Sending {} is not a documented valid shape. UNVALIDATED.
      primary_recipients: [{ billing_info: { name: splitPayPalName(input.clientName), email_address: input.clientEmail } }],
      items: input.items.map((item) => ({
        name: item.description.slice(0, 120),
        quantity: String(item.quantity),
        unit_amount: { currency_code: input.currency, value: centsToValue(item.unitAmountCents) },
        unit_of_measure: "QUANTITY",
      })),
    };
    const data = await this.call<unknown>(`/v2/invoicing/invoices`, "POST", body);
    const paypalInvoiceId = extractInvoiceId(data);
    if (!paypalInvoiceId) {
      throw new Error("PayPal sandbox create returned no invoice id. The draft may or may not exist — check PayPal before retrying.");
    }
    return { paypalInvoiceId, status: "DRAFT", paymentLink: null, mock: false };
  }

  async sendInvoice(paypalInvoiceId: string): Promise<PayPalInvoiceResult> {
    // Any 2xx (200 invoice info, 202 payer-view href, or 204 empty) means
    // sent. Never trust a returned id — use the id that was asked to send.
    const data = await this.call<unknown>(
      `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/send`,
      "POST",
      { send_to_recipient: true, send_to_invoicer: false },
    );
    return { paypalInvoiceId, status: "SENT", paymentLink: extractPayerLink(data), mock: false };
  }

  async getInvoice(paypalInvoiceId: string): Promise<PayPalInvoiceResult> {
    const data = await this.call<{ id?: unknown; status?: unknown }>(
      `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}`,
      "GET",
    );
    if (!data || typeof data.id !== "string" || !data.id || typeof data.status !== "string") {
      throw new Error("PayPal sandbox get returned an unexpected response (missing id or status).");
    }
    return { paypalInvoiceId: data.id, status: mapPayPalStatus(data.status), paymentLink: extractPayerLink(data), mock: false };
  }
}
