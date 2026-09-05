import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfig} from '../src/config.js';
import {ADAPTERS,KNOWN_IDS,SEARCH_ORDER,FETCH_ORDER,DEFAULT_ENABLED} from '../src/engines/index.js';
import {SearchRouter} from '../src/router.js';
import {UsageStore} from '../src/usage.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const defaults={knownIds:KNOWN_IDS,searchOrder:SEARCH_ORDER,fetchOrder:FETCH_ORDER,defaultEnabled:DEFAULT_ENABLED};
test('result default preserves 8, provider null and valid numeric settings',()=>{
 for(const [value,expected] of [[undefined,8],[null,null],[1,1],[20,20],[0,8],[21,8],[1.5,8],['10',8]] as const){
  assert.equal(normalizeConfig({settings:{defaultNumResults:value}},defaults).settings.defaultNumResults,expected);
 }
});
test('router resolves explicit count, dashboard default and provider omission across failover',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'sr-results-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const cfg=normalizeConfig(null,defaults);const seen:(number|undefined)[]=[];
 const adapters=['first','second'].map((id,i)=>({meta:{id,label:id,homepage:'',signupUrl:'',capabilities:['search'] as ['search'],keyless:'ip' as const,monthlyFree:0,quotaEndpoint:false},search:async(input:any)=>{seen.push(input.numResults);if(!i)throw Error('failover');return {items:[]};}}));
 cfg.engines=adapters.map(a=>({id:a.meta.id,enabled:true}));
 for(const [setting,explicit,expected] of [[8,undefined,8],[12,undefined,12],[null,undefined,undefined],[null,3,3],[12,3,3]] as const){
  cfg.settings.defaultNumResults=setting;
  const router=new SearchRouter({getConfig:()=>cfg,usage:new UsageStore(dir),adapters});
  seen.length=0;await router.search({query:'test',numResults:explicit});assert.deepEqual(seen,[expected,expected]);
 }
});
for(const id of ['tavily','firecrawl','parallel','exa','google-cse'])test(`${id}: provider default omits count on the wire`,async t=>{
 const a=ADAPTERS.find(a=>a.meta.id===id)!;
 t.mock.method(globalThis,'fetch',async(url:any,init:any)=>{
  if(id==='google-cse')assert.equal(new URL(url).searchParams.has('num'),false);
  else {const body=JSON.parse(init.body);for(const key of ['limit','max_results','numResults'])assert.equal(key in body,false);}
  return Response.json({results:[],data:{web:[]},items:[]});
 });
 await a.search!({query:'test'},{apiKey:'fixture',extra:{cx:'fixture'}});
});

test('Firecrawl estimates its documented provider default, including the 10-result credit boundary',()=>{
 const a=ADAPTERS.find(a=>a.meta.id==='firecrawl')!;
 assert.equal(a.estimateCost!('search',{query:'q'}),2);
 assert.equal(a.estimateCost!('search',{query:'q',numResults:10}),2);
 assert.equal(a.estimateCost!('search',{query:'q',numResults:11}),4);
});
test('Parallel hosted MCP provider default does not trim returned results to eight',async t=>{
 t.mock.method(globalThis,'fetch',async (_url:any,init:any)=>{
  if(init.method==='GET')return new Response(null,{status:405});
  const body=JSON.parse(init.body);
  if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}});
  if(body.method==='tools/call'){
   assert.deepEqual(body.params.arguments,{objective:'q',search_queries:['q']});
   return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[],structuredContent:{results:Array.from({length:12},(_,i)=>({url:'https://example.com/'+i}))}}});
  }
  return new Response(null,{status:202});
 });
 assert.equal((await ADAPTERS.find(a=>a.meta.id==='parallel')!.search!({query:'q'},{})).items.length,12);
});
