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
  searchOrder: string[];
  fetchOrder: string[];
  defaultEnabled: Record<string, boolean>;
}

export function normalizeConfig(raw: unknown, d: ConfigDefaults): PolyConfig {
  const known = new Set(d.searchOrder);
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
  for (const id of d.searchOrder) {
    if (!have.has(id)) rawEngines.push({ id, enabled: d.defaultEnabled[id] ?? true });
  }

  const fetchSet = new Set(d.fetchOrder);
  const fo: string[] = Array.isArray((raw as any)?.fetchOrder)
    ? (raw as any).fetchOrder.filter((id: unknown) => typeof id === "string" && fetchSet.has(id as string))
    : [];
  for (const id of d.fetchOrder) {
    if (!fo.includes(id)) fo.push(id);
  }

  const s = (raw as any)?.settings ?? {};
  return {
    version: 1,
    engines: rawEngines,
    fetchOrder: fo,
    settings: {
      port: Number.isInteger(s.port) && s.port >= 1024 && s.port <= 65535 ? s.port : 6277,
      token: typeof s.token === "string" ? s.token : "",
      monthlyLimits:
        s.monthlyLimits && typeof s.monthlyLimits === "object" && !Array.isArray(s.monthlyLimits)
          ? (s.monthlyLimits as Record<string, number>)
          : {},
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
