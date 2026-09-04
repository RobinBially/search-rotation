import type { EngineAdapter, EngineContext, FetchInput, RemoteQuota, SearchInput, SearchOutcome } from "../types.js";
import { bearer, cap, httpJson } from "./base.js";

const BASE = "https://api.firecrawl.dev/v2";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  const j = await httpJson<any>(
    `${BASE}/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(ctx.apiKey) },
      body: JSON.stringify({ query: input.query, limit: cap(input.numResults) }),
    },
    { signal: ctx.signal },
  );
  if (j && j.success === false) throw new Error(`firecrawl: ${j.error ?? "unbekannter Fehler"}`);
  const arr = j?.data?.web ?? (Array.isArray(j?.data) ? j.data : []);
  const items = arr.map((d: any) => ({
    title: d?.title || d?.url || "(ohne Titel)",
    url: String(d?.url ?? ""),
    snippet:
      typeof d?.description === "string"
        ? d.description.slice(0, 500)
        : typeof d?.markdown === "string"
          ? d.markdown.slice(0, 300)
          : undefined,
  }));
  return { items };
}

async function fetchUrl(input: FetchInput, ctx: EngineContext): Promise<string> {
  const j = await httpJson<any>(
    `${BASE}/scrape`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(ctx.apiKey) },
      body: JSON.stringify({ url: input.url, formats: ["markdown"], onlyMainContent: true }),
    },
    { signal: ctx.signal, timeoutMs: 45_000 },
  );
  if (j && j.success === false) throw new Error(`firecrawl: ${j.error ?? "unbekannter Fehler"}`);
  const md = j?.data?.markdown;
  if (typeof md !== "string" || !md.trim()) throw new Error("firecrawl: kein Inhalt gescraped");
  return md;
}

async function remoteQuota(ctx: EngineContext): Promise<RemoteQuota> {
  const j = await httpJson<any>(`${BASE}/team/credit-usage`, { headers: bearer(ctx.apiKey) });
  return {
    used: typeof j?.data?.creditsUsed === "number" ? j.data.creditsUsed : undefined,
    limit: typeof j?.data?.planCredits === "number" ? j.data.planCredits : undefined,
    remaining: typeof j?.data?.creditsRemaining === "number" ? j.data.creditsRemaining : undefined,
  };
}

export const FIRECRAWL: EngineAdapter = {
  meta: {
    id: "firecrawl",
    label: "Firecrawl",
    homepage: "https://www.firecrawl.dev",
    signupUrl: "https://www.firecrawl.dev/signin",
    keyless: "ip",
    capabilities: ["search", "fetch"],
    monthlyFree: 1000,
    quotaEndpoint: true,
    notes:
      "1.000 Credits/Monat gratis (mit Konto). Ohne Key nur wenige IP-basierte Requests — daher Key empfohlen. Quota per API abrufbar.",
  },
  search,
  fetchUrl,
  remoteQuota,
};
