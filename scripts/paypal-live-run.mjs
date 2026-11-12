// Live PayPal sandbox run for InvoicePilot. Reads credentials ONLY from the
// repo .env file at runtime. NEVER prints token, client id, or secret values.
// Prints only: HTTP statuses, sandbox invoice ids, PayPal statuses, link
// rels/hosts, scope strings, and sanitized error text.
import { readFileSync } from "node:fs";
import { LivePayPalSandbox } from "/home/hatch/workspace/paypal-invoicepilot/src/paypal/live.ts";

const env = {};
for (const line of readFileSync("/home/hatch/workspace/paypal-invoicepilot/.env", "utf8").split("\n")) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}
const BASE = "https://api-m.sandbox.paypal.com";
const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
const invoiceNumber = `LIVE-${stamp}`;
console.log("INVOICE_NUMBER", invoiceNumber);

// Step 0: OAuth (direct, to observe scope). Token value never printed.
const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
const tokRes = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
const tokJson = await tokRes.json().catch(() => ({}));
console.log("OAUTH_HTTP", tokRes.status);
console.log("OAUTH_TOKEN_TYPE", tokJson.token_type ?? null);
console.log("OAUTH_EXPIRES_IN", tokJson.expires_in ?? null);
console.log("OAUTH_SCOPE", tokJson.scope ?? null);
console.log("OAUTH_APP_ID_PRESENT", typeof tokJson.app_id === "string");
if (!tokRes.ok) { console.log("OAUTH_FAILED_STOP"); process.exit(1); }
const token = tokJson.access_token;

const client = new LivePayPalSandbox(env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET, env.PAYPAL_BASE_URL || BASE);
const input = {
  clientName: "Acme Studio",
  clientEmail: "billing@acme.example",
  description: "Logo design",
  items: [{ description: "Logo design", quantity: 1, unitAmountCents: 80000, amountCents: 80000 }],
  totalCents: 80000, currency: "USD", dueDate: "2026-11-13", invoiceNumber,
};

// Step 1: create (draft) via the existing live client.
let created;
try {
  created = await client.createInvoice(input);
  console.log("CREATE_OK", JSON.stringify(created));
} catch (e) {
  console.log("CREATE_FAILED", String(e?.message ?? e).slice(0, 500));
  process.exit(1);
}
const id = created.paypalInvoiceId;

// Step 2: raw GET right after create (read-only) — full shape, keys only.
const getRaw = async (label) => {
  const r = await fetch(`${BASE}/v2/invoicing/invoices/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json().catch(() => null);
  console.log(`${label}_HTTP`, r.status);
  if (j) {
    console.log(`${label}_STATUS`, j.status ?? null);
    console.log(`${label}_TOP_KEYS`, Object.keys(j).join(","));
    console.log(`${label}_INVOICER_PRESENT`, "invoicer" in j, "INVOICER_KEYS", j.invoicer ? Object.keys(j.invoicer).join(",") : null);
    console.log(`${label}_DETAIL_KEYS`, j.detail ? Object.keys(j.detail).join(",") : null);
    console.log(`${label}_LINKS`, Array.isArray(j.links) ? j.links.map((l) => `${l.rel} -> ${(l.href ?? "").split("#")[0]}`).join(" | ") : null);
    const pv = Array.isArray(j.links) ? j.links.find((l) => l.rel === "payer-view") : null;
    console.log(`${label}_PAYER_VIEW_PRESENT`, !!pv);
    if (pv) console.log(`${label}_PAYER_VIEW`, pv.href);
  } else console.log(`${label}_NO_JSON`);
  return j;
};
await getRaw("GET_AFTER_CREATE");

// Step 3: send via the existing live client.
let sent;
try {
  sent = await client.sendInvoice(id);
  console.log("SEND_OK", JSON.stringify(sent));
} catch (e) {
  console.log("SEND_FAILED", String(e?.message ?? e).slice(0, 500));
}
await getRaw("GET_AFTER_SEND");

// Step 4: GET via the existing live client (confirm).
try {
  const got = await client.getInvoice(id);
  console.log("CLIENT_GET_OK", JSON.stringify(got));
} catch (e) {
  console.log("CLIENT_GET_FAILED", String(e?.message ?? e).slice(0, 500));
}

// Step 5a: idempotency probe — repeat CREATE with the same invoice_number.
try {
  const dup = await client.createInvoice(input);
  console.log("REPEAT_CREATE_OK", JSON.stringify(dup));
} catch (e) {
  console.log("REPEAT_CREATE_FAILED", String(e?.message ?? e).slice(0, 500));
}

// Step 5b: idempotency probe — repeat SEND on the already-sent invoice (raw, to see shape).
{
  const r = await fetch(`${BASE}/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ send_to_recipient: true, send_to_invoicer: false }),
  });
  const t = await r.text();
  console.log("REPEAT_SEND_HTTP", r.status);
  console.log("REPEAT_SEND_BODY", t.slice(0, 500));
}
console.log("LIVE_RUN_DONE");
