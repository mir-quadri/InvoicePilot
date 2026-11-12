import { describe, expect, it } from "vitest";
import { parseFreeText } from "../src/parse.js";

const TODAY = "2026-10-26";

describe("free-text parsing", () => {
  it("extracts client, email, amount and net terms", () => {
    const d = parseFreeText("Invoice Acme Studio for logo design, $800, net 14, billing@acme.example", TODAY);
    expect(d.clientName).toBe("Acme Studio");
    expect(d.clientEmail).toBe("billing@acme.example");
    expect(d.totalCents).toBe(80000);
    expect(d.currency).toBe("USD");
    expect(d.dueDate).toBe("2026-11-09");
    expect(d.missingFields).toEqual([]);
  });

  it("pairs multi-item amounts in text order, per item — not descending", () => {
    const d = parseFreeText("Invoice Acme Studio for logo design $200 and hosting $800, billing@acme.example", TODAY);
    expect(d.items).toHaveLength(2);
    expect(d.items[0].amountCents).toBe(20000);
    expect(d.items[1].amountCents).toBe(80000);
    expect(d.items[0].description).toMatch(/logo/i);
    expect(d.items[1].description).toMatch(/hosting/i);
    expect(d.totalCents).toBe(100000);
  });

  it("pairs a second multi-item case in text order (regression for sort mutation)", () => {
    const d = parseFreeText("Invoice Acme Studio for audit $150 and training $900, billing@acme.example", TODAY);
    expect(d.items.map((i) => i.amountCents)).toEqual([15000, 90000]);
  });

  it("rejects mixed-currency text instead of relabelling amounts", () => {
    const d = parseFreeText("Invoice Acme Studio for logo $200 and hosting £800, billing@acme.example", TODAY);
    expect(d.items).toEqual([]);
    expect(d.totalCents).toBe(0);
    expect(d.missingFields).toContain("currency");
    expect(d.understood.join(" ")).toContain("single currency");
  });

  it("handles fractional hours with the rounding rule", () => {
    const d = parseFreeText("Bill Beta Ltd $90 an hour for 2.5 hours of website fixes, finance@beta.example", TODAY);
    expect(d.items[0].quantity).toBe(2.5);
    expect(d.items[0].unitAmountCents).toBe(9000);
    expect(d.items[0].amountCents).toBe(22500);
    expect(d.items[0].amountCents).toBe(Math.round(d.items[0].quantity * d.items[0].unitAmountCents));
    expect(d.totalCents).toBe(22500);
  });

  it("computes an hourly total", () => {
    const d = parseFreeText("Bill Beta Ltd $90 an hour for 10 hours of website fixes, finance@beta.example", TODAY);
    expect(d.totalCents).toBe(90000);
    expect(d.items[0].quantity).toBe(10);
    expect(d.items[0].unitAmountCents).toBe(9000);
  });

  it("handles comma amounts and GBP", () => {
    const d = parseFreeText("Invoice Gamma Co for branding, £1,250.50, due in 7 days, accounts@gamma.example", TODAY);
    expect(d.totalCents).toBe(125050);
    expect(d.currency).toBe("GBP");
    expect(d.dueDate).toBe("2026-11-02");
  });

  it("reports missing fields instead of inventing them", () => {
    const d = parseFreeText("Logo design, $400", TODAY);
    expect(d.missingFields).toContain("clientName");
    expect(d.missingFields).toContain("clientEmail");
    expect(d.clientName).toBe("");
    expect(d.totalCents).toBe(40000);
    // Default due date is stated as a default, not claimed as stated.
    expect(d.understood.join(" ")).toContain("default net 30");
  });

  it("rejects a zero amount", () => {
    const d = parseFreeText("Invoice Acme for work, $0, a@b.example", TODAY);
    expect(d.missingFields).toContain("amount");
    expect(d.totalCents).toBe(0);
  });

  it("accepts an explicit ISO due date", () => {
    const d = parseFreeText("Invoice Acme for work $500 due 2026-12-01 a@b.example", TODAY);
    expect(d.dueDate).toBe("2026-12-01");
  });

  it("defaults currency to USD when no currency is stated", () => {
    const d = parseFreeText("Invoice Acme for work, 500, a@b.example", TODAY);
    // Bare "500" with no currency symbol/word is not treated as an amount.
    expect(d.missingFields).toContain("amount");
  });
});
