import { describe, expect, it } from "vitest";
import { InvoicePilotAgent, deriveStatus } from "../src/agent/agent.js";
import { MockPayPalSandbox } from "../src/paypal/mock.js";
import { InvoiceStore } from "../src/store.js";

const TODAY = "2026-10-26";

function agent() {
  return new InvoicePilotAgent({ paypal: new MockPayPalSandbox(), store: new InvoiceStore(), today: TODAY });
}

describe("agent lifecycle (mock PayPal)", () => {
  it("draft -> create (PayPal DRAFT) -> send -> paid, with mock ids only", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo design, $800, net 14, billing@acme.example");
    const created = await a.createInvoice(draft);
    expect(created.status).toBe("DRAFT");
    expect(created.paypalInvoiceId).toMatch(/^MOCK-INV-/);
    expect(created.mock).toBe(true);
    expect(created.paymentLink).toBeNull();
    const sent = await a.sendInvoice(created.id);
    expect(sent.status).toBe("SENT");
    expect(sent.paymentLink).toMatch(/^mock-sandbox:\/\//);
    const paid = a.markPaid(created.id);
    expect(paid.status).toBe("PAID");
  });

  it("refuses to create an invoice with missing client/email/amount", async () => {
    const a = agent();
    const draft = a.draftFromText("Logo design, $400");
    await expect(a.createInvoice(draft)).rejects.toThrow(/email/);
    const noAmount = a.draftFromText("Invoice Acme for work, billing@acme.example");
    await expect(a.createInvoice(noAmount)).rejects.toThrow(/amount/);
  });

  it("allows the user to fill missing fields via overrides", async () => {
    const a = agent();
    const draft = a.draftFromText("Logo design, $400");
    const created = await a.createInvoice(draft, { clientName: "Acme Studio", clientEmail: "billing@acme.example" });
    expect(created.clientName).toBe("Acme Studio");
    expect(created.totalCents).toBe(40000);
  });

  it("rejects a draft whose total does not match its line items", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo design, $800, net 14, billing@acme.example");
    await expect(a.createInvoice({ ...draft, totalCents: 79900 })).rejects.toThrow(/does not match the sum/);
  });

  it("rejects a draft whose line amount does not equal quantity x unit amount", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo design, $800, net 14, billing@acme.example");
    const bad = { ...draft, items: [{ ...draft.items[0], quantity: 2, unitAmountCents: 40000, amountCents: 70000 }] };
    await expect(a.createInvoice(bad)).rejects.toThrow(/quantity x unit amount/);
  });

  it("refuses to create from a mixed-currency draft (no items, no total)", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo $200 and hosting £800, billing@acme.example");
    expect(draft.missingFields).toContain("currency");
    await expect(a.createInvoice(draft)).rejects.toThrow(/amount/);
  });

  it("derives OVERDUE from the due date without a PayPal status change", () => {
    expect(deriveStatus("SENT", "2026-10-20", TODAY)).toBe("OVERDUE");
    expect(deriveStatus("SENT", "2026-11-20", TODAY)).toBe("SENT");
    expect(deriveStatus("PAID", "2026-10-01", TODAY)).toBe("PAID");
  });

  it("refuses a follow-up for a draft and for a paid invoice", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo design, $800, net 14, billing@acme.example");
    const created = await a.createInvoice(draft);
    expect(() => a.followUp(created.id)).toThrow(/not been sent/);
    await a.sendInvoice(created.id);
    a.markPaid(created.id);
    expect(() => a.followUp(created.id)).toThrow(/paid/);
  });

  it("follow-up increments reminders and uses the overdue tone", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo design, $800, due 2026-10-01, billing@acme.example");
    const created = await a.createInvoice(draft);
    await a.sendInvoice(created.id);
    const f = a.followUp(created.id);
    expect(f.daysOverdue).toBe(25);
    expect(f.tone).toBe("firm");
    expect(a.get(created.id)?.remindersSent).toBe(1);
  });

  it("mock PayPal refuses to re-send a paid invoice and unknown ids", async () => {
    const mock = new MockPayPalSandbox();
    await expect(mock.sendInvoice("MOCK-INV-9999")).rejects.toThrow(/not found/);
    const created = await mock.createInvoice({
      clientName: "Acme", clientEmail: "a@b.example", description: "Work", items: [],
      totalCents: 100, currency: "USD", dueDate: "2026-11-01", invoiceNumber: "INV-0001",
    });
    expect(() => mock.markPaid(created.paypalInvoiceId)).toThrow(/must be sent/);
  });

  it("summary reflects the list", async () => {
    const a = agent();
    const draft = a.draftFromText("Invoice Acme Studio for logo design, $800, due 2026-10-01, billing@acme.example");
    const created = await a.createInvoice(draft);
    await a.sendInvoice(created.id);
    expect(a.summary().overdueCount).toBe(1);
    expect(a.summary().totalOverdueCents).toBe(80000);
  });
});
