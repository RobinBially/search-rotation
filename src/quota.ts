import type { RemoteQuota } from "./types.js";
import type { EngineUsage } from "./usage.js";

/**
 * Restkontingent als Anteil (0..1). null = kein festes Limit bekannt.
 * Remote-Quota vom Anbieter hat Vorrang vor der lokalen Zählung.
 */
export function computeRemainingPct(
  used: Pick<EngineUsage, "search" | "fetch">,
  limit: number,
  remote: RemoteQuota | null,
): number | null {
  if (remote && typeof remote.limit === "number" && remote.limit > 0) {
    const remaining = remote.remaining ?? remote.limit - (remote.used ?? 0);
    return Math.max(0, Math.min(1, remaining / remote.limit));
  }
  if (limit > 0) {
    return Math.max(0, Math.min(1, (limit - (used.search + used.fetch)) / limit));
  }
  return null;
}
