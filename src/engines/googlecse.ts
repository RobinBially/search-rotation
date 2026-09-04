import type { EngineAdapter, EngineContext, SearchInput, SearchOutcome } from "../types.js";
import { cap, httpJson, NeedsKeyError } from "./base.js";

const SIGNUP = "https://developers.google.com/custom-search/v1/overview";

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  if (!ctx.apiKey) throw new NeedsKeyError("google-cse", SIGNUP);
  const cx = ctx.extra?.cx;
  if (!cx) throw new Error("google-cse: CX (Search Engine ID) fehlt — im Dashboard unter Extras hinterlegen.");
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", ctx.apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", input.query);
  url.searchParams.set("num", String(Math.min(cap(input.numResults), 10)));
  const j = await httpJson<any>(url.toString(), {}, { signal: ctx.signal });
  if (j?.error?.message) throw new Error(`google-cse: ${j.error.message}`);
  const items = (Array.isArray(j?.items) ? j.items : []).map((r: any) => ({
    title: r?.title || "(ohne Titel)",
    url: String(r?.link ?? ""),
    snippet: typeof r?.snippet === "string" ? r.snippet : undefined,
  }));
  return { items };
}

export const GOOGLE_CSE: EngineAdapter = {
  meta: {
    id: "google-cse",
    label: "Google PSE",
    homepage: "https://www.google.com",
    signupUrl: SIGNUP,
    keyless: "no",
    capabilities: ["search"],
    monthlyFree: 3000,
    quota: { period: "day", unit: "requests", limit: 100, timeZone: "America/Los_Angeles", estimated: false },
    quotaEndpoint: false,
    notes:
      "Für bestehende Kunden: 100 Queries pro Pacific-Tag. API-Key und Search Engine ID (CX) erforderlich. Für Neukunden geschlossen; Abschaltung am 1. Januar 2027.",
    extraFields: [{ key: "cx", label: "Search Engine ID (CX)" }],
    defaultEnabled: false,
  },
  search,
};
