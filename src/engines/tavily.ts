import type { EngineAdapter, EngineContext, FetchInput, RemoteQuota, SearchInput, SearchOutcome } from "../types.js";
import { bearer, cap, httpJson, NeedsKeyError } from "./base.js";

const SIGNUP = "https://app.tavily.com";
const BASE = "https://api.tavily.com";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  if (!ctx.apiKey) throw new NeedsKeyError("tavily", SIGNUP);
  const j = await httpJson<any>(
    `${BASE}/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(ctx.apiKey) },
      body: JSON.stringify({
        query: input.query,
        max_results: cap(input.numResults),
        include_answer: true,
        search_depth: "basic",
      }),
    },
    { signal: ctx.signal },
  );
  const items = (Array.isArray(j?.results) ? j.results : []).map((r: any) => ({
    title: r?.title || r?.url || "(ohne Titel)",
    url: String(r?.url ?? ""),
    snippet: typeof r?.content === "string" ? r.content.slice(0, 500) : undefined,
    published: typeof r?.published_date === "string" ? r.published_date : undefined,
  }));
  return { items, answer: typeof j?.answer === "string" && j.answer ? j.answer : undefined };
}

async function fetchUrl(input: FetchInput, ctx: EngineContext): Promise<string> {
  if (!ctx.apiKey) throw new NeedsKeyError("tavily", SIGNUP);
  const j = await httpJson<any>(
    `${BASE}/extract`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(ctx.apiKey) },
      body: JSON.stringify({ urls: [input.url] }),
    },
    { signal: ctx.signal },
  );
  const content = j?.results?.[0]?.raw_content;
  if (typeof content !== "string" || !content.trim()) throw new Error("tavily: kein Inhalt extrahiert");
  return content;
}

async function remoteQuota(ctx: EngineContext): Promise<RemoteQuota> {
  if (!ctx.apiKey) throw new NeedsKeyError("tavily", SIGNUP);
  const j = await httpJson<any>(`${BASE}/usage`, { headers: bearer(ctx.apiKey) }, { signal: ctx.signal });
  // Response: { key: { usage, limit, search_usage, ... }, account: { current_plan, plan_usage, plan_limit, ... } }
  const ku = Array.isArray(j?.key_usage) ? j.key_usage[0] : j?.key_usage;
  const used = pickNumber(j?.key?.usage, ku?.usage, j?.usage);
  const limit = pickNumber(j?.key?.limit, ku?.limit, j?.limit);
  return { used, limit, remaining: used !== undefined && limit !== undefined ? limit - used : undefined };
}

function pickNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

export const TAVILY: EngineAdapter = {
  meta: {
    id: "tavily",
    label: "Tavily",
    homepage: "https://www.tavily.com",
    signupUrl: SIGNUP,
    keyless: "no",
    capabilities: ["search", "fetch"],
    monthlyFree: 1000,
    quota: { period: "month", unit: "credits", limit: 1000, estimated: true, costs: { search: 1, fetch: 0.2 } },
    quotaEndpoint: true,
    notes: "1.000 Credits/Monat gratis, Reset am Monatsanfang, keine Kreditkarte nötig. Quota per API abrufbar.",
  },
  search,
  fetchUrl,
  remoteQuota,
};
