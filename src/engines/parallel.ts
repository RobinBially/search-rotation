import type { EngineAdapter, EngineContext, FetchInput, SearchInput, SearchOutcome } from "../types.js";
import { cap, httpJson, NeedsKeyError } from "./base.js";

const SIGNUP = "https://platform.parallel.ai";
const BASE = "https://api.parallel.ai/v1";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  if (!ctx.apiKey) throw new NeedsKeyError("parallel", SIGNUP);
  const j = await httpJson<any>(
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
  const items = (Array.isArray(j?.results) ? j.results : []).map((r: any) => ({
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
      body: JSON.stringify({ urls: [input.url], full_content: true }),
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
  if (!md.trim()) throw new Error("parallel: kein Inhalt extrahiert");
  return md;
}

export const PARALLEL: EngineAdapter = {
  meta: {
    id: "parallel",
    label: "Parallel",
    homepage: "https://parallel.ai",
    signupUrl: SIGNUP,
    keyless: "no",
    capabilities: ["search", "fetch"],
    monthlyFree: 5000,
    quotaEndpoint: false,
    notes:
      "5.000 Requests/Monat gratis + zusätzlich $5 Guthaben/Monat. Kein Quota-Endpunkt — Zähler läuft lokal, Kontrollblick im Parallel-Dashboard.",
  },
  search,
  fetchUrl,
};
