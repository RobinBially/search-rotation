import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTERS, KNOWN_IDS, SEARCH_ORDER, FETCH_ORDER, DEFAULT_ENABLED } from '../src/engines/index.js';
import { normalizeConfig } from '../src/config.js';
import { UsageStore } from '../src/usage.js';
import { buildStatus } from '../src/status.js';
const defaults = { knownIds: KNOWN_IDS, searchOrder: SEARCH_ORDER, fetchOrder: FETCH_ORDER, defaultEnabled: DEFAULT_ENABLED };
test('Fresh config enables only engines that work without credentials', () => {
  const cfg = normalizeConfig(null, defaults);
  assert.deepEqual(cfg.engines.filter(e => e.enabled).map(e => e.id).sort(), ['exa', 'firecrawl', 'jina', 'parallel', 'tavily']);
});
test('Every keyless engine exposes local successes without a provider cap', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-policy-')); t.after(() => rmSync(dir, { recursive:true, force:true }));
  const usage = new UsageStore(dir);
  const cfg = normalizeConfig(null, defaults);
  for (const a of ADAPTERS.filter(a => a.meta.keyless === 'ip')) {
    usage.record(a.meta.id, 'search'); usage.record(a.meta.id, 'fetch'); usage.record(a.meta.id, 'search', 'failed');
    cfg.settings.monthlyLimits[a.meta.id] = 1400;
  }
  const rows = await buildStatus(cfg, usage, ADAPTERS);
  for (const row of rows) {
    assert.equal(row.quota.limit, null, row.id); assert.equal(row.quota.used, row.keyless === "ip" ? 2 : 0, row.id);
    assert.equal(row.quota.source, 'local'); assert.equal(row.quota.unit, 'requests');
    assert.equal(row.remainingPct, null); assert.equal(row.monthlyLimit, 0);
    assert.equal(row.used.errors, row.keyless === "ip" ? 1 : 0);
  }
});
test('Exa API access does not invent a monthly request allowance', () => {
  const meta = ADAPTERS.find(a => a.meta.id === 'exa')!.meta;
  assert.equal(meta.monthlyFree, 0); assert.equal(meta.quota?.limit, undefined);
});

test('Existing enabled entries without required keys are disabled, configured engines are preserved', () => {
  const d = { ...defaults, requiredKeyIds: ADAPTERS.filter(a => a.meta.keyless === 'no').map(a => a.meta.id) };
  const cfg = normalizeConfig({ engines: [{ id:'tavily', enabled:true }, { id:'parallel', enabled:true, apiKey:'valid-key' }, { id:'google-cse', enabled:true, apiKey:'  ' }] }, d);
  assert.equal(cfg.engines.find(e => e.id === 'tavily')!.enabled, true);
  assert.equal(cfg.engines.find(e => e.id === 'google-cse')!.enabled, false);
  assert.equal(cfg.engines.find(e => e.id === 'parallel')!.enabled, true);
});

test('DuckDuckGo is opt-in and an explicit enabled setting is preserved', () => {
  assert.equal(DEFAULT_ENABLED.duckduckgo, false);
  assert.equal(normalizeConfig({engines:[{id:'duckduckgo',enabled:true}]},defaults).engines.find(e=>e.id==='duckduckgo')!.enabled,true);
});

test('Keyless search-only providers are skipped during fetch and expose only available capabilities', async t => {
 const {SearchRouter} = await import('../src/router.js');
 const dir=mkdtempSync(join(tmpdir(),'sr-fetch-policy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const cfg=normalizeConfig(null,defaults);cfg.fetchOrder=['tavily','parallel','jina'];
 let forbidden=0;
 const adapters=ADAPTERS.filter(a=>['tavily','parallel','jina'].includes(a.meta.id)).map(a=>({...a,fetchUrl:async()=>{if(a.meta.id!=='jina'){forbidden++;throw Error('key required');}return 'Page content';}}));
 const usage=new UsageStore(dir);
 const router=new SearchRouter({getConfig:()=>cfg,usage,adapters});
 assert.equal((await router.fetchUrl({url:'https://example.com'})).engine,'jina');assert.equal(forbidden,0);
 const status=await buildStatus(cfg,usage,adapters);
 for(const id of ['tavily','parallel'])assert.deepEqual(status.find(r=>r.id===id)!.capabilities,['search']);
});
