/** In-memory invoice store. Restart clears it — by design for a demo, and stated in the README. */
import type { InvoiceRecord } from "./types.js";

export class InvoiceStore {
  private records: InvoiceRecord[] = [];
  private seq = 0;

  nextNumber(): string {
    this.seq += 1;
    return `INV-${String(this.seq).padStart(4, "0")}`;
  }

  add(record: InvoiceRecord): InvoiceRecord {
    this.records.push(record);
    return record;
  }

  get(id: string): InvoiceRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  list(): InvoiceRecord[] {
    return [...this.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  update(id: string, patch: Partial<InvoiceRecord>): InvoiceRecord | undefined {
    const rec = this.get(id);
    if (!rec) return undefined;
    Object.assign(rec, patch);
    return rec;
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
  }

  get count(): number {
    return this.records.length;
  }
}
