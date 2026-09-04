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
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw && typeof raw === "object") this.data = raw;
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      /* Zähler sind unkritisch */
    }
  }

  monthKey(date = new Date()): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  record(engine: string, kind: "search" | "fetch", error?: string): void {
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
