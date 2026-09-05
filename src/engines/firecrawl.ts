import type { EngineAdapter, EngineContext, FetchInput, RemoteQuota, SearchInput, SearchOutcome } from "../types.js";
import { bearer, optionalCap as cap, httpJson } from "./base.js";

const BASE = "https://api.firecrawl.dev/v2";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  const usDate = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`;
  const tbs = input.startDate && input.endDate
    ? `cdr:1,cd_min:${usDate(input.startDate)},cd_max:${usDate(input.endDate)}` : undefined;
  const j = await httpJson<any>(
    `${BASE}/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(ctx.apiKey) },
      body: JSON.stringify({ query: input.query, limit: cap(input.numResults), tbs }),
    },
    { signal: ctx.signal, timeoutMs: 45_000 },
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
  const j = await httpJson<any>(`${BASE}/team/credit-usage`, { headers: bearer(ctx.apiKey) }, { signal: ctx.signal });
  // Response: { success, data: { remainingCredits, planCredits, billingPeriodStart, billingPeriodEnd } }
  const d = j?.data ?? {};
  const limit = pickNum(d.planCredits);
  const remaining = pickNum(d.remainingCredits);
  return {
    limit,
    remaining,
    used: limit !== undefined && remaining !== undefined ? limit - remaining : undefined,
  };
}

function pickNum(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
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
    quota: { period: "month", unit: "credits", limit: 1000, estimated: true, costs: { search: 2, fetch: 1 } },
    quotaEndpoint: true,
    notes:
      "Gratis-Guthaben mit Konto; kein garantierter monatlicher Reset. Quota per API abrufbar; Reset nach Billing-Periode (Kontostand zählt Remote), nicht am Kalendermonat. Ohne Key nur wenige IP-basierte Requests.",
  },
  // Documented Firecrawl v2 default: 10 results (docs.firecrawl.dev/api-reference/endpoint/search).
  // Cost remains an estimate; do not substitute our dashboard default here.
  estimateCost: (kind, input) => kind === "search" ? 2 * Math.ceil((cap((input as SearchInput).numResults) ?? 10) / 10) : 1,
  supportsSearchTime: input => Boolean(input.startDate && input.endDate),
  search,
  fetchUrl,
  remoteQuota,
};
