import type { EngineAdapter } from "../types.js";
import { TAVILY } from "./tavily.js";
import { FIRECRAWL } from "./firecrawl.js";
import { PARALLEL } from "./parallel.js";
import { EXA } from "./exa.js";
import { GOOGLE_CSE } from "./googlecse.js";
import { JINA } from "./jina.js";
import { DUCKDUCKGO } from "./duckduckgo.js";

export const ADAPTERS: EngineAdapter[] = [TAVILY, FIRECRAWL, PARALLEL, EXA, GOOGLE_CSE, JINA, DUCKDUCKGO];

/** Alle Engine-Ids — auch fetch-only (Jina), die tauchen nicht in SEARCH_ORDER auf. */
export const KNOWN_IDS = ADAPTERS.map((a) => a.meta.id);

export const SEARCH_ORDER = ["tavily", "firecrawl", "parallel", "exa", "google-cse", "duckduckgo"];

export const FETCH_ORDER = ["jina", "firecrawl", "parallel", "tavily", "exa"];

export const DEFAULT_ENABLED: Record<string, boolean> = Object.fromEntries(
  ADAPTERS.map(a => [a.meta.id, a.meta.defaultEnabled ?? a.meta.keyless === "ip"]),
);
