import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TAVILY} from '../src/engines/tavily.js';
import {PARALLEL} from '../src/engines/parallel.js';

test('Tavily anonymous search sends keyless header, own client name and normalizes results',async t=>{
 t.mock.method(globalThis,'fetch',async (url:any,init:any)=>{
  assert.equal(String(url),'https://api.tavily.com/search');
  const h=new Headers(init.headers);assert.equal(h.get('X-Tavily-Access-Mode'),'keyless');assert.equal(h.get('Authorization'),null);assert.equal(h.get('X-Client-Name'),'search-rotation');
  const b=JSON.parse(init.body);assert.equal(b.search_depth,'basic');assert.equal(b.max_results,3);
  return Response.json({results:[{title:'Example',url:'https://example.com',content:'Snippet'}]});
 });
 assert.equal((await TAVILY.search!({query:'q',numResults:3},{})).items[0].snippet,'Snippet');
});
for(const a of [TAVILY,PARALLEL])test(`${a.meta.id} with key continues to use direct API`,async t=>{
 t.mock.method(globalThis,'fetch',async (url:any,init:any)=>{
  assert.match(String(url),a===TAVILY?/api.tavily.com\/search/:/api.parallel.ai\/v1\/search/);
  const h=new Headers(init.headers);assert.equal(h.get('X-Tavily-Access-Mode'),null);assert.equal(h.get(a===TAVILY?'authorization':'x-api-key'),a===TAVILY?'Bearer fixture-key':'fixture-key');
  return Response.json({results:[{title:'Example',url:'https://example.com',content:'Snippet',excerpts:['Snippet']}]});
 });
 assert.equal((await a.search!({query:'q'},{apiKey:'fixture-key'})).items.length,1);
});
for(const fail of [false,true])test(`Parallel keyless MCP ${fail?'propagates tool errors':'normalizes structured results and respects count'}`,async t=>{
 t.mock.method(globalThis,'fetch',async (url:any,init:any)=>{
  assert.equal(String(url),'https://search.parallel.ai/mcp');assert.equal(new Headers(init.headers).get('authorization'),null);
  if(init.method==='GET')return new Response(null,{status:405});
  const b=JSON.parse(init.body);
  if(b.method==='initialize')return Response.json({jsonrpc:'2.0',id:b.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}});
  if(b.method==='tools/call'){
   assert.equal(b.params.name,'web_search');assert.deepEqual(b.params.arguments,{objective:'q',search_queries:['q']});
   return Response.json({jsonrpc:'2.0',id:b.id,result:fail?{isError:true,content:[{type:'text',text:'rate limit reached'}]}:{content:[],structuredContent:{results:[{title:'Example',url:'https://example.com',excerpts:['One','Two'],publish_date:'2026-09-05'},{url:'https://other.example',excerpts:[]}]}}});
  }
  return new Response(null,{status:202});
 });
 if(fail)await assert.rejects(PARALLEL.search!({query:'q'},{}),/rate limit reached/);
 else {const r=await PARALLEL.search!({query:'q',numResults:1},{});assert.equal(r.items.length,1);assert.equal(r.items[0].snippet,'One … Two');assert.equal(r.items[0].published,'2026-09-05');}
});
