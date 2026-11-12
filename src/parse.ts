/**
 * Free-text invoice parser — the deterministic front end of the drafting agent.
 *
 * It extracts only what the text actually says: a client, an email, amounts,
 * a currency, a due term, and work items. Anything it cannot find is reported
 * in `missingFields` instead of invented. A hosted LLM can replace this step
 * behind the DraftProvider interface (see drafting.ts); the parser is the
 * auditable fallback that always runs first, and its output is what the user
 * confirms before any PayPal call is made.
 */
import { addDaysIso, type Currency, type InvoiceDraft, type InvoiceItem, isValidEmail, todayIso } from "./types.js";

const CURRENCIES: Record<string, Currency> = {
  $: "USD", usd: "USD", dollars: "USD", dollar: "USD",
  "£": "GBP", gbp: "GBP", pounds: "GBP",
  "€": "EUR", eur: "EUR", euros: "EUR",
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const m = /^(\d+(?:\.\d{1,2})?)$/.exec(cleaned);
  if (!m) return null;
  const cents = Math.round(parseFloat(m[1]) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/**
 * Find amounts in text. Supports "$1,200", "1200 dollars", "£850.50",
 * "at $90 an hour for 10 hours" (hourly -> line total).
 */
interface FoundAmount { cents: number; currency: Currency; hourly: boolean; hours: number | null; index: number; }

function findAmounts(text: string): FoundAmount[] {
  const out: FoundAmount[] = [];
  // Hourly first: "$90 an hour for 10 hours" — its $90 must not be kept as a
  // separate flat amount at the same position (that would double-count it).
  const hourlyIndices = new Set<number>();
  const hourlyRe = /([$£€])\s*(\d+(?:\.\d{1,2})?)\s*(?:\/|per|an)\s*hour[^.]*?(\d+(?:\.\d{1,2})?)\s*hours?/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hourlyRe.exec(text)) !== null) {
    const rate = parseAmountToCents(hm[2]);
    const hours = parseFloat(hm[3]);
    if (rate !== null && hours > 0) {
      hourlyIndices.add(hm.index);
      out.push({ cents: Math.round(rate * hours), currency: CURRENCIES[hm[1]], hourly: true, hours, index: hm.index });
    }
  }
  // $1,200 / £850.50 / €300 — symbol first
  const symRe = /([$£€])\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = symRe.exec(text)) !== null) {
    if (hourlyIndices.has(m.index)) continue;
    const cents = parseAmountToCents(m[2]);
    if (cents !== null) out.push({ cents, currency: CURRENCIES[m[1]], hourly: false, hours: null, index: m.index });
  }
  // 1200 dollars / 850 GBP — number first, currency word after
  const wordRe = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(usd|dollars?|gbp|pounds?|eur|euros?)\b/gi;
  while ((m = wordRe.exec(text)) !== null) {
    const cents = parseAmountToCents(m[1]);
    if (cents !== null) out.push({ cents, currency: CURRENCIES[m[2].toLowerCase()], hourly: false, hours: null, index: m.index });
  }
  // De-duplicate by index; prefer the hourly total over a flat amount at the same position.
  const seen = new Set<number>();
  return out.filter((a) => (seen.has(a.index) ? false : (seen.add(a.index), true))).sort((a, b) => a.index - b.index);
}

function findClientName(text: string): string | null {
  // Keywords are case-insensitive ([Ii]nvoice etc.); the NAME words stay
  // capital-only so "Acme Studio for logo design" stops at "Studio".
  const patterns = [
    /\b[Ff]or\s+([A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3})\b/,
    /\b[Tt]o\s+([A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3})\b/,
    /\b[Cc]lient\s+([A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3})\b/,
    /\b[Ii]nvoice\s+([A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3})\b/,
    /\b[Bb]ill\s+([A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const name = m[1].replace(/[.,;]+$/, "").trim();
      // Reject generic words captured as names.
      if (!/^(the|a|an|my|this|work|logo|website|design)$/i.test(name)) return name;
    }
  }
  return null;
}

function findDue(text: string, today: string): { dueDays: number | null; dueDate: string | null } {
  const net = /\bnet\s*(\d{1,3})\b/i.exec(text);
  if (net) {
    const days = parseInt(net[1], 10);
    if (days > 0 && days <= 365) return { dueDays: days, dueDate: addDaysIso(today, days) };
  }
  const inDays = /\bin\s+(\d{1,3})\s+days?\b/i.exec(text);
  if (inDays) {
    const days = parseInt(inDays[1], 10);
    if (days > 0 && days <= 365) return { dueDays: days, dueDate: addDaysIso(today, days) };
  }
  const weeks = /\bin\s+(\d{1,2})\s+weeks?\b/i.exec(text);
  if (weeks) {
    const days = parseInt(weeks[1], 10) * 7;
    return { dueDays: days, dueDate: addDaysIso(today, days) };
  }
  if (/\bdue\s+(today|now|immediately|on receipt)\b/i.test(text)) {
    return { dueDays: 0, dueDate: today };
  }
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso && !Number.isNaN(Date.parse(iso[1]))) return { dueDays: null, dueDate: iso[1] };
  return { dueDays: null, dueDate: null };
}

function splitWorkItems(text: string): string[] {
  // Strip the client/email/amount clauses so the remainder reads as the work.
  let rest = text
    .replace(EMAIL_RE, " ")
    .replace(/\$[0-9,]+(?:\.\d{1,2})?/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:usd|dollars?|gbp|pounds?|eur|euros?)\b/gi, " ")
    // Strip the leading "Invoice <Client> for" / "Bill <Client>" clause and due terms.
    .replace(/^\s*(?:invoice|bill)\s+[A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,3}\s+for\s+/i, "")
    .replace(/^\s*(?:invoice|bill)\s+/i, "")
    .replace(/\bnet\s*\d+\b/gi, " ")
    .replace(/\bdue\s+(?:in\s+)?\d+\s*(?:days?|weeks?)\b/gi, " ")
    .replace(/\bin\s+\d+\s*(?:days?|weeks?)\b/gi, " ")
    .replace(/\bdue\s+\d{4}-\d{2}-\d{2}\b/gi, " ")
    .replace(/\$?\d+(?:\.\d+)?\s*(?:an|per|\/)\s*hour[^,;]*/gi, " ");
  // Keep the sentence(s) describing the work; split lists on commas/semicolons/" and ".
  const parts = rest.split(/[;]+|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const cleaned = parts
    .map((p) => p.replace(/^(invoice|bill|charge|for|to)\s+/i, "").replace(/\s+/g, " ").trim())
    .map((p) => p.replace(/^(a|an|the)\s+/i, ""))
    .filter((p) => p.length >= 3 && !/^(net \d+|in \d+ days?)$/i.test(p));
  return cleaned.length ? cleaned : [text.trim()];
}

export function parseFreeText(text: string, today: string = todayIso()): InvoiceDraft {
  const sourceText = text.trim();
  const understood: string[] = [];
  const missingFields: string[] = [];

  const emailMatch = EMAIL_RE.exec(sourceText);
  const clientEmail = emailMatch ? emailMatch[0] : "";
  if (clientEmail && !isValidEmail(clientEmail)) missingFields.push("clientEmail");

  const clientName = findClientName(sourceText);
  const amounts = findAmounts(sourceText);
  const hourly = amounts.find((a) => a.hourly);
  // Prefer an hourly total when present (it is the most specific amount), else the largest amount.
  // NOTE: sort a COPY. amounts is in text order and the multi-item branch below pairs
  // amounts[i] with workParts[i] in that order; sorting in place used to reverse
  // multi-item pairings ("logo $200 and hosting $800" became $800/$200).
  const chosen = hourly ?? [...amounts].sort((a, b) => b.cents - a.cents)[0];
  const currency: Currency = chosen?.currency ?? "USD";
  // Mixed currencies cannot be represented in a single-currency draft, and
  // silently relabelling one currency's amounts as another's would be wrong.
  // Reject the draft for creation instead: no items, total 0, and a
  // "currency" missing field the user can fix by using one currency.
  const mixedCurrency = new Set(amounts.map((a) => a.currency)).size > 1;
  const workParts = splitWorkItems(sourceText);

  const items: InvoiceItem[] = [];
  if (chosen && !mixedCurrency) {
    const desc = workParts[0] ? sentenceCase(workParts[0]) : "Work done";
    if (hourly && hourly.hours) {
      // Self-consistent under the fractional-quantity rounding rule
      // (see types.ts): rate rounded to whole cents first, then the line
      // amount is Math.round(rate x hours), so the item always passes the
      // totals validation the agent and server enforce.
      const rateCents = Math.round(chosen.cents / hourly.hours);
      const amountCents = Math.round(rateCents * hourly.hours);
      items.push({ description: `${desc} — ${hourly.hours} hours at ${rateCents / 100} ${currency}/hour`, quantity: hourly.hours, unitAmountCents: rateCents, amountCents });
    } else if (workParts.length > 1 && amounts.length > 1) {
      // Multiple amounts + multiple work parts: pair them in TEXT order, capped at the amounts found.
      workParts.slice(0, amounts.length).forEach((part, i) => {
        items.push({ description: sentenceCase(part), quantity: 1, unitAmountCents: amounts[i].cents, amountCents: amounts[i].cents });
      });
    } else {
      items.push({ description: desc, quantity: 1, unitAmountCents: chosen.cents, amountCents: chosen.cents });
    }
  }
  const totalCents = items.reduce((s, i) => s + i.amountCents, 0);

  const { dueDays, dueDate } = findDue(sourceText, today);
  const effectiveDueDate = dueDate ?? addDaysIso(today, 30);
  const effectiveDueDays = dueDays ?? 30;

  if (clientName) understood.push(`Client: ${clientName}`);
  if (clientEmail) understood.push(`Client email: ${clientEmail}`);
  if (chosen && !mixedCurrency) understood.push(`Total: ${totalCents / 100} ${currency}`);
  if (mixedCurrency) understood.push("Mixed currencies found — use a single currency per invoice.");
  understood.push(`Due: ${effectiveDueDate}${dueDate ? "" : " (default net 30 — not stated)"}`);

  if (!clientName) missingFields.push("clientName");
  if (!clientEmail) missingFields.push("clientEmail");
  if (!chosen) missingFields.push("amount");
  if (mixedCurrency) missingFields.push("currency");
  if (items.length === 0) missingFields.push("items");

  return {
    clientName: clientName ?? "",
    clientEmail,
    description: workParts.join("; "),
    items,
    totalCents,
    currency,
    dueDate: effectiveDueDate,
    dueDays: effectiveDueDays,
    missingFields,
    understood,
    sourceText,
  };
}

function sentenceCase(s: string): string {
  const t = s.trim().replace(/[.;,]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
