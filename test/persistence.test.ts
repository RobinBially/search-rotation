import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { UsageStore } from '../src/usage.js';
import { HistoryStore } from '../src/history.js';

const temporary = (t: any) => { const dir=mkdtempSync(join(tmpdir(),'sr-persistence-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); return dir; };
async function workers(dir: string, source: string, count=4) {
  const children=Array.from({length:count},()=>fork('--eval',[source],{execArgv:['--import','tsx','--input-type=module'],env:{...process.env,REVIEW_DIR:dir},stdio:['ignore','ignore','pipe','ipc']}));
  const ready=children.map(c=>new Promise<void>((resolve,reject)=>{ c.once('message',()=>resolve());c.once('error',reject); }));
  const exits=children.map(c=>new Promise<void>((resolve,reject)=>{let error=''; c.stderr!.on('data',d=>error+=d);c.once('exit',code=>code===0?resolve():reject(new Error(error)));}));
  await Promise.all(ready);children.forEach(c=>c.send('go'));await Promise.all(exits);
}
test('usage readers observe other writers and UTC daily consumption preserves legacy JSON', t=>{
  const dir=temporary(t); const reader=new UsageStore(dir); const writer=new UsageStore(dir);
  writeFileSync(join(dir,'usage.json'),JSON.stringify({[writer.monthKey()]:{a:{search:3,fetch:2,errors:0}}}));
  writer.record('a','search',undefined,2.5);
  assert.equal(reader.get('a').search,4);assert.equal(reader.get('a').consumed,7.5);
  assert.equal(reader.getDay('a').consumed,2.5);assert.equal(reader.getDay('a').search,1);
  assert.equal(reader.dayKey(new Date('2026-04-01T00:30:00+02:00')),'2026-03-31');
});
test('four real processes preserve every usage increment and history entry',async t=>{
  const dir=temporary(t);
  await workers(dir,`import {UsageStore} from './src/usage.ts';import {HistoryStore} from './src/history.ts';const u=new UsageStore(process.env.REVIEW_DIR);const h=new HistoryStore(process.env.REVIEW_DIR+'/history.json');process.send('ready');process.once('message',()=>{for(let i=0;i<100;i++){u.record('a','search');h.record({kind:'search',input:process.pid+':'+i,engine:'a',ok:true,ms:0,attempts:[]});}process.exit(0);});`);
  const usage=new UsageStore(dir);assert.equal(usage.get('a').search,400);assert.equal(usage.getDay('a').search,400);
  const history=JSON.parse(readFileSync(join(dir,'history.json'),'utf8'));assert.equal(history.length,400);assert.equal(new Set(history.map((r:any)=>r.input)).size,400);
});
test('dead lock owner is recovered without a time-based live-owner eviction',t=>{
  const dir=temporary(t);const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))']);const pid=Number(dead.stdout.toString());
  const contender=join(dir,'usage.json.lock',`${pid}-dead`);mkdirSync(contender,{recursive:true});writeFileSync(join(contender,'ticket'),'1');
  const u=new UsageStore(dir);u.record('a','search');assert.equal(u.get('a').search,1);
  assert.equal(existsSync(contender),false);
});
test('history clear serializes with a writer already inside its transaction',async t=>{
  const dir=temporary(t);const file=join(dir,'history.json');const h=new HistoryStore(file);h.record({kind:'search',input:'old',engine:'a',ok:true,ms:0,attempts:[]});
  const child=fork('--eval',[`import fs from 'node:fs';import {withFileLock,atomicWriteFile} from './src/persistence.ts';withFileLock(process.env.REVIEW_DIR+'/history.json',()=>{process.send('locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);atomicWriteFile(process.env.REVIEW_DIR+'/history.json',JSON.stringify([{ts:new Date().toISOString(),input:'in-flight'}]));});process.exit(0);`],{execArgv:['--import','tsx','--input-type=module'],env:{...process.env,REVIEW_DIR:dir},stdio:['ignore','ignore','inherit','ipc']});
  const exit=new Promise(resolve=>child.once('exit',resolve));await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',()=>reject(new Error('child exited before lock acquired')));});h.clear();await exit;assert.deepEqual(h.list(),[]);
});

test('a live lock owner times out without eviction; failed acquisition cleans its contender',async t=>{
  const {withFileLock}=await import('../src/persistence.js');
  const dir=temporary(t);const file=join(dir,'data.json');const live=join(`${file}.lock`,`${process.pid}-live`);
  mkdirSync(live,{recursive:true});writeFileSync(join(live,'ticket'),'1');
  assert.throws(()=>withFileLock(file,()=>assert.fail('must not enter'),25),/lock timeout/);
  assert.equal(existsSync(live),true);
  assert.deepEqual((await import('node:fs')).readdirSync(`${file}.lock`),[`${process.pid}-live`]);
});
test('provider day uses Pacific DST boundaries; pruning preserves monthly and recent daily records',t=>{
  const dir=temporary(t);const u=new UsageStore(dir);
  assert.equal(u.dayKey(new Date('2026-07-01T06:59:59Z'),'America/Los_Angeles'),'2026-06-30');
  assert.equal(u.dayKey(new Date('2026-07-01T07:00:00Z'),'America/Los_Angeles'),'2026-07-01');
  assert.equal(u.dayKey(new Date('2026-01-01T07:59:59Z'),'America/Los_Angeles'),'2025-12-31');
  writeFileSync(join(dir,'usage.json'),JSON.stringify({'2020-01':{a:{search:2,fetch:0,errors:0}},'2020-01-01':{a:{search:2,fetch:0,errors:0}}}));
  u.record('a','fetch',undefined,0.2,'America/Los_Angeles');
  assert.equal(u.getDay('a','America/Los_Angeles').consumed,0.2);
  const raw=JSON.parse(readFileSync(join(dir,'usage.json'),'utf8'));assert.ok(raw['2020-01']);assert.equal(raw['2020-01-01'],undefined);
});

test('transient read failures never replace existing usage or history snapshots', t => {
  const dir = temporary(t);
  const u = new UsageStore(dir);
  const h = new HistoryStore(join(dir, 'history.json'));
  u.record('a', 'search');
  h.record({ kind: 'search', input: 'preserved', engine: 'a', ok: true, ms: 0, attempts: [] });
  const usageBefore = readFileSync(join(dir, 'usage.json'), 'utf8');
  const historyBefore = readFileSync(join(dir, 'history.json'), 'utf8');
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(file: any, ...args: any[]) {
    if (file === join(dir, 'usage.json') || file === join(dir, 'history.json')) {
      throw Object.assign(new Error('transient read failure'), { code: 'EIO' });
    }
    return (original as any).call(fs, file, ...args);
  });
  assert.throws(() => u.record('a', 'search'), /transient read failure/);
  h.record({ kind: 'search', input: 'must not replace', engine: 'a', ok: true, ms: 0, attempts: [] });
  t.mock.restoreAll();
  assert.equal(readFileSync(join(dir, 'usage.json'), 'utf8'), usageBefore);
  assert.equal(readFileSync(join(dir, 'history.json'), 'utf8'), historyBefore);
  u.record('a', 'search');
  assert.equal(u.get('a').search, 2);
});

test('SIGKILL inside a transaction preserves the prior snapshot and releases stale ownership', { skip: process.platform === 'win32', timeout: 10_000 }, async t => {
  const dir = temporary(t);
  const usage = new UsageStore(dir);
  usage.record('a', 'search');
  const before = readFileSync(join(dir, 'usage.json'), 'utf8');
  const child = fork('--eval', [
    `import {withFileLock} from './src/persistence.ts';
     withFileLock(process.env.REVIEW_DIR+'/usage.json',()=>{
       process.send('locked');
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30_000);
       throw new Error('parent should kill this process');
     });`
  ], { execArgv: ['--import', 'tsx', '--input-type=module'], env: { ...process.env, REVIEW_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = new Promise<string | null>(resolve => child.once('exit', (_code, signal) => resolve(signal)));
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve());
    child.once('error', reject);
    child.once('exit', () => reject(new Error('child exited before acquiring lock')));
  });
  child.kill('SIGKILL');
  assert.equal(await exited, 'SIGKILL');
  assert.equal(readFileSync(join(dir, 'usage.json'), 'utf8'), before);
  usage.record('a', 'search');
  assert.equal(usage.get('a').search, 2);
  assert.deepEqual(fs.readdirSync(join(dir, 'usage.json.lock')), []);
});
