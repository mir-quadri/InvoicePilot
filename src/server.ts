/**
 * InvoicePilot web app + agent API.
 * Sandbox only by default (mock PayPal). See README for live-sandbox setup.
 * No emails are sent by this server; follow-ups are drafts for the user.
 */
import express from "express";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { InvoicePilotAgent } from "./agent/agent.js";
import { createDraftProvider } from "./drafting.js";
import { createPayPalClient } from "./paypal/index.js";
import { draftTotalError, type InvoiceDraft } from "./types.js";

const draftSchema = z.object({
  clientName: z.string().max(120),
  clientEmail: z.string().max(120),
  description: z.string().max(500),
  items: z.array(z.object({
    description: z.string().min(1).max(200),
    quantity: z.number().positive().max(1000),
    unitAmountCents: z.number().int().positive().max(100_000_000),
    amountCents: z.number().int().positive().max(100_000_000),
  })).min(1).max(20),
  totalCents: z.number().int().positive().max(100_000_000),
  currency: z.enum(["USD", "GBP", "EUR"]),
  dueDate: z.string().nullable(),
  dueDays: z.number().int().nullable(),
  missingFields: z.array(z.string()),
  understood: z.array(z.string()),
  sourceText: z.string().max(2000),
}).superRefine((val, ctx) => {
  // Same totals rule as the agent, enforced at the API boundary so a
  // hand-edited draft cannot reach PayPal with mismatched money.
  const err = draftTotalError(val);
  if (err) ctx.addIssue({ code: "custom", message: err });
});

/** Build the agent from the environment, keeping each setup step separate
 * so a failure is labelled with the step that actually failed. In
 * particular a bad AI_DRAFT_ENDPOINT is a draft-provider error, never a
 * "PayPal configuration error", and neither failure is hidden by a
 * silent downgrade. Throws; the caller must not fall back to mock. */
export function createAgent(env: NodeJS.ProcessEnv = process.env): InvoicePilotAgent {
  let paypal;
  try {
    paypal = createPayPalClient(env);
  } catch (err) {
    throw new Error(`PayPal configuration error: ${err instanceof Error ? err.message : err}`);
  }
  let drafts;
  try {
    drafts = createDraftProvider(env);
  } catch (err) {
    throw new Error(`Draft provider configuration error: ${err instanceof Error ? err.message : err}`);
  }
  return new InvoicePilotAgent({ paypal, drafts });
}

let agent: InvoicePilotAgent;
try {
  agent = createAgent();
} catch (err) {
  // FAIL STARTUP LOUDLY. A PAYPAL_MODE=live-sandbox misconfiguration (or a
  // bad draft endpoint) must never silently start in mock/local mode and
  // let a user believe live PayPal is in use. Fix the environment and restart.
  console.error("==================================================================");
  console.error("[invoicepilot] FATAL — startup aborted, no fallback to mock mode.");
  console.error(`[invoicepilot] ${err instanceof Error ? err.message : err}`);
  console.error("==================================================================");
  throw err;
}

export const app = express();
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

function fail(res: express.Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "invoicepilot", version: "1.0.0", paypalMode: agent.paypalMode, sandboxOnly: true, invoices: agent.list().length });
});

app.post("/api/invoices/draft", (req, res) => {
  const parsed = z.object({ text: z.string().min(1).max(2000) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Provide 'text' describing the work done (max 2000 characters).");
  try {
    res.json({ draft: agent.draftFromText(parsed.data.text), paypalMode: agent.paypalMode });
  } catch (err) {
    fail(res, 400, err instanceof Error ? err.message : "Could not draft an invoice from that text.");
  }
});

app.post("/api/invoices", async (req, res) => {
  const parsed = z.object({
    draft: draftSchema,
    clientName: z.string().max(120).optional(),
    clientEmail: z.string().max(120).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid invoice draft. Draft first with POST /api/invoices/draft, then confirm the preview.");
  try {
    const invoice = await agent.createInvoice(parsed.data.draft as InvoiceDraft, {
      clientName: parsed.data.clientName, clientEmail: parsed.data.clientEmail, dueDate: parsed.data.dueDate,
    });
    res.status(201).json({ invoice, paypalMode: agent.paypalMode, note: "Created as a PayPal DRAFT. Send it from the dashboard to issue it to the client." });
  } catch (err) {
    fail(res, 400, err instanceof Error ? err.message : "Could not create the invoice.");
  }
});

app.get("/api/invoices", (_req, res) => {
  res.json({ invoices: agent.list(), paypalMode: agent.paypalMode });
});

app.get("/api/invoices/:id", (req, res) => {
  const rec = agent.get(req.params.id);
  if (!rec) return fail(res, 404, "Invoice not found.");
  res.json({ invoice: rec });
});

app.post("/api/invoices/:id/send", async (req, res) => {
  try {
    const invoice = await agent.sendInvoice(req.params.id);
    res.json({ invoice, note: "Sent via PayPal (mock link in mock mode). The client pays through PayPal; InvoicePilot never handles card details." });
  } catch (err) {
    fail(res, 400, err instanceof Error ? err.message : "Could not send the invoice.");
  }
});

app.post("/api/invoices/:id/mark-paid", (req, res) => {
  try {
    res.json({ invoice: agent.markPaid(req.params.id), note: "Mock-sandbox test helper only. In live mode this endpoint is refused." });
  } catch (err) {
    fail(res, 400, err instanceof Error ? err.message : "Could not mark the invoice paid.");
  }
});

app.post("/api/invoices/:id/follow-up", (req, res) => {
  try {
    res.json({ followUp: agent.followUp(req.params.id), note: "Draft only — InvoicePilot does not email the client. Copy, review, and send it yourself." });
  } catch (err) {
    fail(res, 400, err instanceof Error ? err.message : "Could not draft a follow-up.");
  }
});

app.get("/api/summary", (_req, res) => {
  res.json({ summary: agent.summary(), paypalMode: agent.paypalMode });
});

const here = path.dirname(fileURLToPath(import.meta.url));
app.use("/", express.static(path.resolve(here, "../public")));

app.use((err: unknown, _req: unknown, res: any, _next: unknown) => {
  console.error("[http] error:", err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(400).json({ error: "Request could not be processed." });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`InvoicePilot listening on http://localhost:${port} (PayPal mode: ${agent.paypalMode})`);
    console.log("Sandbox only. No real money moves. Default mode is the mock sandbox.");
  });
}
