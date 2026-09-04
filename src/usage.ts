import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, withFileLock } from "./persistence.js";

export interface EngineUsage {
  search: number;
  fetch: number;
  errors: number;
  /** Provider quota units; legacy records fall back to successful request count. */
  consumed?: number;
  lastError?: string;
  lastUsed?: string;
}

export type UsageFile = Record<string, Record<string, EngineUsage>>;

/** Lokale Verbrauchszähler pro Engine und Kalendermonat (UTC). */
export class UsageStore {
  private readonly file: string;
  private data: UsageFile = {};

  constructor(dir: string) {
    this.file = path.join(dir, "usage.json");
    this.load();
  }

  private load(): void {
    this.data = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      for (const [month, engines] of Object.entries(raw as Record<string, unknown>)) {
        if (!engines || typeof engines !== "object" || Array.isArray(engines)) continue;
        const cleanMonth: Record<string, EngineUsage> = {};
        for (const [engine, u] of Object.entries(engines as Record<string, unknown>)) {
          if (!u || typeof u !== "object") continue;
          const rec = u as Record<string, unknown>;
          // Krumme Zähler (NaN/Strings) würden pct = NaN erzeugen und die
          // Engine still aus der Rotation werfen — strikt säubern.
          const num = (v: unknown): number =>
            typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
          cleanMonth[engine] = {
            search: num(rec.search),
            fetch: num(rec.fetch),
            errors: num(rec.errors),
            consumed: typeof rec.consumed === "number" && Number.isFinite(rec.consumed) && rec.consumed >= 0
              ? rec.consumed : num(rec.search) + num(rec.fetch),
            lastError: typeof rec.lastError === "string" ? rec.lastError : undefined,
            lastUsed: typeof rec.lastUsed === "string" ? rec.lastUsed : undefined,
          };
        }
        this.data[month] = cleanMonth;
      }
    } catch (error) {
      // A missing or malformed snapshot may be initialized for compatibility.
      // Other I/O failures must abort the transaction, never erase counters.
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = {};
    }
  }

  monthKey(date = new Date()): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  /** Provider-local calendar day; Google uses America/Los_Angeles. */
  dayKey(date = new Date(), timeZone = "UTC"): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  record(engine: string, kind: "search" | "fetch", error?: string, consumption = 1, timeZone = "UTC"): void {
    if (!Number.isFinite(consumption) || consumption < 0) throw new Error("Invalid quota consumption");
    const now = new Date();
    const day = this.dayKey(now, timeZone);
    withFileLock(this.file, () => {
      this.load();
      // YYYY-MM monthly records remain unchanged; YYYY-MM-DD adds daily buckets.
      for (const key of [this.monthKey(now), day]) {
        const bucket = (this.data[key] ??= {});
        const e = (bucket[engine] ??= { search: 0, fetch: 0, errors: 0, consumed: 0 });
        if (error) {
          e.errors += 1;
          e.lastError = `${now.toISOString()}: ${error}`;
        } else {
          e.consumed = (e.consumed ?? e.search + e.fetch) + consumption;
          e[kind] += 1;
          e.lastUsed = now.toISOString();
        }
      }
      const cutoff = new Date(now.getTime() - 62 * 86_400_000).toISOString().slice(0, 10);
      for (const key of Object.keys(this.data)) if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key < cutoff) delete this.data[key];
      atomicWriteFile(this.file, JSON.stringify(this.data, null, 2));
    });
  }

  get(engine: string): EngineUsage {
    this.load();
    return this.data[this.monthKey()]?.[engine] ?? { search: 0, fetch: 0, errors: 0 };
  }

  getDay(engine: string, timeZone = "UTC"): EngineUsage {
    this.load();
    return this.data[this.dayKey(new Date(), timeZone)]?.[engine] ?? { search: 0, fetch: 0, errors: 0 };
  }
}
