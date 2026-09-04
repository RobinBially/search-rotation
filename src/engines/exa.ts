import type { EngineAdapter, EngineContext, FetchInput, SearchInput, SearchOutcome } from "../types.js";
import { cap, httpJson, NeedsKeyError } from "./base.js";

const SIGNUP = "https://dashboard.exa.ai";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  if (!ctx.apiKey) throw new NeedsKeyError("exa", SIGNUP);
  const j = await httpJson<any>(
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.apiKey },
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

async function fetchUrl(input: FetchInput, ctx: EngineContext): Promise<string> {
  if (!ctx.apiKey) throw new NeedsKeyError("exa", SIGNUP);
  const j = await httpJson<any>(
    "https://api.exa.ai/contents",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ctx.apiKey },
      body: JSON.stringify({ ids: [input.url], text: { maxCharacters: 50_000 } }),
    },
    { signal: ctx.signal, timeoutMs: 45_000 },
  );
  const text = j?.results?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("exa: kein Inhalt extrahiert");
  return text;
}

export const EXA: EngineAdapter = {
  meta: {
    id: "exa",
    label: "Exa",
    homepage: "https://exa.ai",
    signupUrl: SIGNUP,
    keyless: "no",
    capabilities: ["search", "fetch"],
    monthlyFree: 1400,
    quotaEndpoint: false,
    notes:
      "$10 Gratis-Guthaben/Monat (+ $20 Startguthaben), ≈1.400 Suchen à $7/1k. Kein Quota-Endpunkt — Zähler läuft lokal. Die gehostete Variante mcp.exa.ai läuft ohne Key, die direkte API braucht einen Key.",
  },
  search,
  fetchUrl,
};
