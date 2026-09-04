import fs from "node:fs";
import { atomicWriteFile, withFileLock } from "./persistence.js";
import type { HistoryRecord } from "./types.js";

export interface HistoryEntry extends HistoryRecord {
  ts: string;
}

const MAX_ITEMS = 20;
const MAX_MARKDOWN = 3000;

/**
 * Verlauf der Such-/Fetch-Aufrufe als Ring-Puffer in einer JSON-Datei.
 * Serialisiert Lesen, Schreiben und Löschen über eine Prozesssperre.
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
    } catch (error) {
      // Keep missing/corrupt-file recovery; an I/O failure must not cause a
      // successful later write to replace an unread existing snapshot.
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return [];
  }

  private write(entries: HistoryEntry[]): void {
    atomicWriteFile(this.file, JSON.stringify(entries));
  }

  record(entry: HistoryRecord): void {
    const capped: HistoryRecord = { ...entry };
    if (capped.result?.items && capped.result.items.length > MAX_ITEMS) {
      capped.result = { ...capped.result, items: capped.result.items.slice(0, MAX_ITEMS) };
    }
    if (capped.result?.markdown && capped.result.markdown.length > MAX_MARKDOWN) {
      capped.result = { ...capped.result, markdown: capped.result.markdown.slice(0, MAX_MARKDOWN) };
    }
    try {
      withFileLock(this.file, () => {
        const entries = this.read().filter((e) => e && typeof e.ts === "string");
        entries.unshift({ ...capped, ts: new Date().toISOString() });
        this.write(entries.slice(0, this.maxEntries));
      });
    } catch {
      // Optional history must never turn a successful provider request into failover.
      process.stderr.write("search-rotation: history persistence failed\n");
    }
  }

  list(limit = 50): HistoryEntry[] {
    return this.read().slice(0, Math.min(Math.max(limit, 1), 200));
  }

  clear(): void {
    withFileLock(this.file, () => fs.rmSync(this.file, { force: true }));
  }
}
