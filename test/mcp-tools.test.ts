import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, type McpDeps } from "../src/mcp/server.js";
import { mountMcpHttp } from "../src/mcp/http.js";
import { SearchRouter } from "../src/router.js";
import { UsageStore } from "../src/usage.js";
import type { PolyConfig } from "../src/config.js";
import type { EngineAdapter, SearchInput, SearchOutcome } from "../src/types.js";
import type { StatusRow } from "../src/status.js";

// ---------------------------------------------------------------- Helfer

function tmpUsage(): UsageStore {
  return new UsageStore(mkdtempSync(join(tmpdir(), "sr-mcp-test-")));
}

function cfg(engines: { id: string; enabled: boolean }[], fetchOrder: string[] = []): PolyConfig {
  return {
    version: 1,
    engines,
    fetchOrder,
    settings: { port: 6277, token: "", monthlyLimits: {} },
  };
}

function adapter(
  id: string,
  impl: {
    search?: (input: SearchInput) => Promise<SearchOutcome>;
    fetchUrl?: (input: { url: string }) => Promise<string>;
  } = {},
): EngineAdapter {
  const a: EngineAdapter = {
    meta: {
      id,
      label: id,
      homepage: "https://example.com",
      signupUrl: "https://example.com",
      keyless: "no",
      capabilities: [],
      monthlyFree: 1000,
      quotaEndpoint: false,
    },
  };
  if (impl.search) {
    a.meta.capabilities.push("search");
    a.search = impl.search;
  }
  if (impl.fetchUrl) {
    a.meta.capabilities.push("fetch");
    a.fetchUrl = impl.fetchUrl;
  }
  return a;
}

function searchRouter(adapters: EngineAdapter[], fetchOrder: string[] = []): SearchRouter {
  return new SearchRouter({
    getConfig: () => cfg(adapters.map((a) => ({ id: a.meta.id, enabled: true })), fetchOrder),
    usage: tmpUsage(),
    adapters,
  });
}

function statusRow(overrides: Partial<StatusRow> = {}): StatusRow {
  return {
    id: "tavily",
    label: "Tavily",
    homepage: "https://tavily.com",
    signupUrl: "https://app.tavily.com",
    capabilities: ["search", "fetch"],
    keyless: "no",
    extraFields: [],
    enabled: true,
    searchPosition: 0,
    fetchPosition: 0,
    hasKey: false,
    keyMasked: "",
    extrasSet: {},
    monthlyLimit: 1000,
    used: { search: 12, fetch: 3, errors: 0 },
    remote: null,
    remainingPct: 0.985,
    ...overrides,
  };
}

function fakeDeps(
  router: SearchRouter,
  statusRows: StatusRow[] = [],
): { deps: McpDeps; opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    deps: {
      router,
      status: async () => statusRows,
      month: () => "2026-09",
      dashboardUrl: () => "http://127.0.0.1:6277/?token=geheim",
      openDashboard: () => {
        opened.push("open");
      },
    },
  };
}

/** bautMcpServer über InMemory-Transport mit einem Test-Client verbinden. */
async function connect(deps: McpDeps): Promise<Client> {
  const server = buildMcpServer(deps);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  await client.connect(clientT);
  return client;
}

function text(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

// ---------------------------------------------------------------- Tests

test("initialize advertises self-contained dashboard icons for both themes", async () => {
  const { deps } = fakeDeps(searchRouter([adapter("a", { search: async () => ({ items: [] }) })]));
  const client = await connect(deps);
  try {
    const icons = client.getServerVersion()?.icons;
    assert.equal(icons?.length, 2);
    assert.deepEqual(icons?.map(icon => icon.theme), ["light", "dark"]);
    for (const icon of icons ?? []) {
      assert.equal(icon.mimeType, "image/png");
      assert.deepEqual(icon.sizes, ["128x128"]);
      assert.ok(icon.src.startsWith("data:image/png;base64,"));
      const bytes = Buffer.from(icon.src.split(",")[1], "base64");
      assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    }
  } finally { await client.close(); }
});

test("tools/list: alle vier Tools mit korrekten Schemata", async () => {
  const { deps } = fakeDeps(searchRouter([adapter("a", { search: async () => ({ items: [] }) })]));
  const client = await connect(deps);

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["engine_status", "fetch_url", "open_dashboard", "web_search"],
  );

  const search = tools.find((t) => t.name === "web_search")!;
  const sProps = search.inputSchema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(search.inputSchema.required, ["query"]);
  assert.equal(sProps.query?.type, "string");
  const num = sProps.numResults ?? {};
  assert.ok(num.type === "integer" || num.type === "number", `numResults-Typ: ${num.type}`);
  assert.equal(num.minimum, 1);
  assert.equal(num.maximum, 20);
  assert.ok(!search.inputSchema.required!.includes("numResults"));
  assert.ok(!search.inputSchema.required!.includes("engine"));
  assert.equal(sProps.engine?.type, "string");

  const fetch = tools.find((t) => t.name === "fetch_url")!;
  const fProps = fetch.inputSchema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(fetch.inputSchema.required, ["url"]);
  assert.equal(fProps.url?.type, "string");
  assert.equal(fProps.url?.format, "uri");

  for (const name of ["engine_status", "open_dashboard"] as const) {
    const tool = tools.find((t) => t.name === name)!;
    assert.deepEqual(tool.inputSchema.required ?? [], []);
  }
});

test("web_search: nummerierte Ergebnisse, Engine-Namen und Failover-Zeile", async () => {
  const adapters = [
    adapter("a", {
      search: async () => {
        throw new Error("429 zu viele Anfragen");
      },
    }),
    adapter("b", {
      search: async () => ({
        items: [
          { title: "Erster Treffer", url: "https://b.example/eins", snippet: "Snippet  mit   whitespace" },
          { title: "Zweiter Treffer", url: "https://b.example/zwei" },
        ],
      }),
    }),
  ];
  const { deps } = fakeDeps(searchRouter(adapters));
  const client = await connect(deps);

  // Erster Rotationsschritt startet bei "a" → a wirft, b antwortet.
  const r = await client.callTool({ name: "web_search", arguments: { query: "test" } });
  assert.notEqual(r.isError, true);
  const t = text(r);
  assert.match(t, /^Search "test" via b \(2 results\)/);
  assert.match(t, /1\. Erster Treffer\n {3}https:\/\/b\.example\/eins\n {3}Snippet mit whitespace/);
  assert.match(t, /2\. Zweiter Treffer\n {3}https:\/\/b\.example\/zwei/);
  assert.match(t, /Failover after: a: 429 zu viele Anfragen/);
  assert.ok(!t.includes("via a"), "fehlgeschlagene Engine darf nicht als Ergebnis-Engine erscheinen");
});

test("web_search: engine-Parameter pinnt Engine vorne (preferEngine), numResults wird durchgereicht", async () => {
  const seen: SearchInput[] = [];
  const adapters = [
    adapter("a", {
      search: async (input) => {
        seen.push(input);
        return { items: [{ title: "aus a", url: "https://a.example" }] };
      },
    }),
    adapter("b", {
      search: async (input) => {
        seen.push(input);
        return { items: [{ title: "aus b", url: "https://b.example" }] };
      },
    }),
  ];
  const { deps } = fakeDeps(searchRouter(adapters));
  const client = await connect(deps);

  // Ohne Pin würde der Round Robin über 4 Aufrufe mindestens zweimal "a" wählen.
  for (let i = 0; i < 4; i++) {
    const r = await client.callTool({
      name: "web_search",
      arguments: { query: "q", numResults: 3, engine: "b" },
    });
    assert.notEqual(r.isError, true);
    assert.match(text(r), /via b \(1 results?\)/, `Aufruf ${i + 1} muss Engine b nutzen`);
  }
  assert.equal(seen.length, 4);
  for (const input of seen) {
    assert.equal(input.query, "q");
    assert.equal(input.numResults, 3);
  }
});

test("fetch_url: Failover-Zeile und Truncation bei > 50.000 Zeichen", async () => {
  const adapters = [
    adapter("a", {
      fetchUrl: async () => {
        throw new Error("kaputt");
      },
    }),
    adapter("b", { fetchUrl: async () => "x".repeat(60_000) }),
  ];
  const { deps } = fakeDeps(searchRouter(adapters, ["a", "b"]));
  const client = await connect(deps);

  const r = await client.callTool({
    name: "fetch_url",
    arguments: { url: "https://example.com/seite" },
  });
  assert.notEqual(r.isError, true);
  const t = text(r);
  const head = "Fetched https://example.com/seite via b (failover after: a: kaputt)";
  assert.ok(t.startsWith(head), `Head-Zeile fehlt: ${t.slice(0, head.length)}`);
  assert.ok(t.includes("truncated, 60000 chars total"), "Truncation-Hinweis fehlt");
  assert.ok(t.endsWith("chars total]"));

  const rest = t.slice(head.length + 2); // "\n\n" hinter dem Head überspringen
  const md = rest.slice(0, rest.indexOf("\n\n[… truncated"));
  assert.equal(md.length, 50_000);
});

test("fetch_url: genau 50.000 Zeichen werden nicht gekürzt", async () => {
  const adapters = [adapter("b", { fetchUrl: async () => "y".repeat(50_000) })];
  const { deps } = fakeDeps(searchRouter(adapters, ["b"]));
  const client = await connect(deps);

  const r = await client.callTool({
    name: "fetch_url",
    arguments: { url: "https://example.com" },
  });
  assert.notEqual(r.isError, true);
  const t = text(r);
  assert.ok(!t.includes("truncated"), "Grenzwert darf nicht gekürzt werden");
  assert.match(t, /^Fetched https:\/\/example\.com via b\n\n/);
  assert.equal(t.length, "Fetched https://example.com via b".length + 2 + 50_000);
});

test("engine_status distinguishes disabled configuration, keyless search and historical errors", async () => {
  const rows = [
    statusRow({ id: "duckduckgo", label: "DuckDuckGo", keyless: "ip", enabled: false, capabilities: ["search"] }),
    statusRow({ keyless: "ip", capabilities: ["search"], supportedCapabilities: ["search", "fetch"], keylessCapabilities: ["search"],
      lastError: "2026-09-01T10:00:00.000Z: API key required", used: { search: 12, fetch: 0, errors: 1 } }),
    statusRow({ id: "google-cse", label: "Google", capabilities: ["search"], extraFields: [{ key: "cx", label: "Search engine ID" }], extrasSet: { cx: false } }),
    statusRow({ id: "firecrawl", label: "Firecrawl", keyless: "ip", hasKey: true, keyMasked: "fc-secret-fragment", quota: { period: "month", unit: "credits", used: 182, limit: 1000, source: "remote", estimated: false } }),
  ];
  const { deps } = fakeDeps(searchRouter([adapter("a", { search: async () => ({ items: [] }) })]), rows);
  const client = await connect(deps);
  try {
    const result = await client.callTool({ name: "engine_status", arguments: {} });
    assert.notEqual(result.isError, true);
    const data = result.structuredContent as any;
    assert.deepEqual(JSON.parse(text(result)), data, "text-only clients receive the same facts");
    const [ddg, tavily, google, firecrawl] = data.engines;
    assert.equal(ddg.enabled, false);
    assert.equal(ddg.disabledReason, "disabled_in_configuration; original reason not recorded");
    assert.equal(ddg.access.search.mode, "keyless");
    assert.equal(ddg.access.search.includedInRotation, false);
    assert.equal(tavily.access.search.mode, "keyless");
    assert.equal(tavily.access.search.includedInRotation, true);
    assert.equal(tavily.access.fetch.mode, "api_key_required");
    assert.equal(tavily.access.fetch.includedInRotation, false);
    assert.equal(tavily.diagnostics.lastRecordedError, rows[1].lastError);
    assert.equal(tavily.diagnostics.currentHealth, "not_tested");
    assert.equal(tavily.quota.limit, null);
    assert.equal(tavily.quota.providerTotalUsed, null);
    assert.equal(tavily.localUsage.successfulSearches, 12);
    assert.equal(google.access.search.mode, "api_key_required");
    assert.deepEqual(google.missingExtraConfiguration, ["cx"]);
    assert.equal(firecrawl.access.search.mode, "configured_key");
    assert.equal(firecrawl.quota.scope, "provider_account_balance");
    assert.equal(firecrawl.quota.period, null);
    assert.doesNotMatch(text(result), /fc-secret-fragment/);
    assert.match(data.interpretation.join(" "), /Historical errors.*current failure/);
  } finally { await client.close(); }
});

test("open_dashboard: ruft den Opener auf und nennt die URL", async () => {
  const { deps, opened } = fakeDeps(searchRouter([adapter("a", { search: async () => ({ items: [] }) })]));
  const client = await connect(deps);

  const r = await client.callTool({ name: "open_dashboard", arguments: {} });
  assert.notEqual(r.isError, true);
  assert.deepEqual(opened, ["open"]);
  assert.match(text(r), /Dashboard: http:\/\/127\.0\.0\.1:6277\/\?token=geheim/);
});

test("Fehlerpfad: RouterError kommt als isError-Ergebnis an (keine Exception)", async () => {
  // Verifiziertes Verhalten (SDK 1.30): createToolError() fängt Handler-Fehler
  // und liefert CallToolResult { isError: true, content: [text(message)] }.
  const adapters = [
    adapter("a", {
      search: async () => {
        throw new Error("kaputt");
      },
      fetchUrl: async () => {
        throw new Error("kaputt");
      },
    }),
    adapter("b", {
      search: async () => {
        throw new Error("auch kaputt");
      },
      fetchUrl: async () => {
        throw new Error("auch kaputt");
      },
    }),
  ];
  const { deps } = fakeDeps(searchRouter(adapters, ["a", "b"]));
  const client = await connect(deps);

  const search = await client.callTool({ name: "web_search", arguments: { query: "q" } });
  assert.equal(search.isError, true);
  assert.match(text(search), /Alle 2 Such-Engines fehlgeschlagen\./);

  const fetch = await client.callTool({ name: "fetch_url", arguments: { url: "https://example.com" } });
  assert.equal(fetch.isError, true);
  assert.match(text(fetch), /Alle 2 Fetch-Engines fehlgeschlagen\./);
});

test("Fehlerpfad: Schema-Verstoß (numResults > 20) kommt als isError-Ergebnis an", async () => {
  // Verifiziertes Verhalten: Der SDK-Tool-Handler fängt auch McpError(InvalidParams)
  // und verpackt ihn als isError-Result statt als JSON-RPC-Fehler.
  const { deps } = fakeDeps(searchRouter([adapter("a", { search: async () => ({ items: [] }) })]));
  const client = await connect(deps);

  const r = await client.callTool({
    name: "web_search",
    arguments: { query: "q", numResults: 25 },
  });
  assert.equal(r.isError, true);
  assert.match(text(r), /Invalid arguments for tool web_search/);
});

// --- Dokumentierte Bugs in src/mcp/* (Suite bleibt grün: Skips laufen nicht) ---

test("FIXED: GET /mcp antwortet im Stateless-Modus mit 405 + Allow: POST", async () => {
  // Ehemals dokumentierter Bug: der setTimeout(0)-Cleanup schloss den
  // Standalone-SSE-Stream sofort → Client-Reconnect-Loop. Seit dem Fix in
  // src/mcp/http.ts wird GET vorab mit 405 beantwortet (stateless kann keinen
  // langlebigen SSE-Kanal je liefern).
  const deps = {
    router: {} as never,
    status: async () => [],
    month: () => "2026-09",
    dashboardUrl: () => null,
    openDashboard: () => {},
  } as unknown as McpDeps;
  const app = new Hono();
  mountMcpHttp(app, deps);
  const res = await app.request("/mcp", {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});

test('web_search exposes and forwards time filters, prints publication dates and rejects invalid input', async () => {
  let received: SearchInput | undefined;
  const a = adapter('a', { search: async input => { received = input; return { items: [{ title: 'Paper', url: 'https://example.com', published: '2026-08-15' }] }; } });
  a.supportsSearchTime = () => true;
  const { deps } = fakeDeps(searchRouter([a]));
  const client = await connect(deps);
  try {
    const schema = (await client.listTools()).tools.find(tool => tool.name === 'web_search')!.inputSchema;
    for (const key of ['timeRange', 'startDate', 'endDate']) assert.ok(schema.properties?.[key]);
    const result = await client.callTool({ name: 'web_search', arguments: { query: 'q', startDate: '2026-08-01', endDate: '2026-08-31' } });
    assert.equal(result.isError, undefined);
    assert.equal(received?.startDate, '2026-08-01');
    assert.equal(received?.endDate, '2026-08-31');
    assert.match(text(result), /Published: 2026-08-15/);
    assert.match(text(result), /Time filter: from 2026-08-01 through 2026-08-31/);
    for (const args of [{ startDate: '2026-02-30' }, { timeRange: 'hour' }, { timeRange: 'week', endDate: '2026-09-01' }]) {
      received = undefined;
      const bad = await client.callTool({ name: 'web_search', arguments: { query: 'q', ...args } });
      assert.equal(bad.isError, true);
      assert.equal(received, undefined);
    }
  } finally { await client.close(); }
});
