import { test } from "node:test";
import assert from "node:assert/strict";

import { buildWebApp } from "../src/web/app.js";
import type { WebDeps } from "../src/web/app.js";
import { VERSION } from "../src/version.js";
import type { EngineAdapter, EngineMeta, TestResult } from "../src/types.js";
import type { PolyConfig } from "../src/config.js";
import type { HistoryEntry } from "../src/history.js";
import type { StatusRow } from "../src/status.js";

/* ---------- Fake-Adapter & Fake-WebDeps (komplett offline) ---------- */

function meta(overrides: Partial<EngineMeta> & { id: string }): EngineMeta {
  return {
    label: overrides.id,
    homepage: `https://example.com/${overrides.id}`,
    signupUrl: `https://example.com/${overrides.id}/signup`,
    keyless: "no",
    capabilities: ["search"],
    monthlyFree: 1000,
    quotaEndpoint: false,
    ...overrides,
  };
}

function fakeAdapters(): EngineAdapter[] {
  return [
    {
      meta: meta({ id: "tavily", label: "Tavily", capabilities: ["search", "fetch"], quotaEndpoint: true }),
      search: async () => ({ items: [{ title: "t", url: "https://t.example" }] }),
      fetchUrl: async () => "# md",
    },
    {
      meta: meta({ id: "google", label: "Google PSE", extraFields: [{ key: "cx", label: "Search-CX" }] }),
    },
    {
      meta: meta({ id: "jina", label: "Jina Reader", capabilities: ["fetch"], keyless: "ip" }),
      fetchUrl: async () => "# jina",
    },
  ];
}

function baseConfig(): PolyConfig {
  return {
    version: 1,
    engines: [
      { id: "tavily", enabled: true, apiKey: "tvly-secret-1234" },
      { id: "google", enabled: false, extra: { cx: "alt" } },
      { id: "jina", enabled: true },
    ],
    fetchOrder: ["tavily", "jina"],
    settings: { port: 6277, token: "alt-token", monthlyLimits: {} },
  };
}

const HISTORY: HistoryEntry[] = [
  { ts: "2026-09-01T10:00:00.000Z", kind: "search", input: "q1", engine: "tavily", ok: true, ms: 100, attempts: [] },
  {
    ts: "2026-09-01T10:00:01.000Z",
    kind: "fetch",
    input: "https://example.com",
    engine: "jina",
    ok: false,
    ms: 50,
    attempts: [{ engine: "jina", ok: false, ms: 50, error: "boom" }],
    error: "boom",
  },
  { ts: "2026-09-01T10:00:02.000Z", kind: "search", input: "q3", engine: null, ok: true, ms: 200, attempts: [] },
];

function fakeStatus(): StatusRow[] {
  return [
    {
      id: "tavily",
      label: "Tavily",
      homepage: "https://example.com/tavily",
      signupUrl: "https://example.com/tavily/signup",
      capabilities: ["search", "fetch"],
      keyless: "no",
      extraFields: [],
      enabled: true,
      searchPosition: 0,
      fetchPosition: 0,
      hasKey: true,
      keyMasked: "tvly-s…1234",
      extrasSet: {},
      monthlyLimit: 1000,
      used: { search: 10, fetch: 2, errors: 0 },
      remote: { used: 10, limit: 1000, remaining: 990 },
      remainingPct: 99,
    },
  ];
}

class FakeDeps implements WebDeps {
  configPath = "/tmp/fake-config/config.json";
  saved: PolyConfig;
  adapters: EngineAdapter[];
  statusCalls = 0;
  saveCalls = 0;
  clearCalls = 0;
  historyLimits: number[] = [];
  testCalls: { id: string; kind: "search" | "fetch"; arg: string }[] = [];

  constructor(cfg: PolyConfig = baseConfig()) {
    this.saved = structuredClone(cfg);
    this.adapters = fakeAdapters();
  }

  getConfig(): PolyConfig {
    return structuredClone(this.saved);
  }

  saveConfig(cfg: PolyConfig): void {
    this.saveCalls++;
    this.saved = structuredClone(cfg);
  }

  status(): Promise<StatusRow[]> {
    this.statusCalls++;
    return Promise.resolve(fakeStatus());
  }

  month(): string {
    return "2026-09";
  }

  async testEngine(id: string, kind: "search" | "fetch", arg: string): Promise<TestResult> {
    this.testCalls.push({ id, kind, arg });
    return kind === "search" ? { ok: true, ms: 12, count: 3 } : { ok: true, ms: 9, chars: 456 };
  }

  historyList(limit: number): HistoryEntry[] {
    this.historyLimits.push(limit);
    return HISTORY.slice(0, Math.max(limit, 0));
  }

  historyClear(): void {
    this.clearCalls++;
  }
}

function makeApp(cfg: PolyConfig = baseConfig()) {
  const deps = new FakeDeps(cfg);
  return { deps, app: buildWebApp(deps) };
}

/* ---------- GET /api/config ---------- */

test("GET /api/config liefert hasKey/keyMasked/extrasSet/enginesMeta", async () => {
  const { app } = makeApp();
  const res = await app.request("/api/config");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.version, 1);
  const tavily = body.engines.find((e: any) => e.id === "tavily");
  assert.equal(tavily.hasKey, true);
  assert.equal(tavily.keyMasked, "tvly-s…1234"); // maskKey: >10 Zeichen → 6 vorne, 4 hinten
  const google = body.engines.find((e: any) => e.id === "google");
  assert.equal(google.hasKey, false);
  assert.equal(google.keyMasked, "");
  assert.deepEqual(google.extrasSet, { cx: true });
  const jina = body.engines.find((e: any) => e.id === "jina");
  assert.deepEqual(jina.extrasSet, {});

  assert.equal(body.enginesMeta.length, 3);
  assert.deepEqual(
    body.enginesMeta.map((m: any) => m.id),
    ["tavily", "google", "jina"],
  );
  const gMeta = body.enginesMeta.find((m: any) => m.id === "google");
  assert.deepEqual(gMeta.extraFields, [{ key: "cx", label: "Search-CX" }]);

  assert.deepEqual(body.fetchOrder, ["tavily", "jina"]);
  assert.equal(body.settings.port, 6277);
  assert.equal(body.settings.tokenSet, true);
});

/* ---------- PUT /api/config: Merge-Semantik ---------- */

test("PUT /api/config: apiKey undefined, \"\" und Whitespace behalten den alten Key", async () => {
  for (const apiKey of [undefined, "", "   "]) {
    const { deps, app } = makeApp();
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engines: [{ id: "tavily", enabled: true, apiKey }] }),
    });
    assert.equal(res.status, 200);
    const tavily = deps.saved.engines.find((e) => e.id === "tavily");
    assert.equal(tavily?.apiKey, "tvly-secret-1234", `apiKey=${JSON.stringify(apiKey)} muss erhalten bleiben`);
  }
});

test("PUT /api/config: apiKey null löscht den Key", async () => {
  const { deps, app } = makeApp();
  const res = await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "tavily", enabled: true, apiKey: null }] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  const tavily = deps.saved.engines.find((e) => e.id === "tavily");
  assert.equal(tavily?.apiKey, undefined);
  const shown = body.config.engines.find((e: any) => e.id === "tavily");
  assert.equal(shown.hasKey, false);
  assert.equal(shown.keyMasked, "");
});

test("PUT /api/config: apiKey String setzt getrimmten Key", async () => {
  const { deps, app } = makeApp();
  const res = await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "tavily", enabled: true, apiKey: "  sk-live-9999  " }] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const tavily = deps.saved.engines.find((e) => e.id === "tavily");
  assert.equal(tavily?.apiKey, "sk-live-9999");
  assert.equal(body.config.engines.find((e: any) => e.id === "tavily").keyMasked, "sk-liv…9999");
});

test("PUT /api/config: extraFields setzen (getrimmt), behalten und per null löschen", async () => {
  const { deps, app } = makeApp();

  // setzen + trimmen
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "google", enabled: true, extra: { cx: "  neu-cx  " } }] }),
  });
  let google = deps.saved.engines.find((e) => e.id === "google");
  assert.equal(google?.extra?.cx, "neu-cx");

  // kein extra im Body → alter Wert bleibt
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "google", enabled: true }] }),
  });
  google = deps.saved.engines.find((e) => e.id === "google");
  assert.equal(google?.extra?.cx, "neu-cx");

  // Whitespace-Value wird ignoriert (alter Wert bleibt)
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "google", enabled: true, extra: { cx: "   " } }] }),
  });
  google = deps.saved.engines.find((e) => e.id === "google");
  assert.equal(google?.extra?.cx, "neu-cx");

  // null löscht → extra-Feld komplett entfernt
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "google", enabled: true, extra: { cx: null } }] }),
  });
  google = deps.saved.engines.find((e) => e.id === "google");
  assert.equal(google?.extra, undefined);
});

test("PUT /api/config: extra für Engine ohne extraFields in der Meta wird ignoriert", async () => {
  const { deps, app } = makeApp();
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "tavily", enabled: true, extra: { cx: "x" } }] }),
  });
  const tavily = deps.saved.engines.find((e) => e.id === "tavily");
  assert.equal(tavily?.extra, undefined);
});

test("PUT /api/config: Engine ohne Body-Eintrag wird aus Altbestand übernommen, unbekannte ID gefiltert, enabled bleibt", async () => {
  const { deps, app } = makeApp();
  const res = await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "tavily", enabled: false }, { id: "gibtsnicht", enabled: true, apiKey: "x" }] }),
  });
  assert.equal(res.status, 200);

  const ids = deps.saved.engines.map((e) => e.id);
  assert.deepEqual(ids, ["tavily", "google", "jina"]); // "gibtsnicht" raus, google/jina aus Altbestand

  const tavily = deps.saved.engines.find((e) => e.id === "tavily");
  assert.equal(tavily?.enabled, false);
  assert.equal(tavily?.apiKey, "tvly-secret-1234"); // Altbestand unangetastet

  const google = deps.saved.engines.find((e) => e.id === "google");
  assert.equal(google?.enabled, false);
  assert.equal(google?.extra?.cx, "alt");

  const jina = deps.saved.engines.find((e) => e.id === "jina");
  assert.equal(jina?.enabled, true);
});

test("PUT /api/config: fetchOrder wird auf Fetch-fähige Engines gefiltert, Fehlende aus Altbestand angehängt", async () => {
  const { deps, app } = makeApp();
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "tavily" }], fetchOrder: ["jina", "nope", "google"] }),
  });
  // "google" hat kein fetch-Capability, "nope" ist unbekannt; danach Altbestand ["tavily","jina"] ergänzen
  assert.deepEqual(deps.saved.fetchOrder, ["jina", "tavily"]);
});

test("PUT /api/config: fetchOrder ohne Array → Altbestand bleibt unverändert", async () => {
  const { deps, app } = makeApp();
  await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: [{ id: "tavily" }], fetchOrder: 42 }),
  });
  assert.deepEqual(deps.saved.fetchOrder, ["tavily", "jina"]);
});

test("PUT /api/config: Port wird auf 1024–65535 geklemmt (auch Nicht-Zahlen)", async () => {
  const { deps, app } = makeApp();
  const put = (port: unknown) =>
    app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engines: [{ id: "tavily" }], settings: { port } }),
    });

  await put(80); // zu klein → ignoriert
  assert.equal(deps.saved.settings.port, 6277);
  await put(70000); // zu groß → ignoriert
  assert.equal(deps.saved.settings.port, 6277);
  await put("9000"); // kein number → ignoriert
  assert.equal(deps.saved.settings.port, 6277);
  await put(8080);
  assert.equal(deps.saved.settings.port, 8080);
  await put(1024); // untere Grenze → gültig
  assert.equal(deps.saved.settings.port, 1024);
  await put(65535); // obere Grenze → gültig
  assert.equal(deps.saved.settings.port, 65535);
});

test("PUT /api/config: Token null löscht, String wird getrimmt, sonst bleibt er", async () => {
  const { deps, app } = makeApp();
  const put = (token: unknown) =>
    app.request("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engines: [{ id: "tavily" }], settings: { token } }),
    });

  await put(undefined);
  assert.equal(deps.saved.settings.token, "alt-token");
  await put("  tok-neu  ");
  assert.equal(deps.saved.settings.token, "tok-neu");
  await put(null);
  assert.equal(deps.saved.settings.token, "");
});

test("PUT /api/config: ohne engines-Array bzw. kaputtes JSON → 400", async () => {
  const { deps, app } = makeApp();

  const res1 = await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engines: "kein-array" }),
  });
  assert.equal(res1.status, 400);
  assert.equal((await res1.json()).error, "engines[] erwartet");

  const res2 = await app.request("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "kein json",
  });
  assert.equal(res2.status, 400);

  assert.equal(deps.saveCalls, 0); // nichts gespeichert
  assert.equal(deps.saved.settings.port, 6277);
});

/* ---------- History ---------- */

test("GET /api/history: Standard-Limit 50, NaN → 50, Slider-Wert wird durchgereicht", async () => {
  const { deps, app } = makeApp();

  const res1 = await app.request("/api/history");
  assert.equal(res1.status, 200);
  assert.equal(deps.historyLimits.at(-1), 50);
  assert.equal((await res1.json()).entries.length, 3);

  await app.request("/api/history?limit=abc"); // Number("abc") = NaN → 50
  assert.equal(deps.historyLimits.at(-1), 50);

  await app.request("/api/history?limit=25"); // Slider
  assert.equal(deps.historyLimits.at(-1), 25);
  const res2 = await app.request("/api/history?limit=2");
  assert.equal((await res2.json()).entries.length, 2);
});

test("FIXED: GET /api/history?limit= (leerer String) ergibt Limit 50 — Number(\"\") ist 0", async () => {
  // Ehemals dokumentiertes Randverhalten (Limit 0); seit dem Fix in
  // src/web/app.ts wird explizit > 0 geprüft → 50.
  const { deps, app } = makeApp();
  const res = await app.request("/api/history?limit=");
  assert.equal(res.status, 200);
  assert.equal(deps.historyLimits.at(-1), 50);
});

test("DELETE /api/history ruft historyClear und antwortet {ok:true}", async () => {
  const { deps, app } = makeApp();
  const res = await app.request("/api/history", { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(deps.clearCalls, 1);
});

/* ---------- POST /api/test ---------- */

test("POST /api/test: fehlende/nicht-String/unbekannte Engine-ID → 400", async () => {
  const { deps, app } = makeApp();
  for (const id of [undefined, 42, "unbekannt"]) {
    const res = await app.request("/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    assert.equal(res.status, 400, `id=${JSON.stringify(id)} muss 400 liefern`);
    assert.equal((await res.json()).error, "unbekannte Engine");
  }
  assert.equal(deps.testCalls.length, 0);
});

test("POST /api/test: bekannte Engine → testEngine mit kind=search und Default-arg", async () => {
  const { deps, app } = makeApp();
  const res = await app.request("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "tavily" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(deps.testCalls, [{ id: "tavily", kind: "search", arg: "model context protocol" }]);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, ms: 12, count: 3 });
});

test("POST /api/test: kind=fetch mit Default-arg bzw. explizitem arg", async () => {
  const { deps, app } = makeApp();

  await app.request("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "jina", kind: "fetch" }),
  });
  assert.deepEqual(deps.testCalls.at(-1), { id: "jina", kind: "fetch", arg: "https://example.com" });

  const res = await app.request("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "jina", kind: "fetch", arg: "https://robin.example" }),
  });
  assert.deepEqual(deps.testCalls.at(-1), { id: "jina", kind: "fetch", arg: "https://robin.example" });
  assert.deepEqual(await res.json(), { ok: true, ms: 9, chars: 456 });
});

test("POST /api/test: kind außer fetch fällt auf search zurück", async () => {
  const { deps, app } = makeApp();
  await app.request("/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "tavily", kind: "bullerbü" }),
  });
  assert.deepEqual(deps.testCalls.at(-1), { id: "tavily", kind: "search", arg: "model context protocol" });
});

/* ---------- Statische Dateien & restliche Routen ---------- */

test("GET / liefert Dashboard-HTML mit id=\"lang\" und text/html", async () => {
  const { app } = makeApp();
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  const html = await res.text();
  assert.match(html, /id="lang"/);
  assert.match(html, /<script src="\/app\.js"><\/script>/);
});

test("GET /app.js, /i18n.js und /style.css mit korrektem Content-Type", async () => {
  const { app } = makeApp();

  const js = await app.request("/app.js");
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("content-type"), "text/javascript; charset=utf-8");
  // Übersetzungen leben seit dem SPA-Redesign in i18n.js; app.js konsumiert window.I18N
  assert.match(await js.text(), /window\.I18N/);

  const i18n = await app.request("/i18n.js");
  assert.equal(i18n.status, 200);
  assert.equal(i18n.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await i18n.text(), /window\.I18N = \{/);

  const css = await app.request("/style.css");
  assert.equal(css.status, 200);
  assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
  assert.ok((await css.text()).length > 0);
});

test("GET /api/status und /api/meta nutzen die injizierten Deps", async () => {
  const { deps, app } = makeApp();

  const meta = await app.request("/api/meta");
  assert.equal(meta.status, 200);
  // Version gegen die echte Quelle vergleichen — nicht hart pinnt (Bump-sicher)
  assert.deepEqual(await meta.json(), { version: VERSION, configPath: deps.configPath, month: "2026-09" });

  const status = await app.request("/api/status");
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(deps.statusCalls, 1);
  assert.equal(body.month, "2026-09");
  assert.equal(body.configPath, deps.configPath);
  assert.equal(body.engines[0].id, "tavily");
  assert.equal(body.engines[0].remainingPct, 99);
});
