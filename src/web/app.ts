import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { EngineAdapter, TestResult } from "../types.js";
import type { EngineConfig, PolyConfig } from "../config.js";
import type { HistoryEntry } from "../history.js";
import type { StatusRow } from "../status.js";
import { maskKey } from "../status.js";
import { VERSION } from "../version.js";

const staticDir = fileURLToPath(new URL("../../static/", import.meta.url));

export interface WebDeps {
  configPath: string;
  getConfig(): PolyConfig;
  saveConfig(cfg: PolyConfig): void;
  adapters: EngineAdapter[];
  status(): Promise<StatusRow[]>;
  month(): string;
  testEngine(id: string, kind: "search" | "fetch", arg: string): Promise<TestResult>;
  historyList(limit: number): HistoryEntry[];
  historyClear(): void;
}

function publicConfig(cfg: PolyConfig, adapters: EngineAdapter[]) {
  return {
    version: 1,
    engines: cfg.engines.map((e) => {
      const meta = adapters.find((a) => a.meta.id === e.id)?.meta;
      return {
        id: e.id,
        enabled: e.enabled,
        hasKey: Boolean(e.apiKey),
        keyMasked: maskKey(e.apiKey),
        extrasSet: Object.fromEntries(
          (meta?.extraFields ?? []).map((f) => [f.key, Boolean(e.extra?.[f.key])]),
        ),
      };
    }),
    fetchOrder: cfg.fetchOrder,
    settings: { port: cfg.settings.port, tokenSet: Boolean(cfg.settings.token) },
    enginesMeta: adapters.map((a) => a.meta),
  };
}

export function buildWebApp(deps: WebDeps) {
  const app = new Hono();

  const serve =
    (file: string, type: string) =>
    (c: any) =>
      c.body(readFileSync(path.join(staticDir, file), "utf8"), 200, { "content-type": type });

  app.get("/", serve("index.html", "text/html; charset=utf-8"));
  app.get("/app.js", serve("app.js", "text/javascript; charset=utf-8"));
  app.get("/style.css", serve("style.css", "text/css; charset=utf-8"));

  app.get("/api/meta", (c) =>
    c.json({ version: VERSION, configPath: deps.configPath, month: deps.month() }),
  );

  app.get("/api/config", (c) => c.json(publicConfig(deps.getConfig(), deps.adapters)));

  app.put("/api/config", async (c) => {
    const body: any = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.engines)) return c.json({ error: "engines[] erwartet" }, 400);

    const cfg = deps.getConfig();
    const known = new Map(deps.adapters.map((a) => [a.meta.id, a] as const));

    // Engines zusammenführen. apiKey: undefined/"" = unverändert, null = löschen, string = setzen.
    const merged: EngineConfig[] = body.engines
      .filter((e: any) => known.has(e?.id))
      .map((e: any): EngineConfig => {
        const prev = cfg.engines.find((x) => x.id === e.id);
        const next: EngineConfig = {
          id: e.id,
          enabled: typeof e.enabled === "boolean" ? e.enabled : prev?.enabled ?? true,
          apiKey:
            e.apiKey === null
              ? undefined
              : typeof e.apiKey === "string" && e.apiKey.trim()
                ? e.apiKey.trim()
                : prev?.apiKey,
        };
        const meta = known.get(e.id)!.meta;
        if (meta.extraFields?.length) {
          const extra: Record<string, string> = { ...(prev?.extra ?? {}) };
          for (const f of meta.extraFields) {
            const v = e.extra?.[f.key];
            if (v === null) delete extra[f.key];
            else if (typeof v === "string" && v.trim()) extra[f.key] = v.trim();
          }
          if (Object.keys(extra).length > 0) next.extra = extra;
        }
        return next;
      });
    for (const a of deps.adapters) {
      if (!merged.some((m) => m.id === a.meta.id)) {
        const prev = cfg.engines.find((x) => x.id === a.meta.id);
        merged.push(prev ?? { id: a.meta.id, enabled: a.meta.defaultEnabled ?? true });
      }
    }

    const fetchCapable = new Set(
      deps.adapters.filter((a) => a.meta.capabilities.includes("fetch")).map((a) => a.meta.id),
    );
    const fo: string[] = Array.isArray(body.fetchOrder)
      ? body.fetchOrder.filter((id: unknown) => typeof id === "string" && fetchCapable.has(id as string))
      : [];
    for (const id of cfg.fetchOrder) {
      if (!fo.includes(id)) fo.push(id);
    }

    const settings = { ...cfg.settings };
    if (
      typeof body.settings?.port === "number" &&
      body.settings.port >= 1024 &&
      body.settings.port <= 65535
    ) {
      settings.port = body.settings.port;
    }
    if (body.settings?.token === null) settings.token = "";
    else if (typeof body.settings?.token === "string") settings.token = body.settings.token.trim();

    deps.saveConfig({ version: 1, engines: merged, fetchOrder: fo, settings });
    return c.json({ ok: true, config: publicConfig(deps.getConfig(), deps.adapters) });
  });

  app.get("/api/status", async (c) =>
    c.json({
      version: VERSION,
      month: deps.month(),
      configPath: deps.configPath,
      engines: await deps.status(),
    }),
  );

  app.get("/api/history", (c) => {
    // Number("") wäre 0 — deshalb explizit > 0 prüfen
    const n = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(n) && n > 0 ? n : 50;
    return c.json({ entries: deps.historyList(limit) });
  });

  app.delete("/api/history", (c) => {
    deps.historyClear();
    return c.json({ ok: true });
  });

  app.post("/api/test", async (c) => {
    const body: any = await c.req.json().catch(() => null);
    const id = body?.id;
    const kind = body?.kind === "fetch" ? "fetch" : "search";
    if (typeof id !== "string" || !deps.adapters.some((a) => a.meta.id === id)) {
      return c.json({ error: "unbekannte Engine" }, 400);
    }
    const arg = String(
      body?.arg ?? (kind === "search" ? "model context protocol" : "https://example.com"),
    );
    return c.json(await deps.testEngine(id, kind, arg));
  });

  return app;
}
