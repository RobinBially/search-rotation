import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSearchTime } from '../src/search-time.js';
import { SearchRouter } from '../src/router.js';
import { UsageStore } from '../src/usage.js';
import { ADAPTERS } from '../src/engines/index.js';
import type { EngineAdapter, SearchInput, PolyConfig } from '../src/types.js';

const now = Date.parse('2026-09-05T12:34:56Z');
const bounds = { startDate: '2026-08-01', endDate: '2026-08-31' };
function fixture(t: any, adapters: EngineAdapter[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sr-time-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const usage = new UsageStore(dir);
  const config: PolyConfig = { version: 1, engines: adapters.map(a => ({ id: a.meta.id, enabled: true })), fetchOrder: [], settings: { port: 6277, token: '', monthlyLimits: {} } };
  const history: any[] = [];
  return { config, usage, history, router: new SearchRouter({ adapters, getConfig: () => config, usage, now: () => now, history: { record: e => history.push(e) } }) };
}
function adapter(id: string, support: boolean, run?: (input: SearchInput) => void): EngineAdapter {
  return { meta: { id, label: id, homepage: '', signupUrl: '', keyless: 'ip', capabilities: ['search'], monthlyFree: 0, quotaEndpoint: false }, supportsSearchTime: () => support,
    search: async input => { run?.(input); return { items: [] }; } };
}

test('UTC windows resolve once, including month/year and leap-day validation', () => {
  for (const [timeRange, startDate] of [['day', '2026-09-04'], ['week', '2026-08-29'], ['month', '2026-08-06'], ['year', '2025-09-05']] as const) {
    assert.deepEqual(normalizeSearchTime({ query: 'q', timeRange }, now), { query: 'q', timeRange, startDate, endDate: '2026-09-05' });
  }
  assert.equal(normalizeSearchTime({ query: 'q', startDate: '2024-02-29' }, now).startDate, '2024-02-29');
  assert.doesNotThrow(() => normalizeSearchTime({ query: 'q', startDate: '2026-09-05', endDate: '2026-09-05' }, now));
});

test('invalid filter combinations/dates are rejected before provider requests', async t => {
  let calls = 0;
  const { router } = fixture(t, [adapter('a', true, () => { calls++; })]);
  for (const filter of [ { timeRange: 'hour' }, { startDate: '2026-02-29' }, { endDate: '2026-04-31' }, { startDate: '2026-9-1' }, { timeRange: 'week', startDate: '2026-09-01' }, { timeRange: 'day', endDate: '2026-09-01' }, { startDate: '2026-09-02', endDate: '2026-09-01' } ]) {
    await assert.rejects(router.search({ query: 'q', ...filter } as SearchInput));
  }
  assert.equal(calls, 0);
});

test('incompatible preferred provider is skipped before quota requests; failover preserves resolved dates', async t => {
  const seen: SearchInput[] = [];
  const unsupported = adapter('unsupported', false, () => assert.fail('unfiltered fallback'));
  unsupported.meta.quotaEndpoint = true;
  unsupported.remoteQuota = async () => { assert.fail('quota queried for incompatible provider'); };
  const { router, history } = fixture(t, [unsupported, adapter('fail', true, input => { seen.push(input); throw Error('offline'); }), adapter('ok', true, input => { seen.push(input); })]);
  const result = await router.search({ query: 'q', timeRange: 'week' }, { preferEngine: 'unsupported' });
  assert.equal(result.engine, 'ok');
  assert.deepEqual(result.attempts.map(a => a.engine), ['fail', 'ok']);
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(seen[0].startDate, '2026-08-29');
  assert.match(history[0].input, /from 2026-08-29 through 2026-09-05/);
});

test('no compatible provider fails explicitly, including onlyEngine; ordinary search still works', async t => {
  let calls = 0;
  const { router } = fixture(t, [adapter('a', false, () => { calls++; })]);
  await assert.rejects(router.search({ query: 'q', ...bounds }), /Zeitfilter/);
  await assert.rejects(router.search({ query: 'q', ...bounds }, { onlyEngine: 'a' }), /Zeitfilter/);
  assert.equal(calls, 0);
  assert.equal((await router.search({ query: 'q' })).engine, 'a');
});

test('filtered rotation remains fair when interleaved with unfiltered requests', async t => {
  const { router } = fixture(t, [adapter('a', true), adapter('b', true), adapter('c', false)]);
  const filtered: string[] = [];
  const unfiltered: string[] = [];
  for (let i = 0; i < 6; i++) {
    filtered.push((await router.search({ query: 'q', ...bounds })).engine);
    unfiltered.push((await router.search({ query: 'q' })).engine);
  }
  assert.deepEqual(filtered, ['a', 'b', 'a', 'b', 'a', 'b']);
  assert.deepEqual(unfiltered, ['a', 'b', 'c', 'a', 'b', 'c']);
});

test('filtered pool retains quota ordering and strict-free exclusion', async t => {
  const a = adapter('a', true); const b = adapter('b', true);
  a.meta.monthlyFree = b.meta.monthlyFree = 10;
  const { router, usage, config } = fixture(t, [a, b]);
  config.engines.forEach(e => { e.apiKey = 'fixture'; });
  for (let i = 0; i < 9; i++) usage.record('a', 'search');
  assert.equal((await router.search({ query: 'q', ...bounds })).engine, 'b');
  usage.record('a', 'search');
  config.settings.strictFreeMode = true;
  assert.equal((await router.search({ query: 'q', ...bounds }, { preferEngine: 'a' })).engine, 'b');
});

test('capability matrix accounts for credentials and one-sided bounds', () => {
  for (const a of ADAPTERS.filter(a => a.search)) {
    for (const apiKey of [undefined, 'fixture']) {
      const ctx = { apiKey };
      assert.equal(Boolean(a.supportsSearchTime?.({ query: 'q', ...bounds }, ctx)), ['tavily', 'firecrawl'].includes(a.meta.id) || (a.meta.id === 'exa' && Boolean(apiKey)), `${a.meta.id}: two bounds`);
      assert.equal(Boolean(a.supportsSearchTime?.({ query: 'q', startDate: bounds.startDate }, ctx)), a.meta.id === 'tavily' || (a.meta.id === 'exa' && Boolean(apiKey)), `${a.meta.id}: one bound`);
    }
  }
});

for (const id of ['tavily', 'firecrawl', 'exa']) test(`${id}: native date fields are sent on the wire`, async t => {
  const a = ADAPTERS.find(a => a.meta.id === id)!;
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (id === 'tavily') { assert.equal(body.start_date, '2026-08-01'); assert.equal(body.end_date, '2026-08-31'); }
    if (id === 'firecrawl') assert.equal(body.tbs, 'cdr:1,cd_min:08/01/2026,cd_max:08/31/2026');
    if (id === 'exa') { assert.equal(body.startPublishedDate, '2026-08-01T00:00:00.000Z'); assert.equal(body.endPublishedDate, '2026-08-31T23:59:59.999Z'); }
    assert.equal(body.query, 'q');
    return Response.json({ results: [], data: { web: [] } });
  });
  await a.search!({ query: 'q', ...bounds }, { apiKey: 'fixture' });
  if (id !== 'exa') await a.search!({ query: 'q', ...bounds }, {});
});
