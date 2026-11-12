/** Select the PayPal client from the environment. Default is always the mock. */
import { LivePayPalSandbox } from "./live.js";
import { MockPayPalSandbox } from "./mock.js";
import type { PayPalClient } from "./types.js";

export function createPayPalClient(env: NodeJS.ProcessEnv = process.env): PayPalClient {
  if (env.PAYPAL_MODE === "live-sandbox") {
    const id = env.PAYPAL_CLIENT_ID ?? "";
    const secret = env.PAYPAL_CLIENT_SECRET ?? "";
    if (!id || !secret) {
      throw new Error(
        "PAYPAL_MODE=live-sandbox needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app only). " +
          "Remove PAYPAL_MODE to use the mock sandbox.",
      );
    }
    return new LivePayPalSandbox(id, secret, env.PAYPAL_BASE_URL);
  }
  return new MockPayPalSandbox();
}

export { LivePayPalSandbox } from "./live.js";
export { MockPayPalSandbox } from "./mock.js";
export type { PayPalClient, PayPalInvoiceInput, PayPalInvoiceResult } from "./types.js";
