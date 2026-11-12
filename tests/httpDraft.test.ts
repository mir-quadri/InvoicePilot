import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpDraftProvider } from "../src/drafting.js";
import type { InvoiceDraft } from "../src/types.js";

const draft: InvoiceDraft = {
  clientName: "Acme Studio", clientEmail: "billing@acme.example", description: "Logo design",
  items: [{ description: "Logo design", quantity: 1, unitAmountCents: 80000, amountCents: 80000 }],
  totalCents: 80000, currency: "USD", dueDate: "2026-11-09", dueDays: 14,
  missingFields: [], understood: [], sourceText: "Invoice Acme Studio for logo design, $800",
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/ok") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ description: "Logo design — final files delivered" }));
      } else if (req.url === "/empty") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ description: "   " }));
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "boom" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    resolve();
  }));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("HttpDraftProvider (hosted-model integration point)", () => {
  it("requires https endpoints", () => {
    expect(() => new HttpDraftProvider("http://example.com")).toThrow(/https/);
  });

  it("returns the hosted model's description against a local stub", async () => {
    const p = new HttpDraftProvider(`${base}/ok`);
    await expect(p.invoiceDescription(draft)).resolves.toBe("Logo design — final files delivered");
  });

  it("throws on an error response instead of falling back silently", async () => {
    const p = new HttpDraftProvider(`${base}/fail`);
    await expect(p.invoiceDescription(draft)).rejects.toThrow(/HTTP 500/);
  });

  it("throws on an empty description instead of inventing one", async () => {
    const p = new HttpDraftProvider(`${base}/empty`);
    await expect(p.invoiceDescription(draft)).rejects.toThrow(/invalid description/);
  });

  it("keeps tone and risk deterministic by delegation", () => {
    const p = new HttpDraftProvider(`${base}/ok`);
    const rec = {
      id: "inv_inv-0001", number: "INV-0001", clientName: "Acme Studio", clientEmail: "billing@acme.example",
      description: "Logo design", items: draft.items, totalCents: 80000, currency: "USD" as const,
      dueDate: "2026-10-20", paypalInvoiceId: "MOCK-INV-0001", paymentLink: null, status: "OVERDUE" as const,
      mock: true, remindersSent: 0, createdAt: "2026-10-01T00:00:00.000Z", paidAt: null,
    };
    expect(p.followUp(rec, "2026-10-26").tone).toBe("polite");
  });
});
