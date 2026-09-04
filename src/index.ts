#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigStore, configDir } from "./config.js";
import { ADAPTERS, SEARCH_ORDER, FETCH_ORDER, DEFAULT_ENABLED, KNOWN_IDS } from "./engines/index.js";
import { UsageStore } from "./usage.js";
import { SearchRouter } from "./router.js";
import { buildStatus } from "./status.js";
import { buildMcpServer } from "./mcp/server.js";
import { mountMcpHttp } from "./mcp/http.js";
import { buildWebApp } from "./web/app.js";
import type { TestResult } from "./types.js";
import { VERSION } from "./version.js";

function findFreePort(start: number, host: string, tries = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number) => {
      if (port > start + tries) {
        reject(new Error(`Kein freier Port ab ${start} gefunden`));
        return;
      }
      const srv = createServer();
      srv.unref();
      srv.on("error", () => attempt(port + 1));
      srv.listen(port, host, () => {
        srv.close(() => resolve(port));
      });
    };
    attempt(start);
  });
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "win32")
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* nicht fatal */
  }
}

async function main(): Promise<void> {
  const args = parseArgs({
    options: {
      http: { type: "boolean", default: false },
      port: { type: "string" },
      host: { type: "string" },
      token: { type: "string" },
      open: { type: "boolean", default: false },
      "no-dashboard": { type: "boolean", default: false },
    },
  }).values;

  const store = new ConfigStore();
  const defaults = {
    knownIds: KNOWN_IDS,
    searchOrder: SEARCH_ORDER,
    fetchOrder: FETCH_ORDER,
    defaultEnabled: DEFAULT_ENABLED,
  };
  let cfg = store.load(defaults);
  const usage = new UsageStore(configDir());
  const router = new SearchRouter({ getConfig: () => cfg, usage, adapters: ADAPTERS });

  const month = () => usage.monthKey();
  const status = () => buildStatus(cfg, usage, ADAPTERS);

  const testEngine = async (id: string, kind: "search" | "fetch", arg: string): Promise<TestResult> => {
    const adapter = ADAPTERS.find((a) => a.meta.id === id);
    if (!adapter) return { ok: false, ms: 0, error: "unbekannte Engine" };
    const e = cfg.engines.find((x) => x.id === id);
    const ctx = { apiKey: e?.apiKey, extra: e?.extra };
    const t0 = Date.now();
    try {
      if (kind === "search") {
        if (!adapter.search) return { ok: false, ms: 0, error: "Engine kann nicht suchen" };
        const out = await adapter.search({ query: arg || "model context protocol", numResults: 3 }, ctx);
        usage.record(id, "search");
        return {
          ok: true,
          ms: Date.now() - t0,
          count: out.items.length,
          preview: out.items
            .slice(0, 3)
            .map((i) => `${i.title} — ${i.url}`)
            .join("\n"),
        };
      }
      if (!adapter.fetchUrl) return { ok: false, ms: 0, error: "Engine kann nicht fetchen" };
      const md = await adapter.fetchUrl({ url: arg || "https://example.com" }, ctx);
      usage.record(id, "fetch");
      return { ok: true, ms: Date.now() - t0, chars: md.length, preview: md.slice(0, 400) };
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const token = args.token ?? process.env.SEARCH_ROTATION_TOKEN ?? cfg.settings.token;
  const host = args.host ?? "127.0.0.1";
  const dashboardEnabled = !args["no-dashboard"];
  const port = dashboardEnabled ? await findFreePort(args.port ? Number(args.port) : cfg.settings.port, host) : 0;

  const dashboardUrl = () =>
    dashboardEnabled
      ? `http://${host}:${port}/` + (token ? `?token=${encodeURIComponent(token)}` : "")
      : "Dashboard deaktiviert (--no-dashboard)";

  const mcpDeps = {
    router,
    status,
    month,
    dashboardUrl,
    openDashboard: () => {
      if (dashboardEnabled) openBrowser(dashboardUrl());
    },
  };

  const app = new Hono();

  // Optionaler Token-Schutz für Dashboard, API und /mcp (z. B. bei Remote-Betrieb)
  if (token) {
    app.use("*", async (c, next) => {
      const url = new URL(c.req.url);
      const provided =
        c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token") ?? "";
      if (provided !== token) {
        return c.text("401 — Token fehlt oder falsch (URL mit ?token=… öffnen oder Authorization: Bearer setzen)", 401);
      }
      await next();
    });
  }

  app.route(
    "/",
    buildWebApp({
      configPath: store.file,
      getConfig: () => cfg,
      saveConfig: (next) => {
        store.save(next);
        cfg = next;
      },
      adapters: ADAPTERS,
      status,
      month,
      testEngine,
    }),
  );
  mountMcpHttp(app, mcpDeps);

  if (dashboardEnabled) {
    serve({ fetch: app.fetch, port, hostname: host });
    console.error(`[search-rotation] Dashboard: ${dashboardUrl()}`);
  }

  if (args.http) {
    console.error(
      `[search-rotation] v${VERSION} — MCP (Streamable HTTP): http://${host}:${port}/mcp` +
        (token ? " (Bearer-Token nötig)" : ""),
    );
  } else {
    const mcp = buildMcpServer(mcpDeps);
    await mcp.connect(new StdioServerTransport());
    // Sauberer Exit, wenn der MCP-Client stdin schließt (sonst hält der
    // Dashboard-HTTP-Server den Prozess am Leben).
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("close", () => process.exit(0));
    console.error(
      `[search-rotation] v${VERSION} — MCP stdio aktiv.` +
        (dashboardEnabled ? ` Dashboard: ${dashboardUrl()}` : ""),
    );
  }

  if (args.open && dashboardEnabled) openBrowser(dashboardUrl());
}

main().catch((err: unknown) => {
  console.error(`[search-rotation] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
