import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../static/app.js", import.meta.url), "utf8");
function harness(savedLanguage: string | null = null) {
  const listeners = new Map<string, Function[]>();
  const output = { innerHTML: "" };
  const view = { innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
  const context = vm.createContext({
    URLSearchParams, Intl, URL, Map, Set, Promise, console,
    window: { I18N: { de: {}, en: {} } }, navigator: { language: "de" },
    localStorage: { getItem: (key: string) => key === "sr_lang" ? savedLanguage : null, setItem() {}, removeItem() {} },
    location: { search: "", pathname: "/", hash: "", origin: "http://localhost" }, history: { replaceState() {} },
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, CSS: { escape: (s: string) => s },
    document: {
      querySelector: (s: string) => s === "#view" ? view : s.includes("data-testout") ? output : view,
      querySelectorAll: () => [],
      addEventListener: (name: string, fn: Function) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
      createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }),
    },
  });
  vm.runInContext(readFileSync(new URL("../static/i18n.js", import.meta.url), "utf8"), context);
  vm.runInContext(source.slice(0, source.indexOf('/* ---------- Sprach-Dropdown')), context);
  vm.runInContext('render = () => {}; refreshStatus = async () => {}; toast = () => {};', context);
  const run = (s: string) => vm.runInContext(s, context);
  run('state.config = {engines:[{id:"a",enabled:true},{id:"b",enabled:true}],fetchOrder:[],settings:{port:6277}}; state.route = "/engines";');
  return { context, run, listeners, view, output };
}

test("Drag während laufendem PUT behält neue Reihenfolge und vorherige Änderung", async () => {
  const h = harness();
  let release!: Function;
  const sent: any[] = [];
  h.context.api = async (_: string, opts: any) => {
    sent.push(structuredClone(opts.body));
    if (sent.length === 1) return await new Promise(r => { release = r; });
    return { config: opts.body };
  };
  h.run('queuePut(cfg => ({...cfg,engines:cfg.engines.map(e=>({...e,enabled:e.id==="a"?false:e.enabled}))}))');
  await new Promise(r => setImmediate(r));
  h.run('state.dragFrom = "b"');
  for (const handler of h.listeners.get("drop")!) handler({ target: { closest: () => ({ dataset: { id: "a" } }) }, preventDefault() {} });
  release({ config: sent[0] });
  await h.run("putChain");
  assert.deepEqual(sent[1].engines.map((e: any) => e.id), ["b", "a"]);
  assert.equal(sent[1].engines.find((e: any) => e.id === "a").enabled, false);
});

test("Delegierte Drag-Handler werden durch erneutes Rendern nicht vervielfacht", () => {
  const h = harness();
  h.run('state.status=[]; renderEngines(); renderEngines(); renderEngines()');
  assert.equal(h.listeners.get("drop")?.length, 1);
  assert.equal(h.listeners.get("dragstart")?.length, 1);
});

test("Ungespeicherte Key- und Extra-Eingaben bleiben beim Engine-Render erhalten", () => {
  const h = harness();
  let inputs = [{ value: "new-key", dataset: { id: "a" } }, { value: "cx-draft", dataset: { id: "a", extra: "cx" } }];
  Object.defineProperty(h.view, "innerHTML", {set() { inputs = inputs.map(i => ({...i, value: ""})); }, get() { return ""; }});
  h.view.querySelectorAll = ((selector: string) => selector === ".keyinput" ? [inputs[0]] : selector === ".extrainput" ? [inputs[1]] : []) as any;
  h.run('renderEngines()');
  assert.deepEqual(inputs.map(i => i.value), ["new-key", "cx-draft"]);
});

test("Fetch-only Engine-Test verwendet Fetch und zeigt Zeichenzahl", async () => {
  const h = harness();
  const sent: any[] = [];
  h.run('state.status = [{id:"jina",capabilities:["fetch"]}]');
  h.context.api = async (_: string, opts: any) => { sent.push(opts.body); return {ok:true,chars:456,ms:9}; };
  h.context.t = (key: string, vars: any) => key + JSON.stringify(vars ?? {});
  const host = {dataset:{id:"jina"}};
  const btn = {dataset:{act:"test",kind:"fetch"},closest:()=>host};
  const target = {closest:(selector:string)=>selector === "button[data-act]" ? btn : null};
  for (const handler of h.listeners.get("click")!) await handler({target});
  assert.equal(sent[0].kind, "fetch");
  assert.match(h.output.innerHTML, /456/);
  assert.doesNotMatch(h.output.innerHTML, /undefined/);
});

test("Kontingent zeigt Tagesfenster und IP-Limit als unbekannt", () => {
  const h = harness();
  const daily = h.run('quotaHtml({id:"google-cse",quota:{period:"day",unit:"requests",limit:100,used:99,source:"local",estimated:false}})');
  assert.match(daily, /1 \/ 100 requests remaining/);
  assert.match(daily, /today \(provider timezone\)/);
  const ip = h.run('quotaHtml({id:"exa",monthlyLimit:1400,used:{search:10},quota:{period:"ip",unit:"requests",limit:null,used:null,source:"unknown",estimated:false}})');
  assert.match(ip, /Provider limit and total usage unknown/);
  assert.doesNotMatch(ip, /1400/);
});

test("Settings speichern Strict-Free und Gesamttimeout ohne andere Engine-Änderungen", async () => {
  const h = harness();
  const sent: any[] = [];
  h.context.api = async (_: string, opts: any) => {sent.push(structuredClone(opts.body)); return {config:opts.body};};
  h.context.document.querySelector = (selector: string) => selector === "#strict-free" ? {checked:true} : selector === "#request-timeout" ? {value:"45000",checkValidity:()=>true} : selector === "#result-count-mode" ? {value:"custom"} : selector === "#result-count" ? {value:"12",checkValidity:()=>true} : h.view;
  const button = {};
  for (const handler of h.listeners.get("click")!) await handler({target:{closest:(selector:string)=>selector === '[data-act="save-settings"]' ? button : null}});
  await h.run("putChain");
  assert.equal(sent[0]?.settings.strictFreeMode, true);
  assert.equal(sent[0]?.settings.requestTimeoutMs, 45000);
  assert.equal(sent[0]?.settings.defaultNumResults, 12);
  assert.deepEqual(sent[0].engines.map((e:any)=>e.id), ["a","b"]);
});

test('Unknown quotas show successful local calls and never a full bar or infinity', () => {
  const h = harness();
  h.run('state.status=[{id:"exa",label:"Exa",enabled:true,capabilities:["search"],searchPosition:0,used:{search:7,fetch:5},remainingPct:null,quota:{period:"ip",unit:"requests",source:"local",used:12,limit:null}}]');
  const quota = h.run('quotaHtml(state.status[0])');
  assert.match(quota, /12/); assert.match(quota, /calls · month/);
  assert.doesNotMatch(quota, /class="bar"|1400|∞/);
  assert.doesNotMatch(h.run('rotationHtml()'), /class="bar"/);
  assert.match(h.run('healthHtml()'), /12/);
});

test('Provider key badge reflects configured credentials and quota rings use canonical quota', () => {
  const h = harness();
  h.run('state.status=[{id:"firecrawl",label:"Firecrawl",enabled:true,hasKey:true,keyless:"ip",capabilities:[],quota:{limit:1000,used:179},used:{search:1,fetch:0}}]');
  h.run('renderEngines()');
  assert.doesNotMatch(h.view.innerHTML, /badge.keyless/);
  assert.equal(h.run('remainingPctOf({monthlyLimit:1400,quota:{limit:null,used:12}})'), null);
  assert.equal(h.run('remainingPctOf({monthlyLimit:3000,quota:{limit:100,used:50}})'), 50);
});

test('Only drag handles are draggable so native dragstart targets the handle', () => {
  const h = harness();
  h.run('state.status=[{id:"exa",label:"Exa",enabled:true,searchPosition:0}];renderEngines()');
  assert.match(h.view.innerHTML, /class="handle"[^>]*draggable="true"/);
  assert.doesNotMatch(h.view.innerHTML, /class="engine-card[^>]*draggable="true"/);
});

 test('Fresh installations use English regardless of browser language; saved preferences persist', () => {
  assert.equal(harness().run('lang'), 'en');
  assert.equal(harness('de').run('lang'), 'de');
  assert.equal(harness('unsupported').run('lang'), 'en');
});

test('Engine calls include failures and remain visible with or without an API key', () => {
  const h = harness();
  for (const hasKey of [true, false]) {
    h.context.hasKey = hasKey;
    h.run('state.status=[{id:"firecrawl",label:"Firecrawl",enabled:true,hasKey,capabilities:["search","fetch"],searchPosition:0,used:{search:40,fetch:52,errors:1},quota:hasKey?{limit:1000,used:368,unit:"credits",period:"month",source:"remote"}:{limit:null,used:92,unit:"requests",period:"ip",source:"local"}}]');
    for (const markup of [h.run('quotaHtml(state.status[0])'), h.run('rotationHtml()'), h.run('healthHtml()')]) {
      assert.match(markup, /93 calls · month/);
      assert.match(markup, /Searches: 40 · Fetches: 52 · Errors: 1/);
      if (hasKey) assert.match(markup, /632 \/ 1,000 credits remaining/);
      else assert.match(markup, /Provider limit and total usage unknown/);
    }
  }
});

test('Exhausted quota has an empty bar; missing quota is never shown as full or healthy', () => {
  const h = harness();
  const exhausted = h.run('quotaHtml({id:"firecrawl",quota:{limit:1000,used:1001,unit:"credits",source:"remote"}})');
  assert.match(exhausted, /width:0%/);
  assert.match(exhausted, /0 \/ 1,000 credits remaining/);
  assert.equal(h.run('remainingPctOf({quota:{limit:1000}})'), null);
  assert.equal(h.run('remainingPctOf({remoteError:"timeout"})'), null);
  const failed = h.run('quotaHtml({id:"firecrawl",remoteError:"timeout",quota:{limit:1000,used:2,unit:"credits",source:"local",period:"month"}})');
  assert.match(failed, /Provider quota unavailable/);
  assert.match(failed, /998 \/ 1,000/);
});

test('Activity bins cover exactly 48 hours and count tool calls separately from fallback attempts', () => {
  const h = harness();
  h.context.now = Date.parse('2026-09-06T12:00:00Z');
  h.context.entries = [
    {ts: new Date(h.context.now).toISOString(),kind:'search',ok:true,attempts:[{engine:'firecrawl',ok:false},{engine:'exa',ok:true}]},
    {ts: new Date(h.context.now - 2 * 3600000).toISOString(),kind:'fetch',ok:false,attempts:[{engine:'firecrawl',ok:false}]},
    {ts: new Date(h.context.now - 48 * 3600000 + 1).toISOString(),kind:'search',ok:true,engine:'tavily'},
    ...[48,60,96].map(hours=>({ts:new Date(h.context.now-hours*3600000).toISOString(),kind:'search',ok:true})),
    {ts: new Date(h.context.now + 1).toISOString(),kind:'search',ok:true},
    {ts:'invalid',kind:'search',ok:true},
  ];
  const bins = h.run('activityBuckets(entries, now)');
  assert.equal(bins.length, 24);
  assert.equal(bins.reduce((n: number,b: any)=>n+b.total,0),3);
  assert.equal(bins[23].total,1);
  assert.equal(bins[23].attempts,2);
  assert.equal(bins[23].engines.firecrawl,1);
  assert.equal(bins[22].errors,1);
  assert.equal(bins[0].search,1);
  assert.equal(bins[0].start,h.context.now-48*3600000);
});

test('Activity exposes keyboard/touch details and discloses the history sample limit', () => {
  const h = harness();
  const html = h.run('sparkline([{ts:new Date().toISOString(),kind:"search",ok:true,attempts:[{engine:"firecrawl",ok:false},{engine:"exa",ok:true}]}])');
  assert.equal((html.match(/class="activity-bucket"/g) || []).length,24);
  assert.match(html,/aria-label="[^"]*Tool calls: 1/);
  assert.match(html,/2 engine attempts incl. fallbacks: firecrawl: 1 · exa: 1/);
  assert.match(html,/max\. 200/);
});

test('Empty history has no error rate; successful fallback is not a failed tool call', () => {
  const h = harness();
  assert.equal(h.run('statValues().errRate'),'–');
  h.run('state.history=[{ok:true,ms:0,attempts:[{engine:"firecrawl",ok:false},{engine:"exa",ok:true}]}]');
  assert.equal(h.run('statValues().errRate'),'0%');
  assert.equal(h.run('statValues().avg'),'0 ms');
  h.run('state.filters.engine="firecrawl"');
  assert.equal(h.run('filteredHistory().length'),1);
});

test('Status refresh detects call counts even when the quota percentage stays unknown', () => {
  const h = harness();
  const start = source.indexOf('function statusSig()');
  h.run(source.slice(start, source.indexOf('setInterval(', start)));
  h.run('state.meta={month:"2026-09"}; state.status=[{id:"exa",remainingPct:null,used:{search:1,fetch:0,errors:0},quota:{limit:null}}]');
  const before = h.run('statusSig()');
  h.run('state.status[0].used.search++');
  assert.notEqual(h.run('statusSig()'), before);
  const after = h.run('statusSig()');
  h.run('state.meta.month="2026-10"');
  assert.notEqual(h.run('statusSig()'), after);
});
