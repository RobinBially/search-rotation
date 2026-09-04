import type { EngineAdapter, EngineContext, FetchInput } from "../types.js";
import { httpText } from "./base.js";

async function fetchUrl(input: FetchInput, ctx: EngineContext): Promise<string> {
  const headers: Record<string, string> = { accept: "text/markdown" };
  if (ctx.apiKey) headers.authorization = `Bearer ${ctx.apiKey}`;
  const text = await httpText(`https://r.jina.ai/${input.url}`, { headers }, {
    signal: ctx.signal,
    timeoutMs: 45_000,
  });
  if (!text.trim()) throw new Error("jina: leere Antwort");
  return text;
}

export const JINA: EngineAdapter = {
  meta: {
    id: "jina",
    label: "Jina Reader",
    homepage: "https://jina.ai/reader",
    signupUrl: "https://jina.ai/reader",
    keyless: "ip",
    capabilities: ["fetch"],
    monthlyFree: 0,
    quotaEndpoint: false,
    notes: "Ohne Key IP-basiert (~20 Requests/Minute), mit Key höhere Limits. Nur fürs Abrufen von Seiten.",
  },
  fetchUrl,
};
