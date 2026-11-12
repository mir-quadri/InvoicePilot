/**
 * Gemini adapter for InvoicePilot (Option A) — local proxy used during the
 * recorded demo. SANDBOX/DEMO ONLY in the sense that it fronts a free-tier
 * Google AI Studio key; it never touches PayPal and never moves money.
 *
 * WHY THIS EXISTS: HttpDraftProvider (src/drafting.ts) POSTs
 *   { task, clientName, items, totalCents, currency, sourceText }
 * to AI_DRAFT_ENDPOINT and requires a non-empty, <=500-char { description }
 * JSON reply. No raw LLM endpoint satisfies that contract, so this adapter
 * translates: it takes that POST, asks Gemini for ONE line of invoice
 * description prose, validates the reply against the contract, and returns
 * { description }.
 *
 * SCOPE LOCK: the model writes ONLY the one-line invoice description.
 * Tone selection and risk summary stay deterministic in the app
 * (LocalDraftProvider, via HttpDraftProvider delegation) and are never
 * moved into the model. The prompt below never asks for tone, risk,
 * amounts, dates, or client details.
 *
 * MODEL: gemini-3.8-flash ONLY. gemini-2.0-flash is RETIRED (verified
 * 404 model-not-found) and must never be used here.
 *
 * CONTRACT ENFORCEMENT (chosen policy: REJECT, fail loudly):
 * - Empty description -> HTTP 502, no description field, no fallback text.
 * - Description over 500 chars -> HTTP 502, no description field.
 *   Nothing is truncated and nothing is invented: a bad model reply is an
 *   error the caller (HttpDraftProvider) surfaces, never a silent success.
 * - Any Gemini error (non-2xx, malformed reply, missing key) -> HTTP 502
 *   (or 500 for missing configuration) with a sanitized error message.
 *   The API key is NEVER logged, echoed, or included in any response.
 *
 * KEY HANDLING: the key is read at runtime from the AI_DRAFT_API_KEY
 * environment variable, or — if that is unset — from the repo-root .env
 * file (gitignored, 0600). It is never hardcoded and never printed.
 *
 * LATENCY: free-tier Gemini can take ~40-60s per call (measured 2026-10-30:
 * 36.9s and 57.8s for 200s; an earlier attempt returned 503 high-demand).
 * Both this adapter and HttpDraftProvider allow 180s per call for that reason.
 *
 * RUN (from the repo root; .env already holds AI_DRAFT_API_KEY):
 *   npx tsx src/gemini-adapter.ts
 *   # listens on http://127.0.0.1:3101/ (override with GEMINI_ADAPTER_PORT)
 *   # then, in a second terminal, run the app against it:
 *   AI_DRAFT_ENDPOINT=http://127.0.0.1:3101/ npm run dev
 *   # (AI_DRAFT_API_KEY stays in .env for the adapter; the app also sends
 *   # it as a Bearer token to the loopback adapter only, which ignores it.)
 * Or from the built output:  node dist/gemini-adapter.js
 * Default behaviour when AI_DRAFT_ENDPOINT is unset is unchanged: the app
 * uses the local deterministic drafting engine (see src/drafting.ts).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
export const MAX_DESCRIPTION_CHARS = 500;
export const DEFAULT_ADAPTER_PORT = 3101;

export interface DraftRequestItem {
  description: string;
  quantity?: number;
  unitAmountCents?: number;
  amountCents?: number;
}

export interface DraftRequestBody {
  task?: unknown;
  clientName?: unknown;
  items?: unknown;
  totalCents?: unknown;
  currency?: unknown;
  sourceText?: unknown;
}

/** Parse a simple KEY=VALUE .env file. Values are returned, never logged. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Resolve the Gemini API key: environment first, then repo-root .env. */
export function resolveGeminiApiKey(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
): string | null {
  if (env.AI_DRAFT_API_KEY) return env.AI_DRAFT_API_KEY;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Works from both src/ and dist/ (both sit one level below repo root).
    const envPath = path.resolve(here, "../.env");
    const parsed = parseEnvFile(readFile(envPath));
    return parsed.AI_DRAFT_API_KEY || null;
  } catch {
    return null;
  }
}

/** Build the prompt. Only work-item descriptions are supplied; the model is
 * told to write one line, and NOT to add amounts, dates, or client details,
 * and NOT to comment on tone or payment risk.
 * Note: the handler rejects empty-items requests with 400 before ever
 * building a prompt, so the "- (no item descriptions supplied)" fallback
 * below is unreachable from the HTTP path; it exists only for direct
 * buildGeminiPrompt callers. */
export function buildGeminiPrompt(body: DraftRequestBody): string {
  const items = Array.isArray(body.items) ? body.items : [];
  const lines = items
    .map((item) => {
      if (item && typeof item === "object" && typeof (item as DraftRequestItem).description === "string") {
        return `- ${(item as DraftRequestItem).description}`;
      }
      return null;
    })
    .filter((l): l is string => !!l);
  const work = lines.length > 0 ? lines.join("\n") : "- (no item descriptions supplied)";
  return [
    "Write a single one-line, client-ready invoice description summarising the work below.",
    "Rules: output ONLY the description text — no quotes, no markdown, no preamble, no extra lines.",
    "Do not add amounts, prices, dates, due terms, or client details. Do not mention tone, follow-up, or payment risk.",
    "Work items:",
    work,
  ].join("\n");
}

/** Join Gemini's candidate parts into plain text. Returns "" when absent. */
export function extractGeminiText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
    .join("");
}

/**
 * Enforce the { description } contract. Collapses newlines/extra whitespace
 * to a single line, then REJECTS (throws) on empty or >500 chars — never
 * truncates, never invents replacement text.
 */
export function validateDescription(raw: string): string {
  const description = raw.replace(/\s+/g, " ").trim();
  if (!description) {
    throw new Error("Gemini returned an empty description. No description was generated.");
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new Error(
      `Gemini returned a description over ${MAX_DESCRIPTION_CHARS} characters (${description.length}). No description was generated.`,
    );
  }
  return description;
}

export interface AdapterOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  /**
   * Model override, retained only so a caller that tries to override is
   * caught loudly: any value other than GEMINI_MODEL throws at handler
   * construction. gemini-2.0-flash (retired) can never become a call target.
   */
  model?: string;
}

/** True when the request carries at least one usable item description. */
export function hasUsableItemDescriptions(body: DraftRequestBody): boolean {
  if (!Array.isArray(body.items)) return false;
  return body.items.some(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as DraftRequestItem).description === "string" &&
      (item as DraftRequestItem).description.trim().length > 0,
  );
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** Build the adapter's HTTP handler. The Gemini key is used only in the
 * x-goog-api-key header of the outbound call — never in a URL, log, or reply. */
export function createGeminiAdapterHandler(options: AdapterOptions) {
  const fetchFn = options.fetchFn ?? fetch;
  // MODEL LOCK: the shipped entry point always uses gemini-3.8-flash.
  // Any in-process caller that tries to override with a different string
  // (including the retired gemini-2.0-flash) fails here, before any call.
  if (options.model !== undefined && options.model !== GEMINI_MODEL) {
    throw new Error(
      `Gemini adapter model is locked to ${GEMINI_MODEL}; refusing override "${options.model}".`,
    );
  }
  const model = GEMINI_MODEL;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Gemini adapter accepts POST only." });
      return;
    }
    let raw = "";
    try {
      for await (const chunk of req) raw += chunk;
    } catch {
      sendJson(res, 400, { error: "Could not read the draft request." });
      return;
    }
    let body: DraftRequestBody;
    try {
      body = JSON.parse(raw) as DraftRequestBody;
    } catch {
      sendJson(res, 400, { error: "Draft request was not valid JSON." });
      return;
    }
    if (body.task !== undefined && body.task !== "invoice_description") {
      sendJson(res, 400, { error: "Gemini adapter only handles task=invoice_description." });
      return;
    }
    // Never ask the model to summarise work that was never supplied:
    // empty items are a caller error, not a prompt for invention.
    if (!hasUsableItemDescriptions(body)) {
      sendJson(res, 400, { error: "No usable item descriptions supplied; cannot describe work that was not described." });
      return;
    }
    const prompt = buildGeminiPrompt(body);
    let geminiRes: Response;
    try {
      geminiRes = await fetchFn(`${GEMINI_API_BASE}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
        }),
        // Free-tier Gemini can take ~40-60s per call (measured 2026-10-30:
        // 36.9s and 57.8s for 200s). A short timeout would fail loud-but-uselessly
        // on every live call, so the adapter allows 180s. HttpDraftProvider
        // carries the same 180s allowance (see src/drafting.ts).
        signal: AbortSignal.timeout(180000),
      });
    } catch (err) {
      sendJson(res, 502, { error: `Gemini request failed: ${err instanceof Error ? err.message : "network error"}` });
      return;
    }
    if (!geminiRes.ok) {
      // Sanitize: forward only the status + a short, key-free error snippet.
      let detail = "";
      try {
        const text = await geminiRes.text();
        const parsed = JSON.parse(text) as { error?: { message?: unknown } };
        if (parsed && typeof parsed.error?.message === "string") detail = parsed.error.message.slice(0, 200);
      } catch {
        // Non-JSON error body: report the status only.
      }
      sendJson(res, 502, {
        error: detail
          ? `Gemini API failed (HTTP ${geminiRes.status}): ${detail}`
          : `Gemini API failed (HTTP ${geminiRes.status}). No description was generated.`,
      });
      return;
    }
    let data: unknown;
    try {
      data = await geminiRes.json();
    } catch {
      sendJson(res, 502, { error: "Gemini returned an unreadable response. No description was generated." });
      return;
    }
    let description: string;
    try {
      description = validateDescription(extractGeminiText(data));
    } catch (err) {
      sendJson(res, 502, { error: err instanceof Error ? err.message : "Invalid Gemini description." });
      return;
    }
    sendJson(res, 200, { description });
  };
}

export function startGeminiAdapter(
  options: AdapterOptions & { port?: number; host?: string },
): Server {
  const server = createServer(createGeminiAdapterHandler(options));
  const port = options.port ?? Number(process.env.GEMINI_ADAPTER_PORT ?? DEFAULT_ADAPTER_PORT);
  const host = options.host ?? "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`Gemini adapter listening on http://${host}:${port}/ (model ${GEMINI_MODEL})`);
    console.log("Point the app at it with AI_DRAFT_ENDPOINT=http://127.0.0.1:" + port + "/");
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    console.error("[gemini-adapter] FATAL — no AI_DRAFT_API_KEY in the environment or repo-root .env. Refusing to start.");
    process.exit(1);
  }
  startGeminiAdapter({ apiKey });
}
