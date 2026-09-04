import type { EngineAdapter, EngineContext, RemoteQuota } from "./types.js";
import type { PolyConfig } from "./config.js";
import type { EngineUsage, UsageStore } from "./usage.js";
import { quotaStatus, remainingPct, type QuotaStatus } from "./quota.js";
import { createHash } from "node:crypto";
import { abortable } from "./abort.js";

export interface StatusRow {
  id: string;
  label: string;
  homepage: string;
  signupUrl: string;
  capabilities: string[];
  keyless: "no" | "ip";
  notes?: string;
  extraFields: { key: string; label: string }[];
  enabled: boolean;
  searchPosition: number;
  fetchPosition: number;
  hasKey: boolean;
  keyMasked: string;
  extrasSet: Record<string, boolean>;
  monthlyLimit: number;
  used: EngineUsage;
  remote: RemoteQuota | null;
  remoteError?: string;
  remainingPct: number | null;
  lastError?: string;
  quota: QuotaStatus;
}

interface CacheEntry {
  at: number;
  quota: RemoteQuota | null;
  error?: string;
}

const remoteCache = new Map<string, CacheEntry>();
const REMOTE_TTL_MS = 5 * 60 * 1000;
type QuotaResult = { quota: RemoteQuota | null; error?: string };
interface PendingQuota {
  controller: AbortController;
  waiters: number;
  consumed: number;
  settled: boolean;
  promise: Promise<QuotaResult>;
}
const pendingQuotas = new Map<string, PendingQuota>();
let cacheGeneration = 0;

export function maskKey(key?: string): string {
  if (!key) return "";
  if (key.length <= 10) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Remote-Quota-Cache leeren (z. B. nach dem Hinterlegen eines neuen Keys). */
export function clearRemoteQuotaCache(): void {
  remoteCache.clear();
  // Old callers may finish, but their snapshots must not refill this generation.
  cacheGeneration++;
  pendingQuotas.clear();
}

/** Remote-Quota vom Anbieter abrufen, 5 Minuten gecacht. */
export async function fetchRemoteQuotaCached(
  adapter: EngineAdapter,
  ctx: EngineContext,
): Promise<{ quota: RemoteQuota | null; error?: string }> {
  if (!adapter.remoteQuota || !ctx.apiKey) return { quota: null };
  ctx.signal?.throwIfAborted();
  const key = cacheKey(adapter, ctx);
  const cached = remoteCache.get(key);
  if (cached && Date.now() - cached.at < REMOTE_TTL_MS) {
    return { quota: cached.quota, error: cached.error };
  }
  let pending = pendingQuotas.get(key);
  if (!pending) {
    const generation = cacheGeneration;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const entry: PendingQuota = { controller, waiters: 0, consumed: 0, settled: false, promise: Promise.resolve({ quota: null }) };
    pendingQuotas.set(key, entry);
    entry.promise = (async (): Promise<QuotaResult> => {
      try {
        const snapshot = await abortable(Promise.resolve().then(() => {
          signal.throwIfAborted();
          return adapter.remoteQuota!({ ...ctx, signal });
        }), signal);
        // Provider snapshots may predate requests completed while fetching.
        // Conservatively add that consumption instead of restoring spent quota.
        const quota = addConsumption(snapshot, entry.consumed);
        if (cacheGeneration === generation && pendingQuotas.get(key) === entry) remoteCache.set(key, { at: Date.now(), quota });
        return { quota };
      } catch (err) {
        if (controller.signal.aborted) throw controller.signal.reason;
        const error = err instanceof Error ? err.message : String(err);
        if (cacheGeneration === generation && pendingQuotas.get(key) === entry) remoteCache.set(key, { at: Date.now(), quota: null, error });
        return { quota: null, error };
      } finally {
        entry.settled = true;
        if (pendingQuotas.get(key) === entry) pendingQuotas.delete(key);
      }
    })();
    pending = entry;
  }
  pending.waiters++;
  try {
    return await abortable(pending.promise, ctx.signal);
  } finally {
    pending.waiters--;
    if (pending.waiters === 0 && !pending.settled) {
      if (pendingQuotas.get(key) === pending) pendingQuotas.delete(key);
      pending.controller.abort(new Error("Keine wartenden Quota-Aufrufe mehr"));
    }
  }
}

export async function buildStatus(
  cfg: PolyConfig,
  usage: UsageStore,
  adapters: EngineAdapter[],
): Promise<StatusRow[]> {
  const searchPos = new Map(cfg.engines.map((e, i) => [e.id, i] as const));
  const fetchPos = new Map(cfg.fetchOrder.map((id, i) => [id, i] as const));

  const rows = adapters.map(async (adapter): Promise<StatusRow> => {
    const meta = adapter.meta;
    const e = cfg.engines.find((x) => x.id === meta.id);
    const used = usage.get(meta.id);
    const monthlyLimit = !e?.apiKey ? 0 : cfg.settings.monthlyLimits[meta.id] ?? meta.monthlyFree;

    const { quota, error } = await fetchRemoteQuotaCached(adapter, {
      apiKey: e?.apiKey,
      extra: e?.extra,
    });

    return {
      id: meta.id,
      label: meta.label,
      homepage: meta.homepage,
      signupUrl: meta.signupUrl,
      capabilities: !e?.apiKey && meta.keylessCapabilities ? meta.keylessCapabilities : meta.capabilities,
      keyless: meta.keyless,
      notes: meta.notes,
      extraFields: meta.extraFields ?? [],
      enabled: e?.enabled ?? true,
      searchPosition: searchPos.get(meta.id) ?? -1,
      fetchPosition: fetchPos.has(meta.id) ? (fetchPos.get(meta.id) as number) : -1,
      hasKey: Boolean(e?.apiKey),
      keyMasked: maskKey(e?.apiKey),
      extrasSet: Object.fromEntries(
        (meta.extraFields ?? []).map((f) => [f.key, Boolean(e?.extra?.[f.key])]),
      ),
      monthlyLimit,
      used,
      remote: quota,
      remoteError: error,
      remainingPct: remainingPct(quotaStatus(adapter, { apiKey: e?.apiKey }, cfg, usage, quota)),
      quota: quotaStatus(adapter, { apiKey: e?.apiKey }, cfg, usage, quota),
      lastError: used.lastError,
    };
  });

  return Promise.all(rows);
}

function cacheKey(adapter: EngineAdapter, ctx: EngineContext): string {
  return adapter.meta.id + ':' + createHash('sha256').update(JSON.stringify([ctx.apiKey, ctx.extra])).digest('hex');
}

/** Account for requests made since the last provider snapshot. */
export function recordRemoteConsumption(adapter: EngineAdapter, ctx: EngineContext, units: number): void {
  if (!Number.isFinite(units) || units <= 0) return;
  const key = cacheKey(adapter, ctx);
  const pending = pendingQuotas.get(key);
  if (pending) pending.consumed += units;
  const entry = remoteCache.get(key);
  if (entry?.quota) entry.quota = addConsumption(entry.quota, units);
}

function addConsumption(q: RemoteQuota, units: number): RemoteQuota {
  if (!units || !q.limit || (q.used === undefined && q.remaining === undefined)) return q;
  const used = (q.used ?? q.limit - q.remaining!) + units;
  return { ...q, used, remaining: Math.max(0, q.limit - used), estimated: true };
}
