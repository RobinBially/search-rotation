import { test } from "node:test";
import assert from "node:assert/strict";
import { EXA } from "../src/engines/exa.js";
import { TAVILY } from "../src/engines/tavily.js";
import { FIRECRAWL } from "../src/engines/firecrawl.js";

function pending(signal: AbortSignal | undefined | null): Promise<Response> {
  return new Promise((_, reject) => {
    const guard = setTimeout(() => reject(new Error("mock guard expired")), 100);
    const abort = () => { clearTimeout(guard); reject(signal?.reason); };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

for (const adapter of [TAVILY, FIRECRAWL]) {
  test(`${adapter.meta.id} remoteQuota bricht laufenden HTTP-Aufruf mit ctx.signal ab`, async (t) => {
    let seen: AbortSignal | undefined | null;
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {seen = init.signal; return pending(seen);});
    const controller = new AbortController();
    const operation = adapter.remoteQuota!({apiKey:"test-key",signal:controller.signal});
    controller.abort(new Error("quota cancelled"));
    await assert.rejects(operation, /quota cancelled/);
    assert.equal(seen?.aborted, true);
  });
}

for (const stage of ["initialize", "tools/call"]) {
  for (const kind of ["search", "fetch"] as const) {
    test(`Exa keyless ${kind}: Abbruch während ${stage} beendet den Transport-Request`, async (t) => {
      const controller = new AbortController();
      let heldSignal: AbortSignal | undefined | null;
      let announce!: () => void;
      const started = new Promise<void>(r => {announce = r;});
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        if (init.method === "GET") return new Response("", {status:405});
        const rpc = JSON.parse(String(init.body));
        if (rpc.method === stage) {
          heldSignal = init.signal;
          announce();
          return pending(heldSignal);
        }
        if (rpc.method === "initialize") return new Response(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result:{protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"fake",version:"1"}}}), {headers:{"content-type":"application/json"}});
        return new Response(null, {status:202});
      });
      const operation = kind === "search"
        ? EXA.search!({query:"test"},{signal:controller.signal})
        : EXA.fetchUrl!({url:"https://example.com"},{signal:controller.signal});
      const rejection = assert.rejects(operation, /request cancelled/i);
      await started;
      controller.abort(new Error("request cancelled"));
      await rejection;
      assert.equal(heldSignal?.aborted, true);
    });
  }
}

test("Exa keyless initialisiert bei bereits abgebrochenem Context keine Verbindung", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network request"); });
  await assert.rejects(EXA.search!({query:"test"}, {signal:AbortSignal.abort(new Error("already cancelled"))}), /already cancelled/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("Exa keyless begrenzt auch ohne Router-Signal die Verbindungsphase", async (t) => {
  const deadline = new AbortController();
  const timeouts: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {timeouts.push(ms); return deadline.signal;});
  let start!: () => void;
  const started = new Promise<void>(r => {start = r;});
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    start();
    return pending(init.signal);
  });
  const operation = EXA.search!({query:"test"}, {});
  const rejected = assert.rejects(operation, /connection deadline/);
  await started;
  deadline.abort(new Error("connection deadline"));
  await rejected;
  assert.ok(timeouts.includes(30_000));
});
