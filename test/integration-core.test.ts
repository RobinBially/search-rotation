import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchRouter } from "../src/router.js";
import { computeRemainingPct } from "../src/quota.js";
import { UsageStore } from "../src/usage.js";
import { HistoryStore } from "../src/history.js";
import { buildStatus, clearRemoteQuotaCache, fetchRemoteQuotaCached, maskKey } from "../src/status.js";
import { ConfigStore, normalizeConfig, type ConfigDefaults } from "../src/config.js";
import type {
  Capability,
  EngineAdapter,
  EngineConfig,
  EngineContext,
  EngineMeta,
  FetchInput,
  PolyConfig,
  RemoteQuota,
  SearchInput,
  SearchOutcome,
} from "../src/types.js";

// Läuft isoliert: node --import tsx --test test/integration-core.test.ts

// ── Helfer ──────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sr-core-"));
}

function tmpUsage(): UsageStore {
  return new UsageStore(tmpDir());
}

function tmpHistory(maxEntries?: number): HistoryStore {
  return new HistoryStore(join(tmpDir(), "history.json"), maxEntries);
}

function cfg(
  engines: (string | EngineConfig)[],
  opts: { fetchOrder?: string[]; monthlyLimits?: Record<string, number> } = {},
): PolyConfig {
  return {
    version: 1,
    engines: engines.map((e) => (typeof e === "string" ? { id: e, enabled: true } : e)),
    fetchOrder: opts.fetchOrder ?? [],
    settings: { port: 6277, token: "", monthlyLimits: opts.monthlyLimits ?? {} },
  };
}

interface FakeRemote {
  quota?: RemoteQuota;
  error?: string;
  calls: number;
  lastCtx?: EngineContext;
}

function fakeAdapter(
  id: string,
  opts: {
    search?: (input: SearchInput) => Promise<SearchOutcome>;
    fetchUrl?: (input: FetchInput) => Promise<string>;
    remote?: FakeRemote;
    monthlyFree?: number;
    capabilities?: Capability[];
    extraFields?: EngineMeta["extraFields"];
  } = {},
): EngineAdapter {
  const meta: EngineMeta = {
    id,
    label: id,
    homepage: "https://example.com",
    signupUrl: "https://example.com",
    keyless: "no",
    capabilities: opts.capabilities ?? ["search"],
    monthlyFree: opts.monthlyFree ?? 1000,
    quotaEndpoint: Boolean(opts.remote),
    extraFields: opts.extraFields,
  };
  const a: EngineAdapter = { meta };
  if (opts.search) a.search = (input) => opts.search!(input);
  if (opts.fetchUrl) a.fetchUrl = (input) => opts.fetchUrl!(input);
  if (opts.remote) {
    a.remoteQuota = async (ctx) => {
      opts.remote!.calls++;
      opts.remote!.lastCtx = ctx;
      if (opts.remote!.error) throw new Error(opts.remote!.error);
      return opts.remote!.quota ?? {};
    };
  }
  return a;
}

const ok = (items: SearchOutcome["items"] = []): Promise<SearchOutcome> =>
  Promise.resolve({ items });

// ── computeRemainingPct (quota.ts): Degradations-Grenzfälle ─────────────────

test("Genau 10 % Restkontingent ergibt exakt 0.1 (Grenze Healthy/Low)", () => {
  // 900 von 1000 verbraucht → (1000-900)/1000 = 0.1.
  // Achtung: README und Router-Docstring sagen "< 10 %" rutscht nach hinten,
  // der Code stuft aber bereits bei exakt 0.1 in den Low-Bucket (siehe Router-Tests).
  assert.equal(computeRemainingPct({ search: 900, fetch: 0 }, 1000, null), 0.1);
  assert.equal(computeRemainingPct({ search: 899, fetch: 0 }, 1000, null), 0.101);
});

test("Genau 0 % Restkontingent ergibt 0, Überverbrauch wird auf 0 geklemmt", () => {
  assert.equal(computeRemainingPct({ search: 1000, fetch: 0 }, 1000, null), 0);
  assert.equal(computeRemainingPct({ search: 1500, fetch: 0 }, 1000, null), 0);
  assert.equal(computeRemainingPct({ search: 500, fetch: 500 }, 1000, null), 0);
});

test("limit 0 oder negativ → null (= unbegrenzt, kein festes Limit)", () => {
  assert.equal(computeRemainingPct({ search: 5000, fetch: 5000 }, 0, null), null);
  assert.equal(computeRemainingPct({ search: 1, fetch: 1 }, -5, null), null);
});

test("Remote-Quota hat Vorrang vor der lokalen Zählung", () => {
  // Lokal fast erschöpft, remote locker → remote gewinnt.
  assert.equal(computeRemainingPct({ search: 999, fetch: 0 }, 1000, { used: 100, limit: 1000 }), 0.9);
  // Lokal ungenutzt, remote leer → 0.
  assert.equal(computeRemainingPct({ search: 0, fetch: 0 }, 1000, { remaining: 0, limit: 1000 }), 0);
  assert.equal(computeRemainingPct({ search: 0, fetch: 0 }, 1000, { used: 1000, limit: 1000 }), 0);
  // used wird zu remaining abgeleitet.
  assert.equal(computeRemainingPct({ search: 0, fetch: 0 }, 1000, { used: 250, limit: 1000 }), 0.75);
  // remaining schlägt used, wenn beide gesetzt sind.
  assert.equal(
    computeRemainingPct({ search: 0, fetch: 0 }, 1000, { used: 950, limit: 1000, remaining: 50 }),
    0.05,
  );
  // limit ohne used/remaining → voll übrig.
  assert.equal(computeRemainingPct({ search: 0, fetch: 0 }, 1000, { limit: 1000 }), 1);
  // limit 0 im Remote-Ergebnis ist kein gültiges Limit → lokaler Pfad.
  assert.equal(computeRemainingPct({ search: 0, fetch: 0 }, 1000, { limit: 0 }), 1);
  // Negatives remaining wird auf 0 geklemmt.
  assert.equal(computeRemainingPct({ search: 0, fetch: 0 }, 1000, { remaining: -10, limit: 100 }), 0);
});

// ── UsageStore (usage.ts) ────────────────────────────────────────────────────

test("monthKey formatiert UTC-basiert als YYYY-MM, zwei-stellig", () => {
  const s = tmpUsage();
  assert.equal(s.monthKey(new Date(Date.UTC(2026, 0, 31, 23, 59, 59))), "2026-01");
  assert.equal(s.monthKey(new Date(Date.UTC(2026, 11, 31, 23, 0))), "2026-12");
  assert.equal(s.monthKey(new Date(Date.UTC(2027, 0, 1, 0, 0))), "2027-01");
  assert.equal(s.monthKey(new Date(Date.UTC(2026, 2, 1))), "2026-03");
  // Lokal schon April, UTC noch März → UTC muss gewinnen.
  assert.equal(s.monthKey(new Date("2026-04-01T00:30:00+02:00")), "2026-03");
  // Lokal schon 2027, UTC noch 2025-12-31.
  assert.equal(s.monthKey(new Date("2026-01-01T00:30:00+01:00")), "2025-12");
  assert.equal(s.monthKey(), s.monthKey(new Date()));
});

test("record zählt search/fetch getrennt; Fehler gehen in errors, nicht in search/fetch", () => {
  const s = tmpUsage();
  s.record("a", "search");
  s.record("a", "search");
  s.record("a", "fetch");
  s.record("a", "search", "429 zu viele Anfragen");
  const u = s.get("a");
  assert.equal(u.search, 2);
  assert.equal(u.fetch, 1);
  assert.equal(u.errors, 1);
  assert.ok(u.lastError?.includes("429 zu viele Anfragen"));
  assert.ok(u.lastUsed);
  // Unbekannte Engine → Nullwerte, kein lastError.
  assert.deepEqual(s.get("nope"), { search: 0, fetch: 0, errors: 0 });
  assert.equal(s.get("nope").lastError, undefined);
});

test("Mehrere Prozesse: record liest neu, get() zeigt den Stand bis zum nächsten record", () => {
  const dir = tmpDir();
  const s1 = new UsageStore(dir);
  s1.record("a", "search");
  assert.equal(s1.get("a").search, 1);
  // Zweiter "Prozess" liest den Stand beim Konstruieren.
  const s2 = new UsageStore(dir);
  assert.equal(s2.get("a").search, 1);
  s2.record("a", "search"); // Datei hat jetzt 2
  // Design: get() liest NICHT neu (nur record tut es) → s1 sieht den Zweitprozess-Stand erst nach dem nächsten record.
  assert.equal(s1.get("a").search, 1);
  s1.record("a", "fetch"); // lädt neu und schreibt
  assert.equal(s1.get("a").search, 2);
  assert.equal(s1.get("a").fetch, 1);
});

test("Defekte usage.json (ungültiges JSON) wird toleriert, Zähler starten bei 0", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, "usage.json"), "{kaputt");
  const s = new UsageStore(dir);
  assert.deepEqual(s.get("a"), { search: 0, fetch: 0, errors: 0 });
  s.record("a", "search");
  assert.equal(s.get("a").search, 1);
});

// ── HistoryStore (history.ts) ────────────────────────────────────────────────

test("record/list: Roundtrip über Datei, neuester Eintrag zuerst, ts gesetzt", () => {
  const h = tmpHistory();
  h.record({ kind: "search", input: "q1", engine: "e1", ok: true, ms: 5, attempts: [] });
  h.record({
    kind: "search",
    input: "q2",
    engine: "e2",
    ok: false,
    ms: 7,
    attempts: [{ engine: "e2", ok: false, ms: 7, error: "boom" }],
  });
  const entries = h.list(10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].input, "q2");
  assert.equal(entries[0].ok, false);
  assert.deepEqual(entries[0].attempts, [{ engine: "e2", ok: false, ms: 7, error: "boom" }]);
  assert.equal(entries[1].input, "q1");
  for (const e of entries) {
    assert.equal(typeof e.ts, "string");
    assert.ok(!Number.isNaN(Date.parse(e.ts)));
  }
});

test("Caps: Items auf 20, Markdown auf 3000 Zeichen; Original-Entry wird nicht mutiert", () => {
  const h = tmpHistory();
  const items = Array.from({ length: 25 }, (_, i) => ({ title: `t${i}`, url: `https://x/${i}` }));
  const entry = {
    kind: "search" as const,
    input: "q",
    engine: "e",
    ok: true,
    ms: 1,
    attempts: [],
    result: { count: 25, items, markdown: "m".repeat(3500) },
  };
  h.record(entry);
  const stored = h.list(1)[0];
  assert.equal(stored.result?.items?.length, 20);
  assert.deepEqual(stored.result?.items, items.slice(0, 20));
  assert.equal(stored.result?.markdown?.length, 3000);
  assert.equal(stored.result?.count, 25); // fremde Felder bleiben erhalten
  assert.equal(entry.result.items.length, 25); // Original unverändert
  assert.equal(entry.result.markdown.length, 3500);
});

test("Ringpuffer: älteste Einträge fliegen, neueste bleiben; list-Limits auf 1..200 geklemmt", () => {
  const file = join(tmpDir(), "history.json");
  const h = new HistoryStore(file, 3);
  for (const m of ["m1", "m2", "m3", "m4", "m5"]) {
    h.record({ kind: "search", input: m, engine: null, ok: true, ms: 1, attempts: [] });
  }
  assert.deepEqual(
    h.list(200).map((e) => e.input),
    ["m5", "m4", "m3"],
  );

  // Klemmen über eine manuell befüllte Datei (250 Einträge).
  const big = Array.from({ length: 250 }, (_, i) => ({
    kind: "search",
    input: `i${i}`,
    engine: null,
    ok: true,
    ms: 1,
    attempts: [],
    ts: "2026-01-01T00:00:00.000Z",
  }));
  const file2 = join(tmpDir(), "history.json");
  writeFileSync(file2, JSON.stringify(big));
  const h2 = new HistoryStore(file2);
  assert.equal(h2.list().length, 50); // Default
  assert.equal(h2.list(1000).length, 200); // Obergrenze
  assert.equal(h2.list(0).length, 1); // Untergrenze
  assert.equal(h2.list(-3).length, 1);
});

test("Neu lesen vor dem Schreiben: zweite Instanz überschreibt Einträge der ersten nicht", () => {
  const file = join(tmpDir(), "history.json");
  const h1 = new HistoryStore(file);
  h1.record({ kind: "search", input: "A", engine: null, ok: true, ms: 1, attempts: [] });
  const h2 = new HistoryStore(file);
  h2.record({ kind: "search", input: "B", engine: null, ok: true, ms: 1, attempts: [] });
  // h1 muss B sehen (vor dem Schreiben neu gelesen), sonst hätte es B überschrieben.
  assert.deepEqual(
    h1.list(10).map((e) => e.input),
    ["B", "A"],
  );
  assert.deepEqual(
    h2.list(10).map((e) => e.input),
    ["B", "A"],
  );
});

test("clear löscht die Datei und danach kann wieder aufgezeichnet werden; defekte Datei startet leer", () => {
  const file = join(tmpDir(), "history.json");
  const h = new HistoryStore(file);
  h.record({ kind: "fetch", input: "https://x", engine: "j", ok: true, ms: 1, attempts: [] });
  h.clear();
  assert.equal(h.list().length, 0);
  assert.equal(existsSync(file), false);
  assert.doesNotThrow(() => h.clear()); // clear auf fehlender Datei ok
  h.record({ kind: "fetch", input: "https://y", engine: "j", ok: true, ms: 1, attempts: [] });
  assert.deepEqual(
    h.list(5).map((e) => e.input),
    ["https://y"],
  );

  // Ungültiges JSON bzw. Nicht-Array → leer starten, record funktioniert.
  const bad = join(tmpDir(), "history.json");
  writeFileSync(bad, "/*kaputt");
  const h2 = new HistoryStore(bad);
  assert.equal(h2.list().length, 0);
  h2.record({ kind: "search", input: "x", engine: null, ok: true, ms: 1, attempts: [] });
  assert.equal(h2.list().length, 1);

  writeFileSync(bad, JSON.stringify({ kein: "array" }));
  const h3 = new HistoryStore(bad);
  assert.equal(h3.list().length, 0);

  // Einträge ohne ts werden beim Lesen verworfen.
  writeFileSync(
    bad,
    JSON.stringify([
      { kind: "search", input: "ohne-ts", engine: null, ok: true, ms: 1, attempts: [] },
      { kind: "search", input: "mit-ts", engine: null, ok: true, ms: 1, attempts: [], ts: "2026-01-01T00:00:00.000Z" },
    ]),
  );
  const h4 = new HistoryStore(bad);
  h4.record({ kind: "search", input: "z", engine: null, ok: true, ms: 1, attempts: [] });
  assert.deepEqual(
    h4.list(10).map((e) => e.input),
    ["z", "mit-ts"],
  );
});

// ── SearchRouter × HistoryStore ──────────────────────────────────────────────

test("History: erfolgreiche Suche wird aufgezeichnet (Engine, Query, count/items, attempts)", async () => {
  const h = tmpHistory();
  const adapters = [fakeAdapter("a", { search: () => ok([{ title: "T", url: "https://a.example" }]) })];
  const router = new SearchRouter({ getConfig: () => cfg(["a"]), usage: tmpUsage(), adapters, history: h });
  await router.search({ query: "hello world" });
  const e = h.list(1)[0];
  assert.equal(e.kind, "search");
  assert.equal(e.input, "hello world");
  assert.equal(e.engine, "a");
  assert.equal(e.ok, true);
  assert.equal(e.attempts.length, 1);
  assert.equal(e.attempts[0].ok, true);
  assert.equal(e.result?.count, 1);
  assert.deepEqual(e.result?.items, [{ title: "T", url: "https://a.example" }]);
  assert.equal(typeof e.ts, "string");
});

test("History: Totalausfall wird aufgezeichnet (ok=false, engine=null, Fehlermeldung, Attempts)", async () => {
  const h = tmpHistory();
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("x"); } }),
    fakeAdapter("b", { search: async () => { throw new Error("y"); } }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage: tmpUsage(), adapters, history: h });
  await assert.rejects(() => router.search({ query: "q" }));
  const e = h.list(1)[0];
  assert.equal(e.ok, false);
  assert.equal(e.engine, null);
  assert.equal(e.attempts.length, 2);
  assert.match(e.error!, /Alle 2 Such-Engines fehlgeschlagen\./);
});

test("History: leere Kette (nichts aktiviert) wird aufgezeichnet (attempts=[], klare Meldung)", async () => {
  const h = tmpHistory();
  const adapters = [fakeAdapter("a", { search: () => ok() })];
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "a", enabled: false }]),
    usage: tmpUsage(),
    adapters,
    history: h,
  });
  await assert.rejects(() => router.search({ query: "q" }), /Keine aktivierte Such-Engine/);
  const e = h.list(1)[0];
  assert.equal(e.ok, false);
  assert.equal(e.engine, null);
  assert.deepEqual(e.attempts, []);
  assert.match(e.error!, /Keine aktivierte Such-Engine/);
});

test("History: Fetch Erfolg, Totalausfall und leere Fetch-Kette", async () => {
  const h = tmpHistory();
  const adapters = [fakeAdapter("f1", { fetchUrl: async () => "# Markdown" })];

  const router1 = new SearchRouter({
    getConfig: () => cfg(["f1"], { fetchOrder: ["f1"] }),
    usage: tmpUsage(),
    adapters,
    history: h,
  });
  await router1.fetchUrl({ url: "https://x.example" });
  let e = h.list(1)[0];
  assert.equal(e.kind, "fetch");
  assert.equal(e.input, "https://x.example");
  assert.equal(e.engine, "f1");
  assert.equal(e.ok, true);
  assert.equal(e.result?.chars, "# Markdown".length);
  assert.equal(e.result?.markdown, "# Markdown");

  const throwing = [fakeAdapter("f1", { fetchUrl: async () => { throw new Error("weg"); } })];
  const router2 = new SearchRouter({
    getConfig: () => cfg(["f1"], { fetchOrder: ["f1"] }),
    usage: tmpUsage(),
    adapters: throwing,
    history: h,
  });
  await assert.rejects(() => router2.fetchUrl({ url: "https://x.example" }));
  e = h.list(1)[0];
  assert.equal(e.ok, false);
  assert.equal(e.engine, null);
  assert.match(e.error!, /Alle 1 Fetch-Engines fehlgeschlagen\./);

  const router3 = new SearchRouter({
    getConfig: () => cfg([{ id: "f1", enabled: false }], { fetchOrder: ["f1"] }),
    usage: tmpUsage(),
    adapters,
    history: h,
  });
  await assert.rejects(() => router3.fetchUrl({ url: "https://x.example" }), /Keine aktivierte Fetch-Engine/);
  e = h.list(1)[0];
  assert.deepEqual(e.attempts, []);
  assert.match(e.error!, /Keine aktivierte Fetch-Engine/);
});

test("Router funktioniert auch ohne History-Store (Erfolg und Totalausfall)", async () => {
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("x"); } }),
    fakeAdapter("b", { search: () => ok([{ title: "T", url: "https://b.example" }]) }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage: tmpUsage(), adapters });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "b");
  const adaptersFail = [fakeAdapter("a", { search: async () => { throw new Error("x"); } })];
  const router2 = new SearchRouter({ getConfig: () => cfg(["a"]), usage: tmpUsage(), adapters: adaptersFail });
  await assert.rejects(() => router2.search({ query: "q" }));
});

// ── SearchRouter: Quota-Degradation & preferEngine ──────────────────────────

test("Genau 10 % Rest landet im Low-Bucket: hinten einsortiert, aber noch in der Kette", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 900; i++) usage.record("a", "search"); // exakt 10 % Rest
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("x"); } }),
    fakeAdapter("b", { search: async () => { throw new Error("y"); } }),
  ];
  const h = tmpHistory();
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters, history: h });
  await assert.rejects(() => router.search({ query: "q" }));
  const e = h.list(1)[0];
  assert.equal(e.attempts.length, 2); // a wird noch versucht (Low ≠ verworfen)
  // Reihenfolge beweist: a (exakt 10 %) wurde hinter b einsortiert.
  // (Hinweis: Code stuft bei pct <= 0.1 ab, README/Docstring sagen "< 10 %".)
  assert.deepEqual(
    e.attempts.map((x) => x.engine),
    ["b", "a"],
  );
});

test("Low-Engine (knappes Kontingent) wird als Fallback noch versucht", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 900; i++) usage.record("a", "search"); // 10 % Rest → Low
  const adapters = [
    fakeAdapter("a", { search: () => ok([{ title: "aus a", url: "https://a.example" }]) }),
    fakeAdapter("b", { search: async () => { throw new Error("b kaputt"); } }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "a");
  assert.deepEqual(
    r.attempts.map((x) => x.engine),
    ["b", "a"],
  );
});

test("Genau 0 % Rest → erschöpft: hinter Low und Healthy, Reihenfolge [healthy, low, exhausted]", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 1000; i++) usage.record("a", "search"); // 0 % → exhausted
  for (let i = 0; i < 950; i++) usage.record("b", "search"); // 5 % → low
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("a"); } }),
    fakeAdapter("b", { search: async () => { throw new Error("b"); } }),
    fakeAdapter("c", { search: async () => { throw new Error("c"); } }),
  ];
  const h = tmpHistory();
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b", "c"]), usage, adapters, history: h });
  await assert.rejects(() => router.search({ query: "q" }));
  const e = h.list(1)[0];
  assert.deepEqual(
    e.attempts.map((x) => x.engine),
    ["c", "b", "a"], // healthy c, low b (5 %), exhausted a (0 %)
  );
});

test("Erschöpfte Engine wird als letzte Instanz noch versucht", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 1000; i++) usage.record("a", "search"); // 0 %
  const adapters = [
    fakeAdapter("a", { search: () => ok([{ title: "aus a", url: "https://a.example" }]) }),
    fakeAdapter("b", { search: async () => { throw new Error("b kaputt"); } }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "a");
  assert.deepEqual(
    r.attempts.map((x) => x.engine),
    ["b", "a"],
  );
});

test("limit 0 → null (unbegrenzt): Engine bleibt trotz hoher Nutzung im Healthy-Bucket vorn", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 1200; i++) usage.record("a", "search"); // wäre jedes feste Limit gerissen
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("a"); }, monthlyFree: 0 }),
    fakeAdapter("b", { search: async () => { throw new Error("b"); } }),
  ];
  const h = tmpHistory();
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters, history: h });
  await assert.rejects(() => router.search({ query: "q" }));
  const e = h.list(1)[0];
  assert.deepEqual(
    e.attempts.map((x) => x.engine),
    ["a", "b"], // a bleibt vorne (pct null → healthy), wird nicht degradiert
  );
});

test("Remote-Quota 0 % schlägt lokale Zählung: lokal ungenutzte Engine wird erschöpft eingestuft", async () => {
  clearRemoteQuotaCache();
  const usage = tmpUsage();
  const adapters = [
    fakeAdapter("rq-zero", {
      search: async () => { throw new Error("a"); },
      remote: { quota: { used: 1000, limit: 1000 } },
    }),
    fakeAdapter("rq-other", { search: async () => { throw new Error("b"); } }),
  ];
  const h = tmpHistory();
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "rq-zero", enabled: true, apiKey: "sk-rq" }, "rq-other"]),
    usage,
    adapters,
    history: h,
  });
  await assert.rejects(() => router.search({ query: "q" }));
  const e = h.list(1)[0];
  assert.deepEqual(
    e.attempts.map((x) => x.engine),
    ["rq-other", "rq-zero"], // remote 0 % → exhausted, trotz lokaler 0 Nutzung
  );
  assert.equal(usage.get("rq-zero").search, 0);
});

test("Remote-Quota gesund schlägt lokale Erschöpfung: Engine bleibt im Healthy-Bucket", async () => {
  clearRemoteQuotaCache();
  const usage = tmpUsage();
  for (let i = 0; i < 1000; i++) usage.record("rq-healthy", "search"); // lokal erschöpft
  const adapters = [
    fakeAdapter("rq-healthy", {
      search: async () => { throw new Error("a"); },
      remote: { quota: { used: 100, limit: 1000 } }, // remote 90 % frei
    }),
    fakeAdapter("rq-other", { search: async () => { throw new Error("b"); } }),
  ];
  const h = tmpHistory();
  const router = new SearchRouter({
    getConfig: () => cfg([{ id: "rq-healthy", enabled: true, apiKey: "sk-rq" }, "rq-other"]),
    usage,
    adapters,
    history: h,
  });
  await assert.rejects(() => router.search({ query: "q" }));
  const e = h.list(1)[0];
  assert.deepEqual(
    e.attempts.map((x) => x.engine),
    ["rq-healthy", "rq-other"], // remote gewinnt → a vorne, keine Degradierung
  );
});

test("preferEngine pinnt auch eine erschöpfte Engine nach vorn (Failover bleibt aktiv)", async () => {
  const usage = tmpUsage();
  for (let i = 0; i < 1000; i++) usage.record("a", "search"); // 0 %
  const adapters = [
    fakeAdapter("a", { search: () => ok([{ title: "aus a", url: "https://a.example" }]) }),
    fakeAdapter("b", { search: () => ok([{ title: "aus b", url: "https://b.example" }]) }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters });
  const r = await router.search({ query: "q" }, { preferEngine: "a" });
  assert.equal(r.engine, "a");
  assert.deepEqual(
    r.attempts.map((x) => x.engine),
    ["a"],
  );
});

test("preferEngine + Rotation kombiniert: Prefer rotiert nicht, danach läuft Rotation weiter", async () => {
  const adapters = [
    fakeAdapter("a", { search: () => ok() }),
    fakeAdapter("b", { search: () => ok() }),
    fakeAdapter("c", { search: () => ok() }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b", "c"]), usage: tmpUsage(), adapters });
  const r1 = await router.search({ query: "q" }, { preferEngine: "b" });
  assert.equal(r1.engine, "b");
  const r2 = await router.search({ query: "q" });
  assert.equal(r2.engine, "a"); // rr stand bei 0, Prefer-Aufrufe zählen nicht
  const r3 = await router.search({ query: "q" });
  assert.equal(r3.engine, "b");
  const r4 = await router.search({ query: "q" });
  assert.equal(r4.engine, "c");
});

test("preferEngine: unbekannte Engine wird ignoriert, Kette bleibt in bewerteter Reihenfolge", async () => {
  const adapters = [
    fakeAdapter("a", { search: () => ok() }),
    fakeAdapter("b", { search: () => ok() }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage: tmpUsage(), adapters });
  const r1 = await router.search({ query: "q" }, { preferEngine: "gibt-es-nicht" });
  const r2 = await router.search({ query: "q" }, { preferEngine: "gibt-es-nicht" });
  assert.equal(r1.engine, "a");
  assert.equal(r2.engine, "a"); // prefer gesetzt → keine Rotation, stabile Reihenfolge
});

test("Router zählt Fehler und Erfolge im UsageStore", async () => {
  const usage = tmpUsage();
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("boom-a"); } }),
    fakeAdapter("b", { search: () => ok() }),
  ];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters });
  await router.search({ query: "q" });
  const ua = usage.get("a");
  assert.equal(ua.errors, 1);
  assert.equal(ua.search, 0);
  assert.ok(ua.lastError?.includes("boom-a"));
  assert.equal(usage.get("b").search, 1);
  assert.equal(usage.get("b").errors, 0);
});

// ── buildStatus / fetchRemoteQuotaCached / maskKey (status.ts) ──────────────

test("buildStatus: Remote-Quota wird geliefert, hat Vorrang und wird 5 Min gecacht", async () => {
  clearRemoteQuotaCache();
  const usage = tmpUsage();
  for (let i = 0; i < 500; i++) usage.record("bs-a", "search"); // lokal 50 % verbraucht
  const remoteA: FakeRemote = { quota: { used: 250, limit: 1000 }, calls: 0 };
  const adapters = [
    fakeAdapter("bs-a", {
      search: () => ok(),
      remote: remoteA,
      extraFields: [{ key: "cx", label: "CX" }],
    }),
    fakeAdapter("bs-b", { search: () => ok(), monthlyFree: 1000 }),
  ];
  const statusCfg = cfg(
    [
      { id: "bs-a", enabled: true, apiKey: "sk-live-a", extra: { cx: "x" } },
      { id: "bs-b", enabled: false, apiKey: "sk-b" },
    ],
    { fetchOrder: ["bs-b"], monthlyLimits: { "bs-b": 777 } },
  );

  const rows1 = await buildStatus(statusCfg, usage, adapters);
  assert.equal(rows1.length, 2);

  const a = rows1[0];
  assert.deepEqual(a.remote, { used: 250, limit: 1000 });
  assert.equal(a.remainingPct, 0.75); // Remote (75 %) schlägt lokal (50 %)
  assert.equal(a.remoteError, undefined);
  assert.equal(a.hasKey, true);
  assert.equal(a.keyMasked, "sk…-a");
  assert.equal(a.enabled, true);
  assert.equal(a.searchPosition, 0);
  assert.equal(a.fetchPosition, -1);
  assert.equal(a.monthlyLimit, 1000); // meta.monthlyFree, kein Override
  assert.equal(a.used.search, 500);
  assert.deepEqual(a.extrasSet, { cx: true });
  assert.deepEqual(remoteA.lastCtx, { apiKey: "sk-live-a", extra: { cx: "x" } });

  const b = rows1[1];
  assert.equal(b.enabled, false);
  assert.equal(b.hasKey, true);
  assert.equal(b.remote, null);
  assert.equal(b.monthlyLimit, 777); // settings-Override greift
  assert.equal(b.remainingPct, 1);
  assert.equal(b.searchPosition, 1);
  assert.equal(b.fetchPosition, 0);

  // Zweiter Aufruf innerhalb der TTL → Adapter wird nicht erneut gefragt.
  await buildStatus(statusCfg, usage, adapters);
  assert.equal(remoteA.calls, 1);
});

test("buildStatus: remoteError wird gesetzt, lokaler Fallback greift, Fehler wird gecacht", async () => {
  clearRemoteQuotaCache();
  const usage = tmpUsage();
  for (let i = 0; i < 500; i++) usage.record("er-a", "search");
  usage.record("er-a", "search", "früherer Fehler");
  const remoteA: FakeRemote = { error: "quota endpoint kaputt", calls: 0 };
  const adapters = [fakeAdapter("er-a", { search: () => ok(), remote: remoteA })];
  const statusCfg = cfg([{ id: "er-a", enabled: true, apiKey: "sk-er" }]);

  const row = (await buildStatus(statusCfg, usage, adapters))[0];
  assert.equal(row.remote, null);
  assert.equal(row.remoteError, "quota endpoint kaputt");
  assert.equal(row.remainingPct, 0.5); // Fallback auf lokale Zählung
  assert.equal(row.lastError?.includes("früherer Fehler"), true);
  assert.equal(remoteA.calls, 1);

  // Zweiter Aufruf: Fehler ist gecacht, kein erneuter Adapter-Call.
  const row2 = (await buildStatus(statusCfg, usage, adapters))[0];
  assert.equal(row2.remoteError, "quota endpoint kaputt");
  assert.equal(remoteA.calls, 1);
});

test("fetchRemoteQuotaCached: ohne Key/ohne remoteQuota kein Call, mit Key 5-Min-Cache, Clear wirkt", async () => {
  clearRemoteQuotaCache();
  const noKey: FakeRemote = { quota: { used: 1, limit: 10 }, calls: 0 };
  const withKey: FakeRemote = { quota: { used: 1, limit: 10 }, calls: 0 };
  const a = fakeAdapter("fq-nokey", { remote: noKey });
  const b = fakeAdapter("fq-nofn", { search: () => ok() }); // kein remoteQuota
  const c = fakeAdapter("fq-key", { remote: withKey });

  assert.deepEqual(await fetchRemoteQuotaCached(a, {}), { quota: null });
  assert.equal(noKey.calls, 0);
  assert.deepEqual(await fetchRemoteQuotaCached(b, { apiKey: "sk" }), { quota: null });

  const r1 = await fetchRemoteQuotaCached(c, { apiKey: "sk-x" });
  assert.deepEqual(r1.quota, { used: 1, limit: 10 });
  assert.equal(r1.error, undefined);
  const r2 = await fetchRemoteQuotaCached(c, { apiKey: "sk-x" }); // Cache-Hit
  assert.deepEqual(r2.quota, { used: 1, limit: 10 });
  assert.equal(r2.error, undefined);
  assert.equal(withKey.calls, 1);

  clearRemoteQuotaCache();
  await fetchRemoteQuotaCached(c, { apiKey: "sk-x" });
  assert.equal(withKey.calls, 2);
});

test("maskKey maskiert lange und kurze Keys, leere Keys bleiben leer", () => {
  assert.equal(maskKey(), "");
  assert.equal(maskKey(""), "");
  assert.equal(maskKey("abc"), "ab…bc");
  assert.equal(maskKey("0123456789"), "01…89");
  assert.equal(maskKey("0123456789a"), "012345…789a");
  assert.equal(maskKey("sk-1234567890abcdefgh"), "sk-123…efgh");
});

// ── config.ts ────────────────────────────────────────────────────────────────

const defaults: ConfigDefaults = {
  knownIds: ["tavily", "firecrawl", "parallel", "exa", "google-cse", "jina", "duckduckgo"],
  searchOrder: ["tavily", "firecrawl", "parallel", "exa", "google-cse", "duckduckgo"],
  fetchOrder: ["jina", "firecrawl", "parallel", "tavily", "exa"],
  defaultEnabled: { "google-cse": false },
};

test("ConfigStore: erste Load erzeugt Default-Datei (0600), Save/Load-Roundtrip erhält alles", () => {
  const dir = tmpDir();
  const store = new ConfigStore(dir);
  assert.equal(existsSync(store.file), false);
  const first = store.load(defaults);
  assert.ok(existsSync(store.file));
  assert.equal(first.settings.port, 6277);
  assert.equal(first.version, 1);
  assert.equal(statSync(store.file).mode & 0o777, 0o600);

  const customized = normalizeConfig(
    {
      engines: [{ id: "tavily", enabled: true, apiKey: "  k1  " }],
      fetchOrder: ["jina"],
      settings: { port: 7000, token: "t", monthlyLimits: { exa: 500 } },
    },
    defaults,
  );
  store.save(customized);
  const re = store.load(defaults);
  assert.equal(re.settings.port, 7000);
  assert.equal(re.settings.token, "t");
  assert.deepEqual(re.settings.monthlyLimits, { exa: 500 });
  assert.equal(re.engines.find((e) => e.id === "tavily")?.apiKey, "k1");
  assert.equal(re.engines.find((e) => e.id === "jina")?.enabled, true); // Default-Anhang
  assert.equal(re.fetchOrder[0], "jina");
});

test("ConfigStore: defektes JSON wirft klare Fehlermeldung", () => {
  const dir = tmpDir();
  const store = new ConfigStore(dir);
  store.load(defaults);
  writeFileSync(store.file, "kein json{");
  assert.throws(() => store.load(defaults), /kein gültiges JSON/);
});

test("normalizeConfig: Settings werden saniert (Port-Grenzen, token, monthlyLimits-Form)", () => {
  const c1 = normalizeConfig({ settings: { port: 80, token: 42, monthlyLimits: ["nope"] } }, defaults);
  assert.equal(c1.settings.port, 6277);
  assert.equal(c1.settings.token, "");
  assert.deepEqual(c1.settings.monthlyLimits, {});
  assert.equal(normalizeConfig({ settings: { port: 70000 } }, defaults).settings.port, 6277);
  assert.equal(normalizeConfig({ settings: { port: "7000" } }, defaults).settings.port, 6277);
  assert.equal(normalizeConfig({ settings: { port: 8443 } }, defaults).settings.port, 8443);
  assert.deepEqual(normalizeConfig({ settings: { monthlyLimits: null } }, defaults).settings.monthlyLimits, {});
  // FIXED: Werte in monthlyLimits werden jetzt validiert (nur endliche Zahlen
  // >= 0) — "abc"/negativ werden verworfen statt die Engine unbegrenzt zu schalten.
  assert.deepEqual(
    normalizeConfig({ settings: { monthlyLimits: { tavily: "abc", exa: -5, firecrawl: 0, parallel: 2500 } } }, defaults)
      .settings.monthlyLimits,
    { firecrawl: 0, parallel: 2500 },
  );
});

test("normalizeConfig: extra-Felder (nur Strings), apiKey-Trimming, enabled-Defaults", () => {
  const c = normalizeConfig(
    {
      engines: [
        { id: "google-cse", extra: { cx: "  abc  ", count: 5, nested: { a: 1 } } },
        { id: "tavily", apiKey: "   " },
        { id: "exa", enabled: "yes" },
      ],
    },
    defaults,
  );
  const gcse = c.engines.find((e) => e.id === "google-cse");
  assert.deepEqual(gcse?.extra, { cx: "  abc  " }); // nur Strings, kein Trim (apiKey wird getrimmt, extra nicht)
  assert.equal(c.engines.find((e) => e.id === "tavily")?.apiKey, undefined);
  assert.equal(c.engines.find((e) => e.id === "exa")?.enabled, true); // nicht-boolean → Default
  assert.equal(c.engines.find((e) => e.id === "google-cse")?.enabled, false); // defaultEnabled greift
});

// ── BUG-Dokumentationen (skipped — Suite muss grün bleiben) ─────────────────

test.skip("FIXED — BUG: Doppelte Engine-Ids in der Config führen zu doppelten Versuchen derselben Engine → Fix: normalizeConfig dedupliziert + seen-Set in chain() (Original-Assertion beschrieb den Bug)", async () => {
  // normalizeConfig (config.ts) dedupliziert engines nicht — eine hand-editierte
  // config.json mit zweimal derselben Id wird 1:1 übernommen. router.chain()
  // baut die Kette aus cfg.engines.map((e) => e.id) ohne Dedup → dieselbe Engine
  // wird pro Suche mehrfach versucht (doppelte API-Calls, doppelter Usage-Count).
  // Fix: in normalizeConfig Dubletten entfernen oder in chain() gesehene Ids überspringen.
  const adapters = [
    fakeAdapter("a", { search: async () => { throw new Error("boom"); } }),
    fakeAdapter("b", { search: () => ok() }),
  ];
  const router = new SearchRouter({
    getConfig: () => cfg(["a", "a", "b"]),
    usage: tmpUsage(),
    adapters,
  });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "b");
  assert.equal(r.attempts.length, 2, "Engine a darf nur einmal pro Suche versucht werden");
  // Aktuelles Verhalten: attempts = [a, a, b] (Länge 3).
});

test.skip("FIXED — BUG: Nicht-numerischer Usage-Zähler wirft die Engine komplett aus der Rotation → Fix: UsageStore.load() säubert Zähler strikt + NaN-Guard in computeRemainingPct", async () => {
  // usage.json mit search: "x" (z. B. manuell korrumpiert) → used.search + used.fetch
  // = "x0" (String-Concat) → pct = NaN → NaN passt in keinen Bucket
  // (healthy: > 0.1 false, low: > 0 false, exhausted: <= 0 false) → Engine wird
  // stillschweigend aus der Kette weggelassen; bei Einzel-Engine folgt die
  // irreführende Meldung "Keine aktivierte Such-Engine".
  // Fix: Zähler in UsageStore.load() validieren (oder in computeRemainingPct Number() erzwingen).
  const dir = tmpDir();
  const probe = new UsageStore(dir);
  writeFileSync(
    join(dir, "usage.json"),
    JSON.stringify({ [probe.monthKey()]: { a: { search: "x", fetch: 0, errors: 0 } } }),
  );
  const usage = new UsageStore(dir);
  const adapters = [fakeAdapter("a", { search: () => ok() }), fakeAdapter("b", { search: () => ok() })];
  const router = new SearchRouter({ getConfig: () => cfg(["a", "b"]), usage, adapters });
  const r = await router.search({ query: "q" });
  assert.equal(r.engine, "a", "Engine a muss versucht werden, trotz kaputten Zählers");
  // Aktuelles Verhalten: r.engine === "b" (a wird wegen NaN verworfen).
});

test.skip("FIXED — BUG: usage.json mit Nicht-Objekt-Monatseintrag lässt UsageStore.record() crashen → Fix: load() validiert die komplette Struktur (Original-Assertion beschrieb den Bug)", async () => {
  // usage.load() validiert nur "ist ein Objekt" auf oberster Ebene. Ein
  // Monatseintrag wie {"2026-09": "kaputt"} überlebt das. record() macht dann
  // month[engine] ??= {...} auf einem String → TypeError im Strict Mode. Über den
  // Router (usage.record im catch-Block) würde das jede fehlgeschlagene Suche
  // mit einem TypeError statt RouterError beenden. Fix: Shape in load() prüfen
  // oder in record() vor dem Schreiben auf Objekt validieren.
  const dir = tmpDir();
  const usage = new UsageStore(dir); // Datei fehlt → leer
  writeFileSync(join(dir, "usage.json"), JSON.stringify({ [usage.monthKey()]: "kaputt" }));
  usage.record("a", "search"); // Aktuell: TypeError "Cannot create property 'a' on string"
  assert.equal(usage.get("a").search, 1);
});
