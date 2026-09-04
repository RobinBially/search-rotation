import { VERSION } from "../version.js";

export const USER_AGENT = `search-rotation/${VERSION}`;

export class NeedsKeyError extends Error {
  constructor(engineId: string, signupUrl: string) {
    super(`${engineId}: kein API-Key konfiguriert — gratis Key: ${signupUrl}`);
    this.name = "NeedsKeyError";
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* URL schon im Fehlertext behalten */
    }
    super(`HTTP ${status} von ${host}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

export interface HttpOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function httpText(url: string, init: RequestInit = {}, opts: HttpOptions = {}): Promise<string> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const res = await fetch(url, {
    ...init,
    signal,
    headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
  });
  const body = await res.text();
  if (!res.ok) throw new HttpError(res.status, body, url);
  return body;
}

export async function httpJson<T = unknown>(url: string, init: RequestInit = {}, opts: HttpOptions = {}): Promise<T> {
  const text = await httpText(
    url,
    { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } },
    opts,
  );
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Ungültige Antwort von ${safeHost(url)} (kein JSON): ${text.slice(0, 120)}`);
  }
}

export function bearer(key?: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {};
}

export function cap(n: number | undefined, fallback = 8, max = 20): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(Math.max(v, 1), max);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
