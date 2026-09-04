import { test as nodeTest } from 'node:test';
const test = (name: string, fn: (t: any) => any) => nodeTest(name, { timeout: 1200 }, fn);
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SearchRouter } from '../src/router.js';
import { UsageStore } from '../src/usage.js';
import { HttpError } from '../src/engines/base.js';
import { buildStatus, clearRemoteQuotaCache } from '../src/status.js';
import type { EngineAdapter } from '../src/types.js';

function setup(t: any, ids = ['a', 'b']) {
  const dir = mkdtempSync(join(tmpdir(), 'sr-resilience-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearRemoteQuotaCache(); });
  const usage = new UsageStore(dir);
  const adapters: EngineAdapter[] = ids.map(id => ({
    meta: { id, label: id, homepage: '', signupUrl: '', keyless: 'no', capabilities: ['search', 'fetch'], monthlyFree: 100, quotaEndpoint: false },
    search: async () => ({ items: [] }), fetchUrl: async () => 'page',
  }));
  const cfg: any = { version: 1, engines: ids.map(id => ({ id, enabled: true, apiKey: 'dummy' })), fetchOrder: ids,
    settings: { port: 6277, token: '', monthlyLimits: {}, requestTimeoutMs: 1000, strictFreeMode: false } };
  let now = 0;
  const router = new SearchRouter({ getConfig: () => cfg, usage, adapters, now: () => now } as any);
  return { usage, adapters, cfg, router, advance: (ms: number) => now += ms };
}

test('Quota-Priorität bleibt über mehrere Rotationen erhalten', async t => {
  const { usage, router } = setup(t);
  for (let i = 0; i < 100; i++) usage.record('a', 'search');
  for (let i = 0; i < 5; i++) assert.equal((await router.search({ query: 'q' })).engine, 'b');
});
test('Search und Fetch besitzen unabhängige Rotationen', async t => {
  const { router } = setup(t); const searches = [], fetches = [];
  for (let i = 0; i < 4; i++) { searches.push((await router.search({ query: 'q' })).engine); fetches.push((await router.fetchUrl({ url: 'https://example.com' })).engine); }
  assert.deepEqual(searches, ['a', 'b', 'a', 'b']); assert.deepEqual(fetches, searches);
});
test('Strikter Gratis-Modus überspringt auch gepinnte und einzige erschöpfte Engine', async t => {
  const { router, cfg, usage } = setup(t, ['a']); cfg.settings.strictFreeMode = true;
  for (let i = 0; i < 100; i++) usage.record('a', 'search');
  await assert.rejects(router.search({ query: 'q' }, { preferEngine: 'a' }), /Kontingent|Gratis/);
});
test('429 respektiert Retry-After und probiert Engine nach Ablauf erneut', async t => {
  const { router, adapters, advance } = setup(t); let calls = 0;
  adapters[0].search = async () => { calls++; throw new HttpError(429, 'limited', 'https://example.com', '2'); };
  await router.search({ query: 'q' }, { preferEngine: 'a' });
  await router.search({ query: 'q' }, { preferEngine: 'a' }); assert.equal(calls, 1);
  advance(2001); await router.search({ query: 'q' }, { preferEngine: 'a' }); assert.equal(calls, 2);
});
test('Wiederholte transiente Fehler lösen Cooldown aus, erster Fehler nicht', async t => {
  const { router, adapters } = setup(t); let calls = 0;
  adapters[0].search = async () => { calls++; throw new Error('network down'); };
  for (let i = 0; i < 3; i++) await router.search({ query: 'q' }, { preferEngine: 'a' });
  assert.equal(calls, 2);
});
test('Keywechsel hebt alten Cooldown auf', async t => {
  const { router, adapters, cfg } = setup(t); let calls = 0;
  adapters[0].search = async () => { calls++; throw new HttpError(401, 'bad key', 'https://example.com'); };
  await router.search({ query: 'q' }, { preferEngine: 'a' }); cfg.engines[0].apiKey = 'replacement';
  await router.search({ query: 'q' }, { preferEngine: 'a' }); assert.equal(calls, 2);
});
test('Gesamtbudget beendet hängenden Adapter und startet keinen weiteren', async t => {
  const { router, cfg, adapters } = setup(t); cfg.settings.requestTimeoutMs = 30;
  let fallback = 0; let signal: AbortSignal | undefined;
  adapters[0].search = async (_input, ctx) => { signal = ctx.signal; return new Promise(() => {}); };
  adapters[1].search = async () => { fallback++; return { items: [] }; };
  await assert.rejects(router.search({ query: 'q' }), /Zeitlimit|Timeout/);
  assert.equal(signal?.aborted, true); assert.equal(fallback, 0);
});
test('Client-Abbruch wird an Adapter weitergereicht und verhindert Failover', async t => {
  const { router, adapters } = setup(t); const ac = new AbortController(); let fallback = 0;
  adapters[0].fetchUrl = async (_input, ctx) => { assert.ok(ctx.signal); ac.abort(); return new Promise(() => {}); };
  adapters[1].fetchUrl = async () => { fallback++; return 'other'; };
  await assert.rejects(router.fetchUrl({ url: 'https://example.com' }, { signal: ac.signal } as any), /abgebrochen|abort/i);
  assert.equal(fallback, 0);
});
test('Bereits abgebrochener Request ruft keinen Adapter auf', async t => {
  const { router, adapters } = setup(t); let calls = 0; adapters[0].search = async () => { calls++; return { items: [] }; };
  await assert.rejects(router.search({ query: 'q' }, { signal: AbortSignal.abort() } as any)); assert.equal(calls, 0);
});
test('Gesamtbudget umfasst auch Remote-Quota-Abfrage', async t => {
  const { router, cfg, adapters } = setup(t); cfg.settings.requestTimeoutMs = 30;
  adapters[0].meta.quotaEndpoint = true; adapters[0].remoteQuota = async () => new Promise(() => {});
  await assert.rejects(router.search({ query: 'q' }), /Zeitlimit|Timeout/);
});
test('Tageskontingent wird unabhängig vom Monatszähler ausgeschöpft', async t => {
  const { router, cfg, adapters, usage } = setup(t); cfg.settings.strictFreeMode = true;
  (adapters[0].meta as any).quota = { period: 'day', unit: 'requests', limit: 2, timeZone: 'America/Los_Angeles' };
  (usage.record as any)('a', 'search', undefined, 1, 'America/Los_Angeles');
  (usage.record as any)('a', 'search', undefined, 1, 'America/Los_Angeles');
  assert.equal((await router.search({ query: 'q' }, { preferEngine: 'a' })).engine, 'b');
});
test('IP-Kontingente ohne Key werden nicht als Monatsguthaben dargestellt', async t => {
  const { adapters, cfg, usage } = setup(t); adapters[0].meta.keyless = 'ip'; delete cfg.engines[0].apiKey;
  const [row] = await buildStatus(cfg, usage, adapters);
  assert.equal(row.remainingPct, null); assert.equal((row as any).quota.period, 'ip'); assert.equal((row as any).quota.limit, null);
});
test('Credits werden getrennt von Aufrufzahlen gezählt', async t => {
  const { router, adapters, usage } = setup(t, ['a']);
  (adapters[0].meta as any).quota = { period: 'month', unit: 'credits', limit: 100, costs: { search: 2, fetch: 0.2 }, estimated: true };
  await router.search({ query: 'q' }); await router.fetchUrl({ url: 'https://example.com' });
  assert.equal(usage.get('a').search, 1); assert.equal(usage.get('a').fetch, 1);
  assert.equal((usage.get('a') as any).consumed, 2.2);
});
test('Remote-Quota-Cache berücksichtigt eigenen Verbrauch sofort', async t => {
  const { router, adapters, cfg, usage } = setup(t, ['a']);
  adapters[0].meta.quotaEndpoint = true; adapters[0].remoteQuota = async () => ({ limit: 10, remaining: 1 });
  cfg.settings.strictFreeMode = true;
  await router.search({ query: 'q' });
  await assert.rejects(router.search({ query: 'q' }), /Kontingent|Gratis/);
});

test('Strikter Gratis-Modus reserviert laufende Einheiten innerhalb eines Routers', async t => {
  const { router, cfg, adapters, usage } = setup(t, ['a']);
  cfg.settings.strictFreeMode = true; cfg.settings.monthlyLimits.a = 1;
  let started = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  adapters[0].search = async () => { started++; await barrier; return { items: [] }; };
  const first = router.search({ query: 'q' });
  while (started === 0) await new Promise(resolve => setTimeout(resolve, 1));
  const second = router.search({ query: 'q' }).catch(err => err);
  setTimeout(release, 25);
  await first;
  const result = await second;
  assert.ok(result instanceof Error); assert.match(result.message, /Kontingent|Gratis/);
  assert.equal(started, 1); assert.equal(usage.get('a').search, 1);
});

test('Engine-Diagnose testet ausschließlich die gewünschte auch deaktivierte Engine', async t => {
  const { router, adapters, cfg } = setup(t); cfg.engines[0].enabled = false;
  assert.equal((await router.search({ query: 'q' }, { onlyEngine: 'a' } as any)).engine, 'a');
  adapters[0].search = async () => { throw new Error('diagnostic failure'); };
  await assert.rejects(router.search({ query: 'q' }, { onlyEngine: 'a' } as any), /fehlgeschlagen/);
});
test('Engine-Diagnose umgeht den strikten Gratis-Modus nicht', async t => {
  const { router, cfg, usage } = setup(t); cfg.settings.strictFreeMode = true; cfg.settings.monthlyLimits.a = 1;
  usage.record('a', 'search');
  await assert.rejects(router.search({ query: 'q' }, { onlyEngine: 'a' } as any), /Kontingent|Gratis/);
});
