import fs from "node:fs";
import path from "node:path";

export interface EngineUsage {
  search: number;
  fetch: number;
  errors: number;
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
            lastError: typeof rec.lastError === "string" ? rec.lastError : undefined,
            lastUsed: typeof rec.lastUsed === "string" ? rec.lastUsed : undefined,
          };
        }
        this.data[month] = cleanMonth;
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      // tmp + rename wie in config/history — ein Crash mid-write darf die
      // Zähler nicht komplett vernichten.
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch {
      /* Zähler sind unkritisch */
    }
  }

  monthKey(date = new Date()): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  record(engine: string, kind: "search" | "fetch", error?: string): void {
    // Vor jedem Schreiben neu lesen → robust bei mehreren Prozessen
    this.load();
    const month = (this.data[this.monthKey()] ??= {});
    const e = (month[engine] ??= { search: 0, fetch: 0, errors: 0 });
    if (error) {
      e.errors += 1;
      e.lastError = `${new Date().toISOString()}: ${error}`;
    } else {
      e[kind] += 1;
      e.lastUsed = new Date().toISOString();
    }
    this.save();
  }

  get(engine: string): EngineUsage {
    return this.data[this.monthKey()]?.[engine] ?? { search: 0, fetch: 0, errors: 0 };
  }
}
