export type Capability = "search" | "fetch";

export interface SearchItem {
  title: string;
  url: string;
  snippet?: string;
  published?: string;
}

export interface SearchOutcome {
  items: SearchItem[];
  answer?: string;
}

export interface SearchInput {
  query: string;
  numResults?: number;
  timeRange?: "day" | "week" | "month" | "year";
  startDate?: string;
  endDate?: string;
}

export interface FetchInput {
  url: string;
}

export interface EngineContext {
  apiKey?: string;
  extra?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RemoteQuota {
  /** True when local estimated consumption was added to the provider snapshot. */
  estimated?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
}

export interface QuotaPolicy {
  period: "day" | "month" | "ip";
  unit: "requests" | "credits";
  limit?: number;
  timeZone?: string;
  estimated?: boolean;
  costs?: Partial<Record<Capability, number>>;
}

export interface EngineMeta {
  id: string;
  label: string;
  homepage: string;
  signupUrl: string;
  /** "no" = Key erforderlich, "ip" = ohne Key IP-basiert nutzbar (kleines Limit) */
  keyless: "no" | "ip";
  capabilities: Capability[];
  /** Capabilities available without credentials; omitted means all. */
  keylessCapabilities?: Capability[];
  /** Typisches Gratis-Monatskontingent für die lokale Zählung; 0 = kein festes Limit */
  monthlyFree: number;
  quota?: QuotaPolicy;
  /** true = Restkontingent per Anbieter-API abrufbar */
  quotaEndpoint: boolean;
  /** Zusätzliche Konfigfelder (z. B. Google CX) */
  extraFields?: { key: string; label: string }[];
  notes?: string;
  defaultEnabled?: boolean;
}

export interface EngineAdapter {
  meta: EngineMeta;
  /** Explicit opt-in for native date filtering, including credential-specific support. */
  supportsSearchTime?(input: SearchInput, ctx: EngineContext): boolean;
  estimateCost?(kind: Capability, input: SearchInput | FetchInput): number;
  search?(input: SearchInput, ctx: EngineContext): Promise<SearchOutcome>;
  fetchUrl?(input: FetchInput, ctx: EngineContext): Promise<string>;
  remoteQuota?(ctx: EngineContext): Promise<RemoteQuota>;
}

export interface Attempt {
  engine: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface SearchResponse extends SearchOutcome {
  engine: string;
  attempts: Attempt[];
}

export interface FetchResponse {
  engine: string;
  markdown: string;
  attempts: Attempt[];
}

export interface TestResult {
  ok: boolean;
  ms: number;
  error?: string;
  count?: number;
  chars?: number;
  preview?: string;
}

/** Eintrag für den Verlauf (Such-/Fetch-Aufruf mit Ergebnis). */
export interface HistoryRecord {
  kind: "search" | "fetch";
  /** Query bzw. URL */
  input: string;
  engine: string | null;
  ok: boolean;
  ms: number;
  attempts: Attempt[];
  error?: string;
  result?: {
    count?: number;
    chars?: number;
    items?: SearchItem[];
    markdown?: string;
  };
}
