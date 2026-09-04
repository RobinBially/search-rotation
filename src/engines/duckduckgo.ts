import type { EngineAdapter, EngineContext, SearchInput, SearchItem, SearchOutcome } from "../types.js";
import { cap, HttpError } from "./base.js";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  Uuml: "Ü",
  Ouml: "Ö",
  Auml: "Ä",
  szlig: "ß",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (ENTITIES[code]) return ENTITIES[code];
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return m;
  });
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort-Parser für https://html.duckduckgo.com/html/ (inoffiziell). */
export function parseDdgHtml(html: string): SearchItem[] {
  const items: SearchItem[] = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [...html.matchAll(linkRe)];
  for (const [i, m] of links.slice(0, 20).entries()) {
    // Ein Snippet gehört nur zum Bereich nach diesem Treffer und vor dem nächsten.
    const block = html.slice(m.index! + m[0].length, links[i + 1]?.index ?? html.length);
    snippetRe.lastIndex = 0;
    const snippet = snippetRe.exec(block)?.[1];
    let raw = decodeEntities(m[1]);
    const uddg = raw.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        raw = decodeURIComponent(uddg[1]);
      } catch {
        raw = uddg[1];
      }
    }
    items.push({ title: stripTags(m[2]) || "(ohne Titel)", url: raw, snippet: snippet === undefined ? undefined : stripTags(snippet) });
  }
  return items;
}

async function search(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome> {
  const timeout = AbortSignal.timeout(20_000);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      "accept-language": "en",
    },
    body: new URLSearchParams({ q: input.query }),
    redirect: "follow",
    signal,
  });
  if (!res.ok) {
    throw new HttpError(res.status, await res.text().catch(() => ""), "https://html.duckduckgo.com/html/");
  }
  const html = await res.text();
  const items = parseDdgHtml(html).slice(0, cap(input.numResults));
  if (items.length === 0) {
    throw new Error("duckduckgo: keine Ergebnisse (möglicherweise blockiert — Bot-Detection)");
  }
  return { items };
}

export const DUCKDUCKGO: EngineAdapter = {
  meta: {
    id: "duckduckgo",
    label: "DuckDuckGo (HTML)",
    homepage: "https://duckduckgo.com",
    signupUrl: "https://duckduckgo.com",
    keyless: "ip",
    capabilities: ["search"],
    monthlyFree: 0,
    quota: { period: "ip", unit: "requests", estimated: true },
    quotaEndpoint: false,
    notes: "Inoffizieller HTML-Scrape: kein Kontingent, aber Bot-Detection möglich. Als letzte Instanz gedacht.",
  },
  search,
};
