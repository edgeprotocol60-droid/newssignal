import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/api.mjs';
const originalFetch=globalThis.fetch;
const xml=(title,ts=Date.now())=>`<rss><channel><item><title><![CDATA[${title}]]></title><pubDate>${new Date(ts).toUTCString()}</pubDate><link>https://example.com/article</link></item></channel></rss>`;
const invoke=path=>handler(new Request('https://example.com/api/'+path));
test('health reports HTTP and parser failures; news deduplicates and removes old items',async()=>{
  globalThis.fetch=async url=>String(url).includes('ecb.europa')?new Response('blocked',{status:403}):String(url).includes('federalreserve')?new Response('<html>not RSS</html>'):new Response(xml('Fed hawkish &amp; yields rise')+xml('Old release',Date.now()-49*3600000));
  try {
    const r=await invoke('health'),j=await r.json();
    assert.equal(r.status,200);assert.equal(j.total,13);assert.equal(j.ok,11);assert.equal(j.items.length,1);assert.equal(j.items[0].title,'Fed hawkish & yields rise');
    assert.equal(j.sources.find(x=>x.name==='ECB').status,403);assert.equal(j.sources.find(x=>x.name==='Federal Reserve').ok,false);
    assert.ok(j.sources.every(x=>Number.isFinite(x.ms)));assert.match(r.headers.get('netlify-cdn-cache-control'),/s-maxage=25/);
  }finally{globalThis.fetch=originalFetch;}
});
test('partial results return before stalled feeds and record their cancellation',async()=>{
  globalThis.fetch=async(url,{signal})=>String(url).includes('bbci')?new Response(xml('Gold rises')):new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  try {const at=Date.now();const j=await(await invoke('news')).json();assert.ok(Date.now()-at<2500);assert.equal(j.items.length,1);assert.equal(j.ok,1);assert.equal(j.failed.length,12);}finally{globalThis.fetch=originalFetch;}
});
test('a total news outage returns usable diagnostics, not a 502',async()=>{
  globalThis.fetch=async()=>{throw new Error('Network unavailable');};
  try{const r=await invoke('news'),j=await r.json();assert.equal(r.status,200);assert.equal(j.items.length,0);assert.equal(j.failed.length,13);}finally{globalThis.fetch=originalFetch;}
});
test('Yahoo outage returns labelled daily DXY and yen without synthetic candles',async()=>{
  const rates={EUR:.9,JPY:150,GBP:.8,CAD:1.4,SEK:10,CHF:.9};
  globalThis.fetch=async url=>String(url).includes('open.er-api')?Response.json({rates,time_last_update_unix:1700000000}):new Response('Unavailable',{status:503});
  try{
    const d=await(await invoke('yahoo?sym=DX-Y.NYB')).json();
    const expected=50.14348112*(1/rates.EUR)**-.576*rates.JPY**.136*(1/rates.GBP)**-.119*rates.CAD**.091*rates.SEK**.042*rates.CHF**.036;
    assert.equal(d.price,expected);assert.equal(d.ts,1700000000000);assert.match(d.source,/calculated.*daily reference/);assert.deepEqual(d.series,[]);
    const yen=await(await invoke('yahoo?sym=USDJPY%3DX')).json();assert.equal(yen.price,150);assert.equal(yen.reference,true);
  }finally{globalThis.fetch=originalFetch;}
});
test('invalid symbols never trigger upstream requests',async()=>{
  globalThis.fetch=()=>{throw new Error('Unexpected fetch');};
  try{assert.equal((await invoke('yahoo?sym=invalid')).status,400);}finally{globalThis.fetch=originalFetch;}
});
test('a missing DXY chart calculates the six live FX legs with the oldest quote timestamp',async()=>{
  const prices={'EURUSD=X':1.1,'JPY=X':150,'GBPUSD=X':1.25,'CAD=X':1.4,'SEK=X':10,'CHF=X':.9};
  globalThis.fetch=async url=>{
    const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if(symbol==='DX-Y.NYB') return new Response('Unavailable',{status:503});
    const c=prices[symbol];assert.ok(c);
    return Response.json({chart:{result:[{timestamp:[1700000000,1700000060],meta:{regularMarketPrice:c,regularMarketTime:symbol==='JPY=X'?1700000000:1700000060,chartPreviousClose:c},indicators:{quote:[{open:[c,c],high:[c,c],low:[c,c],close:[c,c]}]}}]}});
  };
  try{const r=await invoke('yahoo?sym=DX-Y.NYB'),j=await r.json();assert.equal(r.status,200);assert.equal(j.calculated,true);assert.equal(j.ts,1700000000000);assert.equal(j.series.length,2);assert.match(j.source,/six-pair basket/);assert.ok(j.price>0);}finally{globalThis.fetch=originalFetch;}
});
test('analysis routes validate parameters before requesting upstreams',async()=>{
  globalThis.fetch=()=>{throw new Error('Unexpected fetch');};
  try{for(const p of ['market?sym=invalid','fred?id=INVALID','flow?coin=BTC'])assert.equal((await invoke(p)).status,400);
  const bad=await handler(new Request('https://example.com/api/hl',{method:'POST',body:JSON.stringify({type:'candleSnapshot',req:{coin:'BTC',interval:'1m',startTime:Date.now()-1000}})}));assert.equal(bad.status,400);
  }finally{globalThis.fetch=originalFetch;}
});
test('driver batch returns partial results and source latency',async()=>{
  globalThis.fetch=async url=>String(url).includes('fredgraph.csv')?new Response('DATE,VALUE\n2026-10-26,1.5\n2026-10-27,1.6'):new Response('blocked',{status:403});
  try{const r=await invoke('drivers'),j=await r.json();assert.equal(r.status,200);assert.equal(j.sources.length,12);assert.equal(j.sources.filter(x=>x.ok).length,3);assert.equal(j.data.DFII10.price,1.6);assert.ok(j.sources.every(x=>Number.isFinite(x.ms)));assert.match(r.headers.get('netlify-cdn-cache-control'),/s-maxage=300/);}finally{globalThis.fetch=originalFetch;}
});
test('HIP-3 context lookup uses xyz dex and named universe index',async()=>{
  globalThis.fetch=async (url,opt)=>{const b=JSON.parse(opt.body);if(b.type==='metaAndAssetCtxs'){assert.equal(b.dex,'xyz');return Response.json([{universe:[{name:'xyz:XYZ100'},{name:'xyz:GOLD'}]},[{markPx:'20000'},{markPx:'4000'}]]);}return Response.json([{fundingRate:'0.00001'}]);};
  try{const j=await(await invoke('flow?coin=xyz%3AGOLD')).json();assert.equal(j.context.markPx,'4000');assert.equal(j.funding.length,1);}finally{globalThis.fetch=originalFetch;}
});
