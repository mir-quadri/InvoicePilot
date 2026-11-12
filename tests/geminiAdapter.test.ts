import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGeminiPrompt,
  createGeminiAdapterHandler,
  extractGeminiText,
  GEMINI_MODEL,
  parseEnvFile,
  resolveGeminiApiKey,
  validateDescription,
} from "../src/gemini-adapter.js";
import { HttpDraftProvider } from "../src/drafting.js";
import type { InvoiceDraft } from "../src/types.js";

/** Mocked-Gemini adapter tests. No real Gemini call, no key material here:
 * the "key" below is a dummy string passed to a stub fetch, never sent
 * anywhere real. One optional live test is gated behind RUN_LIVE_GEMINI=1
 * and reads the real key from .env at runtime without printing it. */

function stubFetch(text: string, status = 200) {
  let seenUrl = "";
  let seenBody = "";
  let seenHeaders: Record<string, string> = {};
  const fn = (async (url: string, init: Record<string, unknown>) => {
    seenUrl = url;
    seenBody = typeof init.body === "string" ? init.body : "";
    seenHeaders = (init.headers as Record<string, string>) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return { fn, seen: () => ({ url: seenUrl, body: seenBody, headers: seenHeaders }) };
}

/** Stub whose .json() throws, simulating a malformed Gemini reply body. */
function stubFetchMalformedJson() {
  const fn = (async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError("Unexpected token"); },
    text: async () => "not-json{{{",
  })) as unknown as typeof fetch;
  return { fn };
}

const draftBody = {
  task: "invoice_description",
  clientName: "Acme Studio",
  items: [{ description: "Logo design", quantity: 1, unitAmountCents: 80000, amountCents: 80000 }],
  totalCents: 80000,
  currency: "USD",
  sourceText: "Invoice Acme Studio for logo design, $800",
};

let server: Server;
let base: string;
let geminiStub: ReturnType<typeof stubFetch>;

beforeAll(async () => {
  geminiStub = stubFetch(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Logo design — final files delivered" }] } }] }));
  server = createServer(createGeminiAdapterHandler({ apiKey: "dummy-test-key", fetchFn: geminiStub.fn }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    resolve();
  }));
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function postAdapter(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("Gemini adapter (mocked Gemini)", () => {
  it("targets gemini-3.8-flash only, never the retired 2.0 model", async () => {
    expect(GEMINI_MODEL).toBe("gemini-3.8-flash");
    await postAdapter(draftBody);
    const { url, body, headers } = geminiStub.seen();
    expect(url).toContain("gemini-3.8-flash");
    expect(url).not.toContain("gemini-2.0-flash");
    expect(body).not.toContain("gemini-2.0-flash");
  });

  it("sends the API key in the x-goog-api-key header, never in the URL", async () => {
    await postAdapter(draftBody);
    const { url, headers } = geminiStub.seen();
    expect(headers["x-goog-api-key"]).toBe("dummy-test-key");
    expect(url).not.toContain("dummy-test-key");
    expect(url).not.toContain("key=");
  });

  it("refuses any model override, including the retired gemini-2.0-flash", () => {
    expect(() => createGeminiAdapterHandler({ apiKey: "dummy-test-key", model: "gemini-2.0-flash" }))
      .toThrow(/locked to gemini-3\.8-flash/);
    expect(() => createGeminiAdapterHandler({ apiKey: "dummy-test-key", model: "some-other-model" }))
      .toThrow(/locked to gemini-3\.8-flash/);
    expect(() => createGeminiAdapterHandler({ apiKey: "dummy-test-key", model: "gemini-3.8-flash" }))
      .not.toThrow();
    expect(() => createGeminiAdapterHandler({ apiKey: "dummy-test-key" }))
      .not.toThrow();
  });

  it("returns 400 and never calls Gemini when no usable item descriptions exist", async () => {
    const guarded = stubFetch(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Invented work" }] } }] }));
    const srv = createServer(createGeminiAdapterHandler({ apiKey: "dummy-test-key", fetchFn: guarded.fn }));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const addr = srv.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      for (const badBody of [
        { ...draftBody, items: [] },
        { ...draftBody, items: [{ description: "   " }] },
        { ...draftBody, items: [{ quantity: 1 }] },
        { ...draftBody, items: undefined },
      ]) {
        const res = await fetch(`http://127.0.0.1:${port}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(badBody),
        });
        const json = (await res.json()) as Record<string, unknown>;
        expect(res.status).toBe(400);
        expect(json.description).toBeUndefined();
      }
      // Gemini was never consulted for any of the four requests.
      expect(guarded.seen().url).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("returns { description } from a mocked Gemini reply", async () => {
    const { status, json } = await postAdapter(draftBody);
    expect(status).toBe(200);
    expect(json.description).toBe("Logo design — final files delivered");
  });

  it("prompts for one line only and never asks for tone or risk", () => {
    const prompt = buildGeminiPrompt(draftBody);
    expect(prompt).toContain("Logo design");
    expect(prompt).toMatch(/one-line/i);
    // Tone/risk appear only as a prohibition ("Do not mention tone..."),
    // never as something the model is asked to produce.
    expect(prompt).toContain("Do not mention tone");
    expect(prompt).not.toMatch(/choose .* tone|write .* follow-up|summarise .* risk|payment-risk summary/i);
  });

  it("collapses a multi-line model reply to a single line", () => {
    expect(validateDescription("Logo design\n— final files\n delivered  ")).toBe("Logo design — final files delivered");
  });

  it("extracts joined candidate parts text", () => {
    expect(extractGeminiText({ candidates: [{ content: { parts: [{ text: "Logo " }, { text: "design" }] } }] })).toBe("Logo design");
    expect(extractGeminiText({ candidates: [] })).toBe("");
    expect(extractGeminiText({})).toBe("");
  });

  it("rejects (502, no description) on an empty Gemini reply — no invented fallback", async () => {
    const empty = createServer(createGeminiAdapterHandler({
      apiKey: "dummy-test-key",
      fetchFn: stubFetch(JSON.stringify({ candidates: [{ content: { parts: [{ text: "   " }] } }] })).fn,
    }));
    await new Promise<void>((r) => empty.listen(0, "127.0.0.1", r));
    const addr = empty.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(json.description).toBeUndefined();
    expect(json.error).toMatch(/empty/i);
    await new Promise<void>((resolve, reject) => empty.close((e) => (e ? reject(e) : resolve())));
  });

  it("rejects (502, no description) on an over-500-char reply — no silent truncation", async () => {
    expect(() => validateDescription("x".repeat(501))).toThrow(/over 500/);
    const long = createServer(createGeminiAdapterHandler({
      apiKey: "dummy-test-key",
      fetchFn: stubFetch(JSON.stringify({ candidates: [{ content: { parts: [{ text: "y".repeat(600) }] } }] })).fn,
    }));
    await new Promise<void>((r) => long.listen(0, "127.0.0.1", r));
    const addr = long.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(json.description).toBeUndefined();
    await new Promise<void>((resolve, reject) => long.close((e) => (e ? reject(e) : resolve())));
  });

  it("accepts an exactly-500-char reply (unit and HTTP boundary)", async () => {
    expect(validateDescription("x".repeat(500))).toBe("x".repeat(500));
    const exact = createServer(createGeminiAdapterHandler({
      apiKey: "dummy-test-key",
      fetchFn: stubFetch(JSON.stringify({ candidates: [{ content: { parts: [{ text: "z".repeat(500) }] } }] })).fn,
    }));
    await new Promise<void>((r) => exact.listen(0, "127.0.0.1", r));
    const addr = exact.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(json.description).toBe("z".repeat(500));
    expect((json.description as string).length).toBe(500);
    await new Promise<void>((resolve, reject) => exact.close((e) => (e ? reject(e) : resolve())));
  });

  it("returns 502 with no description on a malformed Gemini JSON reply", async () => {
    const bad = createServer(createGeminiAdapterHandler({
      apiKey: "dummy-test-key",
      fetchFn: stubFetchMalformedJson().fn,
    }));
    await new Promise<void>((r) => bad.listen(0, "127.0.0.1", r));
    const addr = bad.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(json.description).toBeUndefined();
    await new Promise<void>((resolve, reject) => bad.close((e) => (e ? reject(e) : resolve())));
  });

  it("returns 502 with no description when Gemini returns no candidates", async () => {
    const nocand = createServer(createGeminiAdapterHandler({
      apiKey: "dummy-test-key",
      fetchFn: stubFetch(JSON.stringify({})).fn,
    }));
    await new Promise<void>((r) => nocand.listen(0, "127.0.0.1", r));
    const addr = nocand.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(json.description).toBeUndefined();
    await new Promise<void>((resolve, reject) => nocand.close((e) => (e ? reject(e) : resolve())));
  });

  it("returns 502 with no description when the Gemini fetch rejects", async () => {
    const rejecting = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const down = createServer(createGeminiAdapterHandler({ apiKey: "dummy-test-key", fetchFn: rejecting }));
    await new Promise<void>((r) => down.listen(0, "127.0.0.1", r));
    const addr = down.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(json.description).toBeUndefined();
    await new Promise<void>((resolve, reject) => down.close((e) => (e ? reject(e) : resolve())));
  });

  it("fails loudly (502) on a Gemini error, with no description", async () => {
    const failing = createServer(createGeminiAdapterHandler({
      apiKey: "dummy-test-key",
      fetchFn: stubFetch(JSON.stringify({ error: { message: "API key not valid" } }), 400).fn,
    }));
    await new Promise<void>((r) => failing.listen(0, "127.0.0.1", r));
    const addr = failing.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(502);
    expect(json.description).toBeUndefined();
    expect(String(json.error)).toMatch(/400/);
    await new Promise<void>((resolve, reject) => failing.close((e) => (e ? reject(e) : resolve())));
  });

  it("parses .env files and prefers the environment key, without exposing values", () => {
    expect(parseEnvFile('A=1\n# comment\nAI_DRAFT_API_KEY="abc"\n')).toEqual({ A: "1", AI_DRAFT_API_KEY: "abc" });
    expect(resolveGeminiApiKey({ AI_DRAFT_API_KEY: "env-key" }, () => { throw new Error("no file"); })).toBe("env-key");
    expect(resolveGeminiApiKey({}, () => "AI_DRAFT_API_KEY=file-key\n")).toBe("file-key");
    expect(resolveGeminiApiKey({}, () => { throw new Error("missing"); })).toBeNull();
  });

  it("serves HttpDraftProvider end-to-end through the adapter (mocked Gemini)", async () => {
    const provider = new HttpDraftProvider(`${base}/`);
    const draft: InvoiceDraft = {
      clientName: "Acme Studio", clientEmail: "billing@acme.example", description: "Logo design",
      items: [{ description: "Logo design", quantity: 1, unitAmountCents: 80000, amountCents: 80000 }],
      totalCents: 80000, currency: "USD", dueDate: "2026-11-09", dueDays: 14,
      missingFields: [], understood: [], sourceText: "Invoice Acme Studio for logo design, $800",
    };
    await expect(provider.invoiceDescription(draft)).resolves.toBe("Logo design — final files delivered");
  });

  it("rejects non-POST and non-invoice_description requests", async () => {
    const get = await fetch(base);
    expect(get.status).toBe(405);
    const wrong = await postAdapter({ ...draftBody, task: "other" });
    expect(wrong.status).toBe(400);
  });
});

// Live Gemini check: opt-in only. Reads the key from the environment/.env
// at runtime (the runner must export it or have .env present) and prints
// NO key material — only the description length and a pass/fail verdict.
describe("Gemini adapter (live, opt-in only)", () => {
  it.skipIf(process.env.RUN_LIVE_GEMINI !== "1")("returns a real one-line description from gemini-3.8-flash", async () => {
    const key = resolveGeminiApiKey();
    expect(key, "AI_DRAFT_API_KEY must be present to run the live test").toBeTruthy();
    const handler = createGeminiAdapterHandler({ apiKey: key! });
    const live = createServer(handler);
    await new Promise<void>((r) => live.listen(0, "127.0.0.1", r));
    const addr = live.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody),
      });
      const json = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(typeof json.description).toBe("string");
      expect((json.description as string).length).toBeGreaterThan(0);
      expect((json.description as string).length).toBeLessThanOrEqual(500);
      expect(json.description).not.toContain("\n");
    } finally {
      await new Promise<void>((resolve, reject) => live.close((e) => (e ? reject(e) : resolve())));
    }
  }, 240000);
});
