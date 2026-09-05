import type { EngineAdapter, EngineContext, FetchInput, SearchInput, SearchItem, SearchOutcome } from "../types.js";
import { optionalCap as cap, httpJson } from "./base.js";
import { withHostedMcp } from "./hosted-mcp.js";

const SIGNUP = "https://dashboard.exa.ai";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

/**
 * Keyless-Fallback: Exas gehosteter MCP-Server ist ohne Key IP-basiert
 * nutzbar und bietet Suche (web_search_exa) und Fetch (web_fetch_exa).
 * Pro Aufruf eine eigene Client-Session — einfach und robust.
 */

function mcpText(result: any): string {
  return (result?.content ?? [])
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n\n");
}

function parseExaMcpSearch(text: string): SearchItem[] {
  const items: SearchItem[] = [];
  for (const block of text.split(/\n-{3,}\n/)) {
    const url = block.match(/^URL:\s*(\S+)$/m)?.[1]?.trim();
    if (!url) continue;
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || url;
    const hl = block.indexOf("Highlights:");
    const snippet =
      hl >= 0
        ? block
            .slice(hl + "Highlights:".length)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500)
        : undefined;
    items.push({ title, url, snippet });
  }
  return items;
}

async function directSearch(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  const j = await httpJson<any>(
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.apiKey! },
      body: JSON.stringify({
        query: input.query,
        numResults: cap(input.numResults),
        type: "auto",
        contents: { text: { maxCharacters: 400 } },
      }),
    },
    { signal: ctx.signal },
  );
  const items = (Array.isArray(j?.results) ? j.results : []).map((r: any) => ({
    title: r?.title || r?.url || "(ohne Titel)",
    url: String(r?.url ?? ""),
    snippet: typeof r?.text === "string" ? r.text.slice(0, 500) : undefined,
    published: typeof r?.publishedDate === "string" ? r.publishedDate : undefined,
  }));
  return { items };
}

async function directFetch(input: FetchInput, ctx: EngineContext): Promise<string> {
  const j = await httpJson<any>(
    "https://api.exa.ai/contents",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.apiKey! },
      body: JSON.stringify({ ids: [input.url], text: { maxCharacters: 50_000 } }),
    },
    { signal: ctx.signal, timeoutMs: 45_000 },
  );
  const text = j?.results?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("exa: kein Inhalt extrahiert");
  return text;
}

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  // Mit Key: direkte API. Ohne Key: gehosteter Exa-MCP (IP-basiert, gratis).
  if (!ctx.apiKey) {
    const text = await withHostedMcp(EXA_MCP_URL, ctx, 30_000, async (client, signal) => {
      const res: any = await client.callTool(
        { name: "web_search_exa", arguments: { query: input.query, numResults: cap(input.numResults) } },
        undefined,
        { timeout: 30_000, signal },
      );
      if (res?.isError) throw new Error(`exa-mcp: ${mcpText(res).slice(0, 200)}`);
      return mcpText(res);
    });
    const items = parseExaMcpSearch(text);
    if (items.length === 0) throw new Error("exa-mcp: keine Ergebnisse");
    return { items };
  }
  return directSearch(input, ctx);
}

async function fetchUrl(input: FetchInput, ctx: EngineContext): Promise<string> {
  if (!ctx.apiKey) {
    const text = await withHostedMcp(EXA_MCP_URL, ctx, 45_000, async (client, signal) => {
      const res: any = await client.callTool(
        { name: "web_fetch_exa", arguments: { urls: [input.url], maxCharacters: 50_000 } },
        undefined,
        { timeout: 45_000, signal },
      );
      if (res?.isError) throw new Error(`exa-mcp: ${mcpText(res).slice(0, 200)}`);
      return mcpText(res);
    });
    if (!text.trim()) throw new Error("exa-mcp: kein Inhalt extrahiert");
    return text;
  }
  return directFetch(input, ctx);
}

export const EXA: EngineAdapter = {
  meta: {
    id: "exa",
    label: "Exa",
    homepage: "https://exa.ai",
    signupUrl: SIGNUP,
    keyless: "ip",
    capabilities: ["search", "fetch"],
    monthlyFree: 0,
    quota: { period: "month", unit: "requests", estimated: true },
    quotaEndpoint: false,
    notes:
      "Ohne Key: automatisch über gehosteten Exa-MCP (mcp.exa.ai, IP-basiert limitiert) — Suche und Fetch. Mit Key: direkte API. Nutzung lokal gezählt; tatsächliches Guthaben und Anbieter-Gesamtverbrauch unbekannt.",
  },
  search,
  fetchUrl,
};
