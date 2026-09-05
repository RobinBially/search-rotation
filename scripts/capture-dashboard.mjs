/** Reproducible light/dark screenshots of the dashboard and MCP tools with synthetic data.
 * npm install --no-save --package-lock=false playwright
 * npx playwright install chromium
 * npm run build && node scripts/capture-dashboard.mjs
 * No user configuration, API keys or provider endpoints are accessed.
 */
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { buildWebApp } from '../dist/web/app.js';
import { ADAPTERS, KNOWN_IDS, SEARCH_ORDER, FETCH_ORDER, DEFAULT_ENABLED } from '../dist/engines/index.js';
import { normalizeConfig } from '../dist/config.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const now = new Date('2026-09-05T10:30:00Z');
const counts = { tavily: [248, 21, 252.2], firecrawl: [186, 32, 404], parallel: [312, 16, 328], exa: [158, 8, 166], 'google-cse': [0, 0, 0], jina: [0, 67, 67], duckduckgo: [44, 0, 44] };
const config = normalizeConfig({}, { knownIds: KNOWN_IDS, searchOrder: SEARCH_ORDER, fetchOrder: FETCH_ORDER, defaultEnabled: DEFAULT_ENABLED });
for (const engine of config.engines) {
  // Deliberately nonfunctional fixture values, never used for outbound requests.
  if (['firecrawl'].includes(engine.id)) engine.apiKey = 'demo-not-a-real-api-key';
}
const rows = ADAPTERS.map(adapter => {
  const meta = adapter.meta, e = config.engines.find(e => e.id === meta.id);
  const [search, fetch, consumed] = counts[meta.id];
  const ip = meta.keyless === 'ip' && !e.apiKey;
  const remote = meta.id === 'firecrawl';
  const limit = !e.apiKey ? null : (meta.quota?.limit ?? meta.monthlyFree) || null;
  const used = !ip && meta.quota?.unit === 'credits' ? consumed : search + fetch;
  return { ...meta, enabled: e.enabled, hasKey: Boolean(e.apiKey), keyMasked: e.apiKey ? 'demo…only' : '', extrasSet: {},
    searchPosition: KNOWN_IDS.indexOf(meta.id), fetchPosition: FETCH_ORDER.indexOf(meta.id),
    monthlyLimit: ip ? 0 : meta.monthlyFree, used: {search, fetch, errors: 0, consumed},
    remote: remote ? {limit, used, remaining: limit - used} : null,
    remainingPct: limit === null ? null : (limit - used) / limit,
    quota: { period: ip ? 'ip' : meta.quota?.period ?? 'month', unit: ip ? 'requests' : meta.quota?.unit ?? 'requests', limit, used,
      source: remote ? 'remote' : 'local', estimated: false } };
});
const samples = [
  ['search', 'TypeScript 5.9 release notes', 'tavily', 846],
  ['fetch', 'https://modelcontextprotocol.io/docs', 'jina', 620],
  ['search', 'PostgreSQL connection pooling best practices', 'parallel', 1120],
  ['search', 'Node.js stream backpressure explained', 'exa', 735],
  ['fetch', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'firecrawl', 980],
  ['search', 'React server components documentation', 'tavily', 710],
];
const history = samples.map(([kind, input, engine, ms], i) => ({kind, input, engine, ms, ok: true, attempts: [{engine, ms, ok:true}], ts: new Date(now.getTime() - (i * 4 + 2) * 60000).toISOString(), result: kind === 'search' ? {count:8,items:[]} : {chars:8420}}));
const app = buildWebApp({configPath:'~/.config/search-rotation/config.json', getConfig:()=>config, saveConfig:()=>{},
  adapters:ADAPTERS, status:async()=>rows, month:()=> '2026-09', historyList:()=>history, historyClear:()=>{},
  testEngine:async()=>({ok:false,ms:0,error:'Screenshot fixture: provider calls disabled'})});
const server = serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});
await once(server,'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1440},deviceScaleFactor:1,locale:'en-US',colorScheme:'dark',reducedMotion:'reduce'});
  await page.clock.install({time:now});
  // Only the loopback fixture is reachable. Provider icons use the UI's normal fallback.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin, {waitUntil:'networkidle'});
  await page.locator('.recent-row').first().waitFor();
  if (await page.locator('html').getAttribute('lang') !== 'en') throw new Error('Screenshot must be in English');
  await page.locator('.logo-wrap img').evaluateAll(images => Promise.all(images.map(image => image.complete ? undefined : new Promise(resolve => {image.onload=resolve;image.onerror=resolve;}))));
  const output = name => fileURLToPath(new URL('../docs/assets/' + name, import.meta.url));
  const captures = [];
  for (const view of ['dashboard', 'mcp-tools']) {
    await page.goto(origin + (view === 'mcp-tools' ? '/#/tools' : '/'), {waitUntil:'networkidle'});
    await page.locator(view === 'mcp-tools' ? '.tool-card' : '.recent-row').first().waitFor();
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-btn').click();
      await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
      const content = await page.locator('.page').boundingBox();
      const overview = view === 'dashboard' ? await page.locator('.two-col').boundingBox() : null;
      const clip = overview
        ? {x:content.x-24,y:0,width:content.width+48,height:overview.y+overview.height+14}
        : {x:content.x-20,y:content.y-12,width:content.width+40,height:content.height+28};
      await page.screenshot({path:output(`${view}-${theme}.png`),clip,animations:'disabled'});
      captures.push({view,theme,width:clip.width,height:clip.height});
    }
  }
  for (const view of ['dashboard', 'mcp-tools']) {
    const [light,dark] = captures.filter(capture => capture.view === view);
    if (light.width !== dark.width || light.height !== dark.height) throw new Error(`Theme crop mismatch: ${view}`);
  }
  if(errors.length) throw new Error(errors.join('\n'));
  console.log('Captured four English light/dark screenshots with matching crops and demo data; no JavaScript errors.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
