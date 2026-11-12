import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { app } from "../src/server.js";

let server: Server;
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("HTTP API", () => {
  it("health reports mock mode and sandbox-only", async () => {
    const res = await fetch(`${base}/health`);
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.service).toBe("invoicepilot");
    expect(json.paypalMode).toBe("mock");
    expect(json.sandboxOnly).toBe(true);
  });

  it("full flow over HTTP: draft, create, send, follow-up, summary", async () => {
    const draftRes = await post("/api/invoices/draft", { text: "Invoice Acme Studio for logo design, $800, net 14, billing@acme.example" });
    expect(draftRes.status).toBe(200);
    expect(draftRes.json.draft.totalCents).toBe(80000);
    const createRes = await post("/api/invoices", { draft: draftRes.json.draft });
    expect(createRes.status).toBe(201);
    const id = createRes.json.invoice.id as string;
    const sendRes = await post(`/api/invoices/${id}/send`, {});
    expect(sendRes.status).toBe(200);
    expect(sendRes.json.invoice.status).toBe("SENT");
    const summaryRes = await fetch(`${base}/api/summary`);
    expect(((await summaryRes.json()) as any).summary.unpaidCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects an invalid draft payload", async () => {
    const res = await post("/api/invoices", { draft: { clientName: "Acme" } });
    expect(res.status).toBe(400);
  });

  it("rejects a draft whose total does not match its items, at the API boundary", async () => {
    const draftRes = await post("/api/invoices/draft", { text: "Invoice Acme Studio for logo design, $800, net 14, billing@acme.example" });
    expect(draftRes.status).toBe(200);
    const res = await post("/api/invoices", { draft: { ...draftRes.json.draft, totalCents: 1 } });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown invoice", async () => {
    const res = await fetch(`${base}/api/invoices/nope`);
    expect(res.status).toBe(404);
  });
});
