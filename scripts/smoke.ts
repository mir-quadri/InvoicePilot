/** Smoke: boots the server on a test port and runs the headline mock flow. */
import type { Server } from "node:http";
import { app } from "../src/server.js";

const server: Server = app.listen(0, async () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = (await (await fetch(`${base}/health`)).json()) as any;
    if (!health.ok || health.paypalMode !== "mock") throw new Error(`Unexpected health: ${JSON.stringify(health)}`);
    const draft = (await (await fetch(`${base}/api/invoices/draft`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Invoice Acme Studio for logo design, $800, net 14, billing@acme.example" }),
    })).json()) as any;
    if (draft.draft.totalCents !== 80000) throw new Error("Draft total wrong");
    const created = (await (await fetch(`${base}/api/invoices`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: draft.draft }),
    })).json()) as any;
    if (!created.invoice.paypalInvoiceId?.startsWith("MOCK-INV-")) throw new Error("Expected a mock PayPal id");
    const sent = (await (await fetch(`${base}/api/invoices/${created.invoice.id}/send`, { method: "POST" })).json()) as any;
    if (sent.invoice.status !== "SENT" || !sent.invoice.paymentLink?.startsWith("mock-sandbox://")) throw new Error("Send failed");
    console.log("Smoke PASSED: draft -> mock PayPal create -> send -> mock payment link. No real money, no PayPal network call.");
  } catch (err) {
    console.error("Smoke FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
