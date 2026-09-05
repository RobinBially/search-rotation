import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EngineConfig {
  id: string;
  enabled: boolean;
  apiKey?: string;
  extra?: Record<string, string>;
}

export interface Settings {
  port: number;
  token: string;
  /** Überschreibt das Standard-Kontingent pro Engine (lokale Zählung) */
  monthlyLimits: Record<string, number>;
  dailyLimits?: Record<string, number>;
  strictFreeMode?: boolean;
  requestTimeoutMs?: number;
  /** null delegates result count to the provider; absent preserves legacy default 8. */
  defaultNumResults?: number | null;
}

export interface PolyConfig {
  version: 1;
  /** Reihenfolge = Such-Rotation */
  engines: EngineConfig[];
  /** Reihenfolge der Fetch-Rotation (Teilmenge der Engines mit "fetch") */
  fetchOrder: string[];
  settings: Settings;
}

export function configDir(): string {
  return process.env.SEARCH_ROTATION_HOME || path.join(os.homedir(), ".config", "search-rotation");
}

export interface ConfigDefaults {
  /** Alle bekannten Engine-Ids (auch fetch-only) */
  knownIds: string[];
  searchOrder: string[];
  fetchOrder: string[];
  defaultEnabled: Record<string, boolean>;
  requiredKeyIds?: string[];
}

export function normalizeConfig(raw: unknown, d: ConfigDefaults): PolyConfig {
  const known = new Set(d.knownIds);
  const rawEngines: EngineConfig[] = Array.isArray((raw as any)?.engines)
    ? (raw as any).engines
        .filter((e: any) => e && typeof e.id === "string" && known.has(e.id))
        .map(
          (e: any): EngineConfig => ({
            id: e.id as string,
            enabled: typeof e.enabled === "boolean" ? e.enabled : d.defaultEnabled[e.id] ?? true,
            apiKey: typeof e.apiKey === "string" && e.apiKey.trim() ? e.apiKey.trim() : undefined,
            extra:
              e.extra && typeof e.extra === "object" && !Array.isArray(e.extra)
                ? (Object.fromEntries(
                    Object.entries(e.extra).filter(([, v]) => typeof v === "string"),
                  ) as Record<string, string>)
                : undefined,
          }),
        )
    : [];
  const have = new Set(rawEngines.map((e) => e.id));
  // Such-Engines in Such-Reihenfolge, danach evtl. fetch-only Engines (z. B. Jina)
  for (const id of d.knownIds) {
    if (!have.has(id)) rawEngines.push({ id, enabled: d.defaultEnabled[id] ?? true });
  }

  const fetchSet = new Set(d.fetchOrder);
  const fo: string[] = Array.isArray((raw as any)?.fetchOrder)
    ? (raw as any).fetchOrder.filter((id: unknown) => typeof id === "string" && fetchSet.has(id as string))
    : [];
  for (const id of d.fetchOrder) {
    if (!fo.includes(id)) fo.push(id);
  }

  const seen = new Set<string>();
  const engines = rawEngines.filter((e) => {
    // Hand-editierte Configs können Dubletten enthalten — der Router würde
    // sonst dieselbe Engine mehrfach pro Suche aufrufen (doppelte Quota!).
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  for (const engine of engines) {
    if (d.requiredKeyIds?.includes(engine.id) && !engine.apiKey) engine.enabled = false;
  }
  const s = (raw as any)?.settings ?? {};
  const rawLimits =
    s.monthlyLimits && typeof s.monthlyLimits === "object" && !Array.isArray(s.monthlyLimits)
      ? s.monthlyLimits
      : {};
  // Nur endliche Zahlen >= 0 — ein Tippfehler ("abc") würde die Engine sonst
  // unbegrenzt schalten, statt sie zu drosseln.
  const monthlyLimits: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawLimits)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) monthlyLimits[k] = v;
  }
  return {
    version: 1,
    engines,
    fetchOrder: fo,
    settings: {
      port: Number.isInteger(s.port) && s.port >= 1024 && s.port <= 65535 ? s.port : 6277,
      token: typeof s.token === "string" ? s.token : "",
      monthlyLimits,
      dailyLimits: Object.fromEntries(Object.entries(s.dailyLimits ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0)) as Record<string, number>,
      strictFreeMode: s.strictFreeMode === true,
      defaultNumResults: s.defaultNumResults === null ? null : Number.isInteger(s.defaultNumResults) && s.defaultNumResults >= 1 && s.defaultNumResults <= 20 ? s.defaultNumResults : 8,
      requestTimeoutMs: Number.isInteger(s.requestTimeoutMs) && s.requestTimeoutMs >= 1000 && s.requestTimeoutMs <= 300_000 ? s.requestTimeoutMs : 60_000,
    },
  };
}

export class ConfigStore {
  readonly dir: string;
  readonly file: string;

  constructor(dir: string = configDir()) {
    this.dir = dir;
    this.file = path.join(dir, "config.json");
  }

  load(d: ConfigDefaults): PolyConfig {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      const cfg = normalizeConfig(null, d);
      this.save(cfg);
      return cfg;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (err) {
      throw new Error(`Konfigdatei ${this.file} ist kein gültiges JSON: ${(err as Error).message}`);
    }
    return normalizeConfig(raw, d);
  }

  save(cfg: PolyConfig): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* chmod optional */
    }
  }
}
