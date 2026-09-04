import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearRemoteQuotaCache, fetchRemoteQuotaCached, recordRemoteConsumption } from '../src/status.js';
import type { EngineAdapter, RemoteQuota } from '../src/types.js';

function fixture(t: any) {
  clearRemoteQuotaCache(); t.after(clearRemoteQuotaCache);
  const requests: { resolve: (q: RemoteQuota) => void; signal?: AbortSignal }[] = [];
  const adapter: EngineAdapter = {
    meta: { id:'quota-cache-test', label:'Test', homepage:'', signupUrl:'', keyless:'no', capabilities:['search'], monthlyFree:10, quotaEndpoint:true },
    remoteQuota: async ctx => new Promise((resolve, reject) => {
      requests.push({resolve,signal:ctx.signal});
      ctx.signal?.addEventListener('abort', () => reject(ctx.signal!.reason), {once:true});
    }),
  };
  return {adapter, requests, ctx:{apiKey:'dummy'}};
}
const flush = () => new Promise(r => setImmediate(r));

test('Gleichzeitige Cache-Misses teilen einen Snapshot und behalten währenddessen verbuchten Verbrauch', async t => {
  const {adapter, requests, ctx} = fixture(t);
  const a = fetchRemoteQuotaCached(adapter, ctx);
  const b = fetchRemoteQuotaCached(adapter, ctx);
  await flush();
  recordRemoteConsumption(adapter, ctx, 1);
  // Resolve every request so the regression cannot leave dangling promises.
  requests.forEach(r => r.resolve({limit:10,used:9}));
  const [ra, rb] = await Promise.all([a,b]);
  assert.equal(requests.length, 1);
  assert.equal(ra.quota?.used, 10);
  assert.equal(rb.quota?.used, 10);
  assert.equal((await fetchRemoteQuotaCached(adapter,ctx)).quota?.remaining, 0);
});

test('Cache-Clear verhindert Wiederbefüllung durch alten laufenden Snapshot', async t => {
  const {adapter, requests, ctx} = fixture(t);
  const old = fetchRemoteQuotaCached(adapter,ctx); await flush();
  clearRemoteQuotaCache();
  const fresh = fetchRemoteQuotaCached(adapter,ctx); await flush();
  requests[1].resolve({limit:10,used:4}); await fresh;
  requests[0].resolve({limit:10,used:1}); await old;
  assert.equal((await fetchRemoteQuotaCached(adapter,ctx)).quota?.used, 4);
});

test('Abbruch eines Wartenden beendet nicht die gemeinsame Abfrage für andere', async t => {
  const {adapter, requests, ctx} = fixture(t);
  const ac = new AbortController();
  const a = fetchRemoteQuotaCached(adapter,{...ctx,signal:ac.signal});
  const rejected = assert.rejects(a,/caller cancelled/);
  const b = fetchRemoteQuotaCached(adapter,ctx);
  await flush(); ac.abort(new Error('caller cancelled')); await rejected;
  assert.equal(requests[0].signal?.aborted, false);
  requests.forEach(r=>r.resolve({limit:10,used:2}));
  assert.equal((await b).quota?.used,2);
  assert.equal(requests.length,1);
});

test('Einziger abgebrochener Wartender bricht echten Upstream ab und vergiftet keinen Cache', async t => {
  const {adapter, requests, ctx} = fixture(t);
  const ac = new AbortController();
  const a = fetchRemoteQuotaCached(adapter,{...ctx,signal:ac.signal});
  const rejected = assert.rejects(a,/caller cancelled/);
  await flush(); ac.abort(new Error('caller cancelled')); await rejected;
  assert.equal(requests[0].signal?.aborted,true);
  const fresh=fetchRemoteQuotaCached(adapter,ctx); await flush();
  requests[1].resolve({limit:10,used:3});
  assert.equal((await fresh).quota?.used,3);
});

test('Gemeinsamer Upstream wird erst beim Abbruch des letzten Wartenden beendet', async t => {
  const {adapter, requests, ctx} = fixture(t);
  const a = new AbortController(), b = new AbortController();
  const first = fetchRemoteQuotaCached(adapter,{...ctx,signal:a.signal});
  const second = fetchRemoteQuotaCached(adapter,{...ctx,signal:b.signal});
  const firstRejected = assert.rejects(first,/first cancelled/);
  const secondRejected = assert.rejects(second,/second cancelled/);
  await flush();
  a.abort(new Error('first cancelled')); await firstRejected;
  assert.equal(requests[0].signal?.aborted,false);
  b.abort(new Error('second cancelled')); await secondRejected;
  assert.equal(requests[0].signal?.aborted,true);
  assert.equal(requests.length,1);
});
