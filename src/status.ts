import type { EngineAdapter, EngineContext, RemoteQuota } from "./types.js";
import type { PolyConfig } from "./config.js";
import type { EngineUsage, UsageStore } from "./usage.js";
import { computeRemainingPct } from "./quota.js";

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
}

interface CacheEntry {
  at: number;
  quota: RemoteQuota | null;
  error?: string;
}

const remoteCache = new Map<string, CacheEntry>();
const REMOTE_TTL_MS = 5 * 60 * 1000;

export function maskKey(key?: string): string {
  if (!key) return "";
  if (key.length <= 10) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Remote-Quota-Cache leeren (z. B. nach dem Hinterlegen eines neuen Keys). */
export function clearRemoteQuotaCache(): void {
  remoteCache.clear();
}

/** Remote-Quota vom Anbieter abrufen, 5 Minuten gecacht. */
export async function fetchRemoteQuotaCached(
  adapter: EngineAdapter,
  ctx: EngineContext,
): Promise<{ quota: RemoteQuota | null; error?: string }> {
  if (!adapter.remoteQuota || !ctx.apiKey) return { quota: null };
  const cached = remoteCache.get(adapter.meta.id);
  if (cached && Date.now() - cached.at < REMOTE_TTL_MS) {
    return { quota: cached.quota, error: cached.error };
  }
  try {
    const quota = await adapter.remoteQuota(ctx);
    remoteCache.set(adapter.meta.id, { at: Date.now(), quota });
    return { quota };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    remoteCache.set(adapter.meta.id, { at: Date.now(), quota: null, error });
    return { quota: null, error };
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
    const monthlyLimit = cfg.settings.monthlyLimits[meta.id] ?? meta.monthlyFree;

    const { quota, error } = await fetchRemoteQuotaCached(adapter, {
      apiKey: e?.apiKey,
      extra: e?.extra,
    });

    return {
      id: meta.id,
      label: meta.label,
      homepage: meta.homepage,
      signupUrl: meta.signupUrl,
      capabilities: meta.capabilities,
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
      remainingPct: computeRemainingPct(used, monthlyLimit, quota),
      lastError: used.lastError,
    };
  });

  return Promise.all(rows);
}
