import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RouterError, type SearchRouter } from "../router.js";
import type { StatusRow } from "../status.js";
import { engineStatus } from "./engine-status.js";
import { dateSchema, timeRangeSchema, describeSearchTime } from "../search-time.js";
import { VERSION } from "../version.js";
import { readFileSync } from "node:fs";

// Inline packaged icons: clients need no dashboard connection or external image host.
const icons = (["light", "dark"] as const).map(theme => ({
  src: `data:image/png;base64,${readFileSync(new URL(`../../docs/assets/brand/icon-${theme}-128.png`, import.meta.url)).toString("base64")}`,
  mimeType: "image/png",
  sizes: ["128x128"],
  theme,
}));

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
  const server = new McpServer({ name: "search-rotation", version: VERSION, icons });

  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description:
        "Web search with automatic round-robin across multiple free search APIs (Tavily, Firecrawl, Parallel, Exa, Google PSE, DuckDuckGo) including transparent failover. Returns numbered results with title, URL, snippet and publication date when available. Time filters restrict rotation and failover to compatible providers; never silently dropped.",
      inputSchema: {
        query: z.string().describe("Search query"),
        numResults: z.number().int().min(1).max(20).optional().describe("Optional result count (1–20). Omit to use the dashboard setting: a custom count or the provider default."),
        timeRange: timeRangeSchema.optional().describe("Relative UTC date window: day=1, week=7, month=30, year=365 days through today. Cannot combine with startDate/endDate; day precision, not rolling hours."),
        startDate: dateSchema.optional().describe("Start date YYYY-MM-DD. May be used alone or with endDate; cannot combine with timeRange."),
        endDate: dateSchema.optional().describe("End date YYYY-MM-DD (through this date, subject to provider boundary semantics). Cannot combine with timeRange."),
        engine: z.string().optional().describe("Preferred engine id; failover to the other engines stays active"),
      },
    },
    async ({ query, numResults, engine, timeRange, startDate, endDate }, extra) => {
      const r = await withRouterDiagnostics(deps.router.search({ query, numResults, timeRange, startDate, endDate }, { preferEngine: engine, signal: deps.requestSignal ? AbortSignal.any([extra.signal, deps.requestSignal]) : extra.signal }));
      const lines = r.items.map((it, i) => {
        const snip = it.snippet ? `\n   ${it.snippet.replace(/\s+/g, " ").slice(0, 400)}` : "";
        return `${i + 1}. ${it.title}\n   ${it.url}${it.published ? `\n   Published: ${it.published}` : ""}${snip}`;
      });
      const failover = r.attempts.filter((a) => !a.ok).map((a) => `${a.engine}: ${a.error}`);
      const head = [`Search "${query}" via ${r.engine} (${r.items.length} results)`];
      const period = describeSearchTime({ query, timeRange, startDate, endDate });
      if (period) head.push(`Time filter: ${period} (provider date semantics apply)`);
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
      annotations: { readOnlyHint: true, destructiveHint: false },
      description:
        "Read engine configuration, per-capability authentication requirements, local usage and quota sources. This is not a live health check. Historical errors do not prove a current failure; disabled engines are not necessarily missing credentials.",
      inputSchema: {},
    },
    async () => {
      const status = engineStatus(await deps.status(), deps.month(), VERSION);
      return {
        structuredContent: status,
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
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
