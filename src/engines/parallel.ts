import type { EngineAdapter, EngineContext, FetchInput, SearchInput, SearchOutcome } from "../types.js";
import { optionalCap as cap, httpJson, NeedsKeyError } from "./base.js";

import { withHostedMcp } from "./hosted-mcp.js";

const SIGNUP = "https://platform.parallel.ai";
const BASE = "https://api.parallel.ai/v1";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  const j = !ctx.apiKey ? await withHostedMcp("https://search.parallel.ai/mcp", ctx, 30_000, async (client, signal) => {
    const result = await client.callTool({ name: "web_search", arguments: { objective: input.query, search_queries: [input.query] } }, undefined, { timeout: 30_000, signal });
    if (result.isError) throw new Error("parallel-mcp: " + (result.content as any[]).filter(c => c.type === "text").map(c => c.text).join("\n").slice(0, 300));
    const data = result.structuredContent as { results?: unknown[] } | undefined;
    if (!Array.isArray(data?.results)) throw new Error("parallel-mcp: invalid search response");
    return data;
  }) : await httpJson<any>(
    `${BASE}/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.apiKey },
      body: JSON.stringify({
        objective: input.query,
        search_queries: [input.query],
        mode: "fast",
        max_results: cap(input.numResults),
        max_chars_per_result: 400,
      }),
    },
    { signal: ctx.signal },
  );
  const items = (Array.isArray(j?.results) ? j.results : []).slice(0, cap(input.numResults)).map((r: any) => ({
    title: r?.title || r?.url || "(ohne Titel)",
    url: String(r?.url ?? ""),
    snippet: Array.isArray(r?.excerpts) ? r.excerpts.join(" … ").slice(0, 600) : undefined,
    published: typeof r?.publish_date === "string" ? r.publish_date : undefined,
  }));
  return { items };
}

async function fetchUrl(input: FetchInput, ctx: EngineContext): Promise<string> {
  if (!ctx.apiKey) throw new NeedsKeyError("parallel", SIGNUP);
  const j = await httpJson<any>(
    `${BASE}/extract`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.apiKey },
      body: JSON.stringify({ urls: [input.url], advanced_settings: { full_content: true } }),
    },
    { signal: ctx.signal, timeoutMs: 45_000 },
  );
  const r0 = j?.results?.[0];
  const md =
    typeof r0?.full_content === "string" && r0.full_content
      ? r0.full_content
      : Array.isArray(r0?.excerpts)
        ? r0.excerpts.join("\n\n")
        : "";
  if (!md.trim()) {
    // Parallel liefert Fehler pro URL im errors[]-Array — mit ausgeben.
    const errs = Array.isArray(j?.errors) ? j.errors : [];
    const detail = errs
      .map((e: any) => `${e?.error_type ?? "error"}: ${e?.content ?? ""}`.trim())
      .filter(Boolean)
      .join("; ");
    throw new Error("parallel: kein Inhalt extrahiert" + (detail ? ` (${detail.slice(0, 200)})` : ""));
  }
  return md;
}

export const PARALLEL: EngineAdapter = {
  meta: {
    id: "parallel",
    label: "Parallel",
    homepage: "https://parallel.ai",
    signupUrl: SIGNUP,
    keyless: "ip",
    keylessCapabilities: ["search"],
    capabilities: ["search", "fetch"],
    monthlyFree: 5000,
    quota: { period: "month", unit: "requests", limit: 5000, estimated: true },
    quotaEndpoint: false,
    notes:
      "Suche ohne Key über gehosteten Parallel-MCP. Fetch nutzt die direkte API mit Key. Ohne Key werden nur lokale Aufrufe gezählt; Anbieterlimit und Gesamtverbrauch unbekannt.",
  },
  search,
  fetchUrl,
};
