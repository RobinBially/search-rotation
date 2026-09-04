import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { buildWebApp } from '../src/web/app.js';
import { GOOGLE_CSE } from '../src/engines/googlecse.js';
import { FIRECRAWL } from '../src/engines/firecrawl.js';
import { requestCost } from '../src/quota.js';

const defaults = { knownIds: [], searchOrder: [], fetchOrder: [], defaultEnabled: {} };
test('Neue Settings sind validiert und alte Config erhält kompatible Defaults', () => {
  const initial = normalizeConfig({}, defaults);
  assert.equal(initial.settings.strictFreeMode, false); assert.equal(initial.settings.requestTimeoutMs, 60000);
  const good = normalizeConfig({ settings: { strictFreeMode: true, requestTimeoutMs: 12000, dailyLimits: { a: 12, b: -1, c: 'x' } } }, defaults);
  assert.equal(good.settings.strictFreeMode, true); assert.equal(good.settings.requestTimeoutMs, 12000); assert.deepEqual(good.settings.dailyLimits, { a: 12 });
  assert.equal(normalizeConfig({ settings: { requestTimeoutMs: 0 } }, defaults).settings.requestTimeoutMs, 60000);
});
test('API liefert und speichert Gratis-Modus, Timeout und Kontingent-Overrides', async () => {
  let cfg = normalizeConfig({}, defaults);
  const app = buildWebApp({ getConfig: () => cfg, saveConfig: next => { cfg = next; }, adapters: [] } as any);
  const response = await app.request('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engines: [], settings: { strictFreeMode: true, requestTimeoutMs: 12000, dailyLimits: { a: 12 }, monthlyLimits: { b: 30 } } }) });
  assert.equal(response.status, 200);
  const data = await (await app.request('/api/config')).json();
  assert.equal(data.settings.strictFreeMode, true); assert.equal(data.settings.requestTimeoutMs, 12000);
  assert.deepEqual(data.settings.dailyLimits, { a: 12 }); assert.deepEqual(data.settings.monthlyLimits, { b: 30 });
});
test('Google-Quota modelliert 100 Anfragen pro Pacific-Tag', () => {
  assert.equal(GOOGLE_CSE.meta.quota?.period, 'day'); assert.equal(GOOGLE_CSE.meta.quota?.limit, 100);
  assert.equal(GOOGLE_CSE.meta.quota?.timeZone, 'America/Los_Angeles');
});
test('Firecrawl-Quota unterscheidet Credits von Aufrufen und Suchgröße', () => {
  assert.equal(FIRECRAWL.meta.quota?.unit, 'credits');
  assert.equal(requestCost(FIRECRAWL, 'search', { query: 'q', numResults: 20 }), 4);
  assert.equal(requestCost(FIRECRAWL, 'search', { query: 'q', numResults: 8 }), 2);
  assert.equal(requestCost(FIRECRAWL, 'fetch', { url: 'https://example.com' }), 1);
});
