import fs from "node:fs";
import path from "node:path";
import type { HistoryRecord } from "./types.js";

export interface HistoryEntry extends HistoryRecord {
  ts: string;
}

const MAX_ITEMS = 20;
const MAX_MARKDOWN = 3000;

/**
 * Verlauf der Such-/Fetch-Aufrufe als Ring-Puffer in einer JSON-Datei.
 * Liest vor jedem Schreibvorgang die Datei neu, damit mehrere Prozesse
 * (z. B. OpenCode-Session + Dashboard-Test) sich nicht gegenseitig
 * Einträge überschreiben.
 */
export class HistoryStore {
  private readonly file: string;
  private readonly maxEntries: number;

  constructor(file: string, maxEntries = 500) {
    this.file = file;
    this.maxEntries = maxEntries;
  }

  private read(): HistoryEntry[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (Array.isArray(raw)) return raw;
    } catch {
      /* fehlt/defekt → leer */
    }
    return [];
  }

  private write(entries: HistoryEntry[]): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, this.file);
  }

  record(entry: HistoryRecord): void {
    const capped: HistoryRecord = { ...entry };
    if (capped.result?.items && capped.result.items.length > MAX_ITEMS) {
      capped.result = { ...capped.result, items: capped.result.items.slice(0, MAX_ITEMS) };
    }
    if (capped.result?.markdown && capped.result.markdown.length > MAX_MARKDOWN) {
      capped.result = { ...capped.result, markdown: capped.result.markdown.slice(0, MAX_MARKDOWN) };
    }
    // Neu lesen → Prozess-übergreifend deutlich robustere Writes
    const entries = this.read().filter((e) => e && typeof e.ts === "string");
    entries.unshift({ ...capped, ts: new Date().toISOString() });
    try {
      this.write(entries.slice(0, this.maxEntries));
    } catch {
      /* Verlauf ist nice-to-have */
    }
  }

  list(limit = 50): HistoryEntry[] {
    return this.read().slice(0, Math.min(Math.max(limit, 1), 200));
  }

  clear(): void {
    try {
      fs.rmSync(this.file);
    } catch {
      /* ok wenn fehlt */
    }
  }
}
