import { describe, expect, it } from "vitest";
import { createAgent } from "../src/server.js";

/** Startup configuration must fail loudly and be labelled by step —
 * never silently downgrade to mock/local, and never mislabel a draft
 * problem as a PayPal problem. These tests call createAgent directly
 * with explicit env objects (process.env is never mutated). */
describe("startup configuration (createAgent)", () => {
  it("defaults to the mock sandbox with the local drafting engine", () => {
    const agent = createAgent({});
    expect(agent.paypalMode).toBe("mock");
  });

  it("labels a live-sandbox misconfiguration as a PayPal error and throws", () => {
    expect(() => createAgent({ PAYPAL_MODE: "live-sandbox" })).toThrow(/PayPal configuration error/);
  });

  it("labels a bad draft endpoint as a draft-provider error, not a PayPal error", () => {
    expect(() => createAgent({ AI_DRAFT_ENDPOINT: "http://example.com/draft" })).toThrow(/Draft provider configuration error/);
    expect(() => createAgent({ AI_DRAFT_ENDPOINT: "http://example.com/draft" })).not.toThrow(/PayPal/);
  });

  it("rejects a non-sandbox PayPal host, including sandbox-substring hosts", () => {
    expect(() => createAgent({
      PAYPAL_MODE: "live-sandbox",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret",
      PAYPAL_BASE_URL: "https://evil-sandbox.example.com",
    })).toThrow(/PayPal configuration error/);
    expect(() => createAgent({
      PAYPAL_MODE: "live-sandbox",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret",
      PAYPAL_BASE_URL: "https://api-m.paypal.com",
    })).toThrow(/PayPal configuration error/);
  });
});
