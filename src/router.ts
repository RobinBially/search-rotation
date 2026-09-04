import type { Attempt, Capability, EngineAdapter, EngineContext, FetchInput, FetchResponse, HistoryRecord, SearchInput, SearchOutcome, SearchResponse } from './types.js';
import type { PolyConfig } from './config.js';
import type { UsageStore } from './usage.js';
import { quotaStatus, remainingPct, requestCost } from './quota.js';
import { fetchRemoteQuotaCached, recordRemoteConsumption } from './status.js';
import { HttpError } from './engines/base.js';
import { abortable } from './abort.js';

export class RouterError extends Error {
  constructor(message: string, public readonly attempts: Attempt[]) { super(message); this.name = 'RouterError'; }
}
interface Candidate { adapter: EngineAdapter; ctx: EngineContext; }
interface Health { identity: string; failures: number; until: number; reserved: number; }
export interface RouterOptions { preferEngine?: string; signal?: AbortSignal;
  /** Dashboard diagnosis: no failover, including disabled engines. */
  onlyEngine?: string; }

export class SearchRouter {
  private rr: Record<Capability, number> = { search: 0, fetch: 0 };
  private health = new Map<string, Health>();
  constructor(private readonly opts: {
    getConfig(): PolyConfig; usage: UsageStore; adapters: EngineAdapter[];
    history?: { record(entry: HistoryRecord): void }; now?: () => number;
  }) {}

  private now(): number { return this.opts.now?.() ?? Date.now(); }
  private state(c: Candidate): Health {
    const id = c.adapter.meta.id;
    const identity = JSON.stringify([c.ctx.apiKey, c.ctx.extra]);
    let state = this.health.get(id);
    if (!state || state.identity !== identity) { state = { identity, failures: 0, until: 0, reserved: 0 }; this.health.set(id, state); }
    return state;
  }
  private failure(c: Candidate, err: unknown): void {
    const state = this.state(c); state.failures++;
    const status = err instanceof HttpError ? err.status : undefined;
    let delay = 0;
    if (status === 429) {
      const header = (err as HttpError).retryAfter;
      const seconds = header?.trim() ? Number(header) : NaN;
      const date = header ? Date.parse(header) : NaN;
      delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - this.now()) : 30_000;
    } else if (status === 401 || status === 403) delay = 60_000;
    else if (state.failures >= 2) delay = Math.min(300_000, 30_000 * 2 ** Math.min(4, state.failures - 2));
    state.until = this.now() + delay;
  }

  private async chain(kind: Capability, signal: AbortSignal, prefer?: string, onlyEngine?: string): Promise<Candidate[]> {
    signal.throwIfAborted();
    const cfg = this.opts.getConfig();
    const byId = new Map(this.opts.adapters.map(a => [a.meta.id, a]));
    const order = onlyEngine ? [onlyEngine] : kind === 'fetch' ? cfg.fetchOrder : cfg.engines.map(e => e.id);
    const entries: Candidate[] = [];
    for (const id of new Set(order)) {
      const adapter = byId.get(id); const e = cfg.engines.find(e => e.id === id);
      if (!adapter || !e || (!onlyEngine && !e.enabled) || !(kind === 'search' ? adapter.search : adapter.fetchUrl)) continue;
      if (!onlyEngine && !e.apiKey && adapter.meta.keylessCapabilities && !adapter.meta.keylessCapabilities.includes(kind)) continue;
      const c = { adapter, ctx: { apiKey: e.apiKey, extra: e.extra, signal } };
      if (this.state(c).until > this.now()) continue;
      entries.push(c);
    }
    const rated = await abortable(Promise.all(entries.map(async c => {
      const remote = c.adapter.meta.quotaEndpoint ? (await fetchRemoteQuotaCached(c.adapter, c.ctx)).quota : null;
      const pct = remainingPct(quotaStatus(c.adapter, c.ctx, cfg, this.opts.usage, remote));
      return { c, pct };
    })), signal);
    const groups = [
      rated.filter(r => r.pct === null || r.pct > 0.1),
      rated.filter(r => r.pct !== null && r.pct > 0 && r.pct <= 0.1),
      cfg.settings.strictFreeMode ? [] : rated.filter(r => r.pct !== null && r.pct <= 0),
    ];
    const turn = prefer ? 0 : this.rr[kind]++;
    let ordered = groups.flatMap(group => {
      const start = group.length ? turn % group.length : 0;
      return [...group.slice(start), ...group.slice(0, start)];
    }).map(r => r.c);
    if (prefer) ordered = [...ordered.filter(c => c.adapter.meta.id === prefer), ...ordered.filter(c => c.adapter.meta.id !== prefer)];
    return ordered;
  }

  private recordUsage(c: Candidate, kind: Capability, input: SearchInput | FetchInput, error?: string): void {
    try { this.opts.usage.record(c.adapter.meta.id, kind, error, requestCost(c.adapter, kind, input), c.adapter.meta.quota?.timeZone); }
    catch { console.error('[search-rotation] Verbrauch konnte nicht gespeichert werden; Dateirechte/Sperre prüfen.'); }
  }

  private async execute(kind: Capability, input: SearchInput | FetchInput, opts: RouterOptions): Promise<{ value: SearchOutcome | string; engine: string; attempts: Attempt[] }> {
    const start = Date.now();
    const cfg = this.opts.getConfig();
    const timeoutMs = cfg.settings.requestTimeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Zeitlimit nach ${timeoutMs} ms überschritten`)), timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    const attempts: Attempt[] = [];
    const rawInput = kind === 'search' ? (input as SearchInput).query : (input as FetchInput).url;
    try {
      const chain = await this.chain(kind, signal, opts.onlyEngine ?? opts.preferEngine, opts.onlyEngine);
      if (!chain.length) throw new RouterError(`Keine aktivierte ${kind === 'search' ? 'Such-Engine' : 'Fetch-Engine'} verfügbar. Engines, Cooldown und Gratis-Kontingent prüfen.`, attempts);
      for (const c of chain) {
        signal.throwIfAborted();
        let reservation: Health | undefined;
        const cost = requestCost(c.adapter, kind, input);
        // Check and reserve synchronously after obtaining the current snapshot.
        if (cfg.settings.strictFreeMode) {
          const remote = c.adapter.meta.quotaEndpoint ? (await fetchRemoteQuotaCached(c.adapter, c.ctx)).quota : null;
          const quota = quotaStatus(c.adapter, c.ctx, cfg, this.opts.usage, remote);
          const health = this.state(c);
          if (quota.limit !== null && quota.used !== null && quota.used + health.reserved + cost > quota.limit) continue;
          health.reserved += cost;
          reservation = health;
        }
        const at = Date.now();
        let value: SearchOutcome | string;
        try {
          value = await abortable<SearchOutcome | string>(kind === 'search'
            ? c.adapter.search!(input as SearchInput, c.ctx)
            : c.adapter.fetchUrl!(input as FetchInput, c.ctx), signal);
          signal.throwIfAborted();
        } catch (err) {
          if (signal.aborted) throw signal.reason;
          const error = err instanceof Error ? err.message : String(err);
          this.failure(c, err); this.recordUsage(c, kind, input, error);
          attempts.push({ engine: c.adapter.meta.id, ok: false, ms: Date.now() - at, error });
          continue;
        } finally {
          if (reservation) reservation.reserved -= cost;
        }
        const health = this.state(c); health.failures = 0; health.until = 0;
        this.recordUsage(c, kind, input);
        recordRemoteConsumption(c.adapter, c.ctx, requestCost(c.adapter, kind, input));
        attempts.push({ engine: c.adapter.meta.id, ok: true, ms: Date.now() - at });
        this.opts.history?.record({ kind, input: rawInput, engine: c.adapter.meta.id, ok: true, ms: Date.now() - start, attempts,
          result: typeof value === 'string' ? { chars: value.length, markdown: value } : { count: value.items.length, items: value.items } });
        return { value, engine: c.adapter.meta.id, attempts };
      }
      const message = attempts.length === chain.length
        ? `Alle ${attempts.length} ${kind === 'search' ? 'Such-Engines' : 'Fetch-Engines'} fehlgeschlagen.`
        : 'Gratis-Kontingent erschöpft; keine weitere Engine verfügbar.';
      throw new RouterError(message, attempts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.history?.record({ kind, input: rawInput, engine: null, ok: false, ms: Date.now() - start, attempts, error: message });
      throw err instanceof RouterError ? err : new RouterError(message, attempts);
    } finally { clearTimeout(timer); }
  }

  async search(input: SearchInput, opts: RouterOptions = {}): Promise<SearchResponse> {
    const { value, engine, attempts } = await this.execute('search', input, opts);
    return { ...(value as SearchOutcome), engine, attempts };
  }
  async fetchUrl(input: FetchInput, opts: RouterOptions = {}): Promise<FetchResponse> {
    const { value, engine, attempts } = await this.execute('fetch', input, opts);
    return { markdown: value as string, engine, attempts };
  }
}
