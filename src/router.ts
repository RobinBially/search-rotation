import type {
  Attempt,
  EngineAdapter,
  FetchInput,
  FetchResponse,
  RemoteQuota,
  SearchInput,
  SearchResponse,
} from "./types.js";
import type { PolyConfig } from "./config.js";
import type { UsageStore } from "./usage.js";
import { computeRemainingPct } from "./quota.js";
import { fetchRemoteQuotaCached } from "./status.js";

export class RouterError extends Error {
  constructor(
    message: string,
    public readonly attempts: Attempt[],
  ) {
    super(message);
    this.name = "RouterError";
  }
}

interface Candidate {
  adapter: EngineAdapter;
  apiKey?: string;
  extra?: Record<string, string>;
}

/**
 * Round-Robin-Router: rotiert über die aktivierten Engines, verschiebt
 * Engines mit knappem Restkontingent (<10 %) nach hinten und lässt
 * erschöpfte Engines nur als letzte Instanz zu. Bei Fehlern (429, 5xx,
 * Key-Probleme) wird die nächste Engine der Kette probiert.
 */
export class SearchRouter {
  private rr = 0;

  constructor(
    private readonly opts: {
      getConfig(): PolyConfig;
      usage: UsageStore;
      adapters: EngineAdapter[];
    },
  ) {}

  private async chain(kind: "search" | "fetch", prefer?: string): Promise<Candidate[]> {
    const cfg = this.opts.getConfig();
    const byId = new Map(this.opts.adapters.map((a) => [a.meta.id, a] as const));
    const order = kind === "fetch" ? cfg.fetchOrder : cfg.engines.map((e) => e.id);

    const entries: Candidate[] = [];
    for (const id of order) {
      const adapter = byId.get(id);
      if (!adapter) continue;
      if (kind === "search" && !adapter.search) continue;
      if (kind === "fetch" && !adapter.fetchUrl) continue;
      const e = cfg.engines.find((x) => x.id === id);
      if (!e?.enabled) continue;
      entries.push({ adapter, apiKey: e.apiKey, extra: e.extra });
    }
    if (entries.length <= 1) return entries;

    const rated = await Promise.all(
      entries.map(async (c) => {
        let remote: RemoteQuota | null = null;
        if (c.adapter.meta.quotaEndpoint) {
          remote = (await fetchRemoteQuotaCached(c.adapter, { apiKey: c.apiKey, extra: c.extra })).quota;
        }
        const limit = cfg.settings.monthlyLimits[c.adapter.meta.id] ?? c.adapter.meta.monthlyFree;
        const pct = computeRemainingPct(this.opts.usage.get(c.adapter.meta.id), limit, remote);
        return { c, pct };
      }),
    );

    const healthy = rated.filter((r) => r.pct === null || r.pct > 0.1);
    const low = rated.filter((r) => r.pct !== null && r.pct > 0 && r.pct <= 0.1);
    const exhausted = rated.filter((r) => r.pct !== null && r.pct <= 0);

    let ordered = [...healthy, ...low, ...exhausted];
    if (prefer) {
      ordered = [
        ...ordered.filter((x) => x.c.adapter.meta.id === prefer),
        ...ordered.filter((x) => x.c.adapter.meta.id !== prefer),
      ];
    } else if (ordered.length > 1) {
      const start = this.rr++ % ordered.length;
      ordered = [...ordered.slice(start), ...ordered.slice(0, start)];
    }
    return ordered.map((x) => x.c);
  }

  async search(input: SearchInput, opts: { preferEngine?: string } = {}): Promise<SearchResponse> {
    const chain = await this.chain("search", opts.preferEngine);
    if (chain.length === 0) {
      throw new RouterError(
        "Keine aktivierte Such-Engine verfügbar. Im Dashboard Engines aktivieren und/oder Keys hinterlegen.",
        [],
      );
    }
    const attempts: Attempt[] = [];
    for (const c of chain) {
      const t0 = Date.now();
      try {
        const out = await c.adapter.search!(
          { query: input.query, numResults: input.numResults },
          { apiKey: c.apiKey, extra: c.extra },
        );
        this.opts.usage.record(c.adapter.meta.id, "search");
        attempts.push({ engine: c.adapter.meta.id, ok: true, ms: Date.now() - t0 });
        return { items: out.items, answer: out.answer, engine: c.adapter.meta.id, attempts };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.opts.usage.record(c.adapter.meta.id, "search", error);
        attempts.push({ engine: c.adapter.meta.id, ok: false, ms: Date.now() - t0, error });
      }
    }
    throw new RouterError(`Alle ${attempts.length} Such-Engines fehlgeschlagen.`, attempts);
  }

  async fetchUrl(input: FetchInput, opts: { preferEngine?: string } = {}): Promise<FetchResponse> {
    const chain = await this.chain("fetch", opts.preferEngine);
    if (chain.length === 0) {
      throw new RouterError("Keine aktivierte Fetch-Engine verfügbar. Im Dashboard Fetch-Engines aktivieren.", []);
    }
    const attempts: Attempt[] = [];
    for (const c of chain) {
      const t0 = Date.now();
      try {
        const markdown = await c.adapter.fetchUrl!({ url: input.url }, { apiKey: c.apiKey, extra: c.extra });
        this.opts.usage.record(c.adapter.meta.id, "fetch");
        attempts.push({ engine: c.adapter.meta.id, ok: true, ms: Date.now() - t0 });
        return { markdown, engine: c.adapter.meta.id, attempts };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.opts.usage.record(c.adapter.meta.id, "fetch", error);
        attempts.push({ engine: c.adapter.meta.id, ok: false, ms: Date.now() - t0, error });
      }
    }
    throw new RouterError(`Alle ${attempts.length} Fetch-Engines fehlgeschlagen.`, attempts);
  }
}
