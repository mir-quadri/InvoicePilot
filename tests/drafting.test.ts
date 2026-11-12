import { describe, expect, it } from "vitest";
import { LocalDraftProvider, followUpTone } from "../src/drafting.js";
import type { InvoiceRecord } from "../src/types.js";

function record(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: "inv_inv-0001", number: "INV-0001", clientName: "Acme Studio", clientEmail: "billing@acme.example",
    description: "Logo design", items: [{ description: "Logo design", quantity: 1, unitAmountCents: 80000, amountCents: 80000 }],
    totalCents: 80000, currency: "USD", dueDate: "2026-10-20", paypalInvoiceId: "MOCK-INV-0001",
    paymentLink: "mock-sandbox://invoice/MOCK-INV-0001", status: "OVERDUE", mock: true,
    remindersSent: 0, createdAt: "2026-10-01T00:00:00.000Z", paidAt: null, ...over,
  };
}

describe("follow-up tone", () => {
  it("escalates polite -> firm -> final with days overdue", () => {
    expect(followUpTone(0)).toBe("polite");
    expect(followUpTone(7)).toBe("polite");
    expect(followUpTone(8)).toBe("firm");
    expect(followUpTone(30)).toBe("firm");
    expect(followUpTone(31)).toBe("final");
  });

  it("never threatens and always includes amount, due date and link", () => {
    const f = new LocalDraftProvider().followUp(record(), "2026-10-26");
    expect(f.tone).toBe("polite"); // 6 days overdue
    expect(f.body).toContain("$800.00");
    expect(f.body).toContain("2026-10-20");
    expect(f.body).toContain("mock-sandbox://invoice/MOCK-INV-0001");
    expect(f.body.toLowerCase()).not.toMatch(/legal|debt collector|court|sue/);
  });

  it("uses a final tone and a payment plan offer after 30 days", () => {
    const f = new LocalDraftProvider().followUp(record({ dueDate: "2026-09-01" }), "2026-10-26");
    expect(f.tone).toBe("final");
    expect(f.body).toContain("payment plan");
  });
});

describe("risk summary", () => {
  it("sums outstanding and overdue, and names the largest debtor", () => {
    const s = new LocalDraftProvider().riskSummary([
      record(),
      record({ id: "inv_inv-0002", number: "INV-0002", clientName: "Beta Ltd", totalCents: 20000, dueDate: "2026-12-01", status: "SENT" }),
      record({ id: "inv_inv-0003", number: "INV-0003", clientName: "Acme Studio", totalCents: 5000, status: "PAID", paidAt: "2026-10-10T00:00:00.000Z" }),
    ], "2026-10-26");
    expect(s.totalOutstandingCents).toBe(100000);
    expect(s.totalOverdueCents).toBe(80000);
    expect(s.overdueCount).toBe(1);
    expect(s.paidCount).toBe(1);
    expect(s.largestDebtor).toBe("Acme Studio");
    expect(s.largestDebtorSharePct).toBe(80);
    expect(s.oldestOverdueDays).toBe(6);
  });

  it("reports nothing outstanding when all are paid", () => {
    const s = new LocalDraftProvider().riskSummary([record({ status: "PAID", paidAt: "2026-10-10T00:00:00.000Z" })], "2026-10-26");
    expect(s.totalOutstandingCents).toBe(0);
    expect(s.summary).toContain("Nothing outstanding");
  });
});
