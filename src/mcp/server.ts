import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RouterError, type SearchRouter } from "../router.js";
import type { StatusRow } from "../status.js";
import { VERSION } from "../version.js";

export interface McpDeps {
  router: SearchRouter;
  /** Bound only to this HTTP request; stdio uses the MCP cancellation signal. */
  requestSignal?: AbortSignal;
  status(): Promise<StatusRow[]>;
  month(): string;
  /** null = Dashboard deaktiviert (--no-dashboard) */
  dashboardUrl(): string | null;
  openDashboard(): void;
}

async function withRouterDiagnostics<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) {
    if (error instanceof RouterError && error.attempts.length) {
      throw new Error(`${error.message}\n${error.attempts.map(a => `${a.engine}: ${a.error ?? (a.ok ? "ok" : "fehlgeschlagen")}`).join("\n")}`);
    }
    throw error;
  }
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "search-rotation", version: VERSION });

  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description:
        "Web search with automatic round-robin across multiple free search APIs (Tavily, Firecrawl, Parallel, Exa, Google PSE, DuckDuckGo) including transparent failover. Returns numbered results with title, URL and snippet.",
      inputSchema: {
        query: z.string().describe("Search query"),
        numResults: z.number().int().min(1).max(20).optional().describe("Number of results (default 8)"),
        engine: z.string().optional().describe("Preferred engine id; failover to the other engines stays active"),
      },
    },
    async ({ query, numResults, engine }, extra) => {
      const r = await withRouterDiagnostics(deps.router.search({ query, numResults }, { preferEngine: engine, signal: deps.requestSignal ? AbortSignal.any([extra.signal, deps.requestSignal]) : extra.signal }));
      const lines = r.items.map((it, i) => {
        const snip = it.snippet ? `\n   ${it.snippet.replace(/\s+/g, " ").slice(0, 400)}` : "";
        return `${i + 1}. ${it.title}\n   ${it.url}${snip}`;
      });
      const failover = r.attempts.filter((a) => !a.ok).map((a) => `${a.engine}: ${a.error}`);
      const head = [`Search "${query}" via ${r.engine} (${r.items.length} results)`];
      if (r.answer) head.push(`Answer: ${r.answer}`);
      if (failover.length) head.push(`Failover after: ${failover.join("; ")}`);
      return { content: [{ type: "text", text: [...head, lines.join("\n")].join("\n\n") }] };
    },
  );

  server.registerTool(
    "fetch_url",
    {
      title: "Fetch URL",
      description:
        "Fetch a web page and return its content as markdown. Rotates across extraction providers (Jina Reader, Firecrawl, Parallel, Tavily, Exa) with failover.",
      inputSchema: {
        url: z.string().url().describe("URL to fetch"),
      },
    },
    async ({ url }, extra) => {
      const r = await withRouterDiagnostics(deps.router.fetchUrl({ url }, { signal: deps.requestSignal ? AbortSignal.any([extra.signal, deps.requestSignal]) : extra.signal }));
      const MAX = 50_000;
      const text =
        r.markdown.length > MAX
          ? `${r.markdown.slice(0, MAX)}\n\n[… truncated, ${r.markdown.length} chars total]`
          : r.markdown;
      const failover = r.attempts.filter((a) => !a.ok).map((a) => `${a.engine}: ${a.error}`);
      const head =
        `Fetched ${url} via ${r.engine}` + (failover.length ? ` (failover after: ${failover.join("; ")})` : "");
      return { content: [{ type: "text", text: `${head}\n\n${text}` }] };
    },
  );

  server.registerTool(
    "engine_status",
    {
      title: "Engine Status",
      description:
        "Show every search engine: enabled state, rotation position, remaining free quota (local counter plus provider quota API when available), key status and last errors.",
      inputSchema: {},
    },
    async () => {
      const rows = await deps.status();
      const lines = rows.map((row) => {
        const state = row.enabled ? "aktiv" : "aus";
        let quota = "kein festes Limit";
        if (row.quota) {
          const q = row.quota;
          const unit = q.unit === "credits" ? "Credits" : "Requests";
          const period = q.period === "day" ? "Tag" : "Monat";
          const source = q.source === "local" ? "lokal" : q.source === "remote" ? "remote" : "Quelle unbekannt";
          const details = [source, ...(q.estimated ? ["geschätzt"] : []), ...(q.timeZone ? [q.timeZone] : [])].join(", ");
          quota = q.period === "ip"
            ? `IP-basiert: Kontingent unbekannt (${details})`
            : `${q.used ?? "?"}/${q.limit ?? "unbekannt"} ${unit}/${period} (${details})`;
        } else if (row.remote?.limit) {
          quota = `remote: ${row.remote.used ?? "?"}/${row.remote.limit}`;
        } else if (row.monthlyLimit > 0) {
          quota = `${row.used.search + row.used.fetch}/${row.monthlyLimit} (lokal gezählt)`;
        }
        const key = row.hasKey
          ? `key ${row.keyMasked}`
          : row.keyless === "ip"
            ? "ohne Key (IP-basiert)"
            : "KEIN KEY";
        const warn = row.lastError ? ` | letzter Fehler: ${row.lastError.slice(0, 120)}` : "";
        return `${row.searchPosition + 1}. ${row.label} — ${state}, Quota: ${quota}, ${key}${warn}`;
      });
      return {
        content: [
          { type: "text", text: [`search-rotation v${VERSION} — Engine-Status (Monat ${deps.month()})`, "", ...lines].join("\n") },
        ],
      };
    },
  );

  server.registerTool(
    "open_dashboard",
    {
      title: "Open Dashboard",
      description:
        "Open the local dashboard (API keys, engine order and toggles, quota view) in a web browser. Use when the user wants to configure engines or check quota.",
      inputSchema: {},
    },
    async () => {
      const url = deps.dashboardUrl();
      if (!url) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Dashboard ist deaktiviert (gestartet mit --no-dashboard). Ohne Dashboard-Flag neu starten, um Keys/Reihenfolge/Kontingente zu konfigurieren.",
            },
          ],
        };
      }
      deps.openDashboard();
      return { content: [{ type: "text", text: `Dashboard: ${url}` }] };
    },
  );

  return server;
}
