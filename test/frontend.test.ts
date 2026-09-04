import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../static/app.js", import.meta.url), "utf8");
function harness() {
  const listeners = new Map<string, Function[]>();
  const output = { innerHTML: "" };
  const view = { innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
  const context = vm.createContext({
    URLSearchParams, Intl, URL, Map, Set, Promise, console,
    window: { I18N: { de: {} } }, navigator: { language: "de" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: "", pathname: "/", hash: "", origin: "http://localhost" }, history: { replaceState() {} },
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, CSS: { escape: (s: string) => s },
    document: {
      querySelector: (s: string) => s === "#view" ? view : s.includes("data-testout") ? output : view,
      querySelectorAll: () => [],
      addEventListener: (name: string, fn: Function) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
      createElement: () => ({ textContent: "", get innerHTML() { return this.textContent; } }),
    },
  });
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
  h.context.t = (key: string) => key;
  const daily = h.run('quotaHtml({id:"google-cse",quota:{period:"day",unit:"requests",limit:100,used:99,source:"local",estimated:false}})');
  assert.match(daily, /99/);
  assert.match(daily, /quota.period.day/);
  const ip = h.run('quotaHtml({id:"exa",monthlyLimit:1400,used:{search:10},quota:{period:"ip",unit:"requests",limit:null,used:null,source:"unknown",estimated:false}})');
  assert.match(ip, /quota.unknown/);
  assert.doesNotMatch(ip, /1400/);
});

test("Settings speichern Strict-Free und Gesamttimeout ohne andere Engine-Änderungen", async () => {
  const h = harness();
  const sent: any[] = [];
  h.context.api = async (_: string, opts: any) => {sent.push(structuredClone(opts.body)); return {config:opts.body};};
  h.context.document.querySelector = (selector: string) => selector === "#strict-free" ? {checked:true} : selector === "#request-timeout" ? {value:"45000",checkValidity:()=>true} : h.view;
  const button = {};
  for (const handler of h.listeners.get("click")!) await handler({target:{closest:(selector:string)=>selector === '[data-act="save-settings"]' ? button : null}});
  await h.run("putChain");
  assert.equal(sent[0]?.settings.strictFreeMode, true);
  assert.equal(sent[0]?.settings.requestTimeoutMs, 45000);
  assert.deepEqual(sent[0].engines.map((e:any)=>e.id), ["a","b"]);
});
