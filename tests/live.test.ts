import { describe, expect, it } from "vitest";
import { extractInvoiceId, extractPayerLink, mapPayPalStatus, splitPayPalName } from "../src/paypal/live.js";

/** Pure shape helpers for the live PayPal client, tested against the
 * shapes in PayPal's Developer sample/reference docs plus shapes observed
 * in live sandbox runs (see docs/LIVE-RUN-EVIDENCE.md). These tests do NOT
 * run a live PayPal call: they pin the request/response shapes. */
describe("live PayPal shape helpers (docs only — no live call)", () => {
  it("splits a client name into PayPal's given_name/surname object", () => {
    expect(splitPayPalName("Acme Studio")).toEqual({ given_name: "Acme", surname: "Studio" });
    expect(splitPayPalName("Madonna")).toEqual({ given_name: "Madonna" });
    expect(splitPayPalName("Mary Jane Watson")).toEqual({ given_name: "Mary", surname: "Jane Watson" });
  });

  it("maps PayPal's full status enum without collapsing to DRAFT", () => {
    expect(mapPayPalStatus("DRAFT")).toBe("DRAFT");
    expect(mapPayPalStatus("SENT")).toBe("SENT");
    expect(mapPayPalStatus("PARTIALLY_PAID")).toBe("SENT");
    expect(mapPayPalStatus("SCHEDULED")).toBe("SENT");
    expect(mapPayPalStatus("UNPAID")).toBe("SENT");
    expect(mapPayPalStatus("PAID")).toBe("PAID");
    expect(mapPayPalStatus("MARKED_AS_PAID")).toBe("PAID");
    expect(mapPayPalStatus("PAID_EXTERNAL")).toBe("PAID");
    expect(mapPayPalStatus("CANCELLED")).toBe("CANCELLED");
    expect(mapPayPalStatus("REFUNDED")).toBe("CANCELLED");
    expect(mapPayPalStatus("PARTIALLY_REFUNDED")).toBe("CANCELLED");
  });

  it("extracts a created invoice id from the live link-only 201 shape", () => {
    // Live sandbox create (observed 2026-10-30): 201 + self-link object only.
    expect(extractInvoiceId({
      rel: "self", method: "GET",
      href: "https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-1234-EFGH-IJKL",
    })).toBe("INV2-ABCD-1234-EFGH-IJKL");
    // Full-resource body still wins when present.
    expect(extractInvoiceId({ id: "INV2-FULL-1", status: "DRAFT" })).toBe("INV2-FULL-1");
    // links[] self entry as a fallback.
    expect(extractInvoiceId({
      links: [
        { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-LINK-9", method: "GET" },
      ],
    })).toBe("INV2-LINK-9");
    expect(extractInvoiceId({})).toBeNull();
    expect(extractInvoiceId(undefined)).toBeNull();
    expect(extractInvoiceId({ href: "https://example.com/other" })).toBeNull();
    expect(extractInvoiceId({ id: 42 })).toBeNull();
  });

  it("extracts a payer-view link from a 202-style href response and from links[]", () => {
    expect(extractPayerLink({ href: "https://www.sandbox.paypal.com/invoice/p/#INV2-XYZ", rel: "payer-view", method: "GET" }))
      .toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-XYZ");
    expect(extractPayerLink({
      links: [
        { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-1", method: "GET" },
        { rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#INV2-1", method: "GET" },
      ],
    })).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-1");
    expect(extractPayerLink(undefined)).toBeNull();
    expect(extractPayerLink({})).toBeNull();
  });
});
