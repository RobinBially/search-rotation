import type { Capability, EngineAdapter, EngineContext, FetchInput, RemoteQuota, SearchInput } from './types.js';
import type { EngineUsage, UsageStore } from './usage.js';
import type { PolyConfig } from './config.js';

export function computeRemainingPct(
  used: Pick<EngineUsage, 'search' | 'fetch'> & { consumed?: number }, limit: number, remote: RemoteQuota | null,
): number | null {
  if (remote && typeof remote.limit === 'number' && remote.limit > 0) {
    const remaining = remote.remaining ?? remote.limit - (remote.used ?? 0);
    return Math.max(0, Math.min(1, remaining / remote.limit));
  }
  if (limit > 0) {
    const total = used.consumed ?? Number(used.search) + Number(used.fetch);
    return Number.isFinite(total) ? Math.max(0, Math.min(1, (limit - total) / limit)) : null;
  }
  return null;
}

export interface QuotaStatus {
  period: 'day' | 'month' | 'ip';
  unit: 'requests' | 'credits';
  limit: number | null;
  used: number | null;
  source: 'remote' | 'local' | 'unknown';
  estimated: boolean;
  timeZone?: string;
}

export function requestCost(adapter: EngineAdapter, kind: Capability, input: SearchInput | FetchInput): number {
  const value = adapter.estimateCost?.(kind, input) ?? adapter.meta.quota?.costs?.[kind] ?? 1;
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

export function quotaStatus(adapter: EngineAdapter, ctx: EngineContext, cfg: PolyConfig, usage: UsageStore, remote: RemoteQuota | null): QuotaStatus {
  const policy = adapter.meta.quota;
  const period = adapter.meta.keyless === 'ip' && !ctx.apiKey ? 'ip' : policy?.period ?? 'month';
  const unit = policy?.unit ?? 'requests';
  if (period === 'ip') return { period, unit, limit: null, used: null, source: 'unknown', estimated: true };
  const count = period === 'day' ? usage.getDay(adapter.meta.id, policy?.timeZone) : usage.get(adapter.meta.id);
  const localUsed = unit === 'credits' ? count.consumed ?? count.search + count.fetch : count.search + count.fetch;
  const limit = period === 'day'
    ? cfg.settings.dailyLimits?.[adapter.meta.id] ?? policy?.limit ?? 0
    : cfg.settings.monthlyLimits[adapter.meta.id] ?? policy?.limit ?? adapter.meta.monthlyFree;
  if (remote && typeof remote.limit === 'number' && remote.limit > 0 && (remote.used !== undefined || remote.remaining !== undefined)) {
    return { period, unit, limit: remote.limit, used: Math.max(0, remote.used ?? remote.limit - remote.remaining!), source: 'remote', estimated: remote.estimated ?? false, timeZone: policy?.timeZone };
  }
  return { period, unit, limit: limit > 0 ? limit : null, used: localUsed, source: limit > 0 ? 'local' : 'unknown', estimated: policy?.estimated ?? true, timeZone: policy?.timeZone };
}

export function remainingPct(quota: QuotaStatus): number | null {
  return quota.limit && quota.used !== null ? Math.max(0, Math.min(1, (quota.limit - quota.used) / quota.limit)) : null;
}
