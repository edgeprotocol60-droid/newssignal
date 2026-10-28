const G = q => `https://news.google.com/rss/search?q=${q}+when:1d&hl=en-US&gl=US&ceid=US:en`;
const FEEDS = [
  ['Google · Red folder', G('(NFP+OR+CPI+OR+PPI+OR+FOMC+OR+payrolls+OR+PCE+OR+jobless+claims)')],
  ['Google · Gold', G('gold+price')], ['Google · Nasdaq', G('nasdaq+OR+stock+market')],
  ['Google · Dollar', G('dollar+index+OR+DXY+OR+Treasury+yields')], ['Google · Fed', G('Federal+Reserve+OR+Powell')],
  ['Google · AUD', G('Australian+dollar+OR+RBA+OR+China+economy')], ['Google · FX', G('EURUSD+OR+GBPUSD+OR+USDJPY+OR+forex')],
  ['BBC Business', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
  ['CNBC Markets', 'https://www.cnbc.com/id/10000664/device/rss/rss.html'],
  ['CNBC Economy', 'https://www.cnbc.com/id/20910258/device/rss/rss.html'],
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'],
  ['Federal Reserve', 'https://www.federalreserve.gov/feeds/press_all.xml'],
  ['ECB', 'https://www.ecb.europa.eu/rss/press.html'],
];
const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
function parseFeed(xml, name) {
  const out = [], re = /<(item|entry)[\s>][\s\S]*?<\/\1>/g; let m;
  while ((m = re.exec(xml))) {
    const b = m[0], t = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]; if (!t) continue;
    const d = (b.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\//) || [])[1];
    const l = (b.match(/<link[^>]*>([^<]+)<\/link>/) || b.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    const ts = Date.parse(dec(d || '')); let title = dec(t), src = name; const g = title.match(/^(.*) - ([^-]{2,40})$/);
    if (name.startsWith('Google') && g) { title = g[1]; src = g[2]; }
    out.push({ title, src, ts: isNaN(ts) ? 0 : ts, link: dec(l || '') });
  }
  return out.slice(0, 12);
}
const KEEP = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];
const KEY = /ppi|producer price|pce|ism |retail sales|gdp|powell|fomc|federal funds|fed chair|adp|jolts|jobless|unemployment claims|non-farm|nonfarm|cpi/i;
const YS = ['DX-Y.NYB', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'];
const HL_TYPES = ['candleSnapshot', 'allMids', 'metaAndAssetCtxs', 'fundingHistory', 'l2Book'];
const TFF = [/^lev_money_positions_long(_all)?$/i, /^lev_money_positions_short(_all)?$/i, /^asset_mgr_positions_long(_all)?$/i, /^asset_mgr_positions_short(_all)?$/i];
const tff = (title, code, inv) => ({ title, ds: 'gpe5-46if', code, group: 'Leveraged Funds', group2: 'Asset Managers', f: TFF, inv });
const COT = {
  XAUUSD: { title: 'Gold · COMEX', ds: '72hh-3qpy', code: '088691', group: 'Managed Money', group2: 'Producer/Merchant',
    f: [/^m_money_positions_long(_all)?$/i, /^m_money_positions_short(_all)?$/i, /^prod_merc_positions_long(_all)?$/i, /^prod_merc_positions_short(_all)?$/i] },
  NAS100: tff('Nasdaq-100 E-mini · CME', '209742'), DXY: tff('US Dollar Index · ICE', '098662'),
  EURUSD: tff('Euro FX · CME', '099741'), GBPUSD: tff('British Pound · CME', '096742'),
  USDJPY: tff('Japanese Yen · CME (inverse of USDJPY)', '097741', true), AUDUSD: tff('Australian Dollar · CME', '232741'),
};
const num = (r, re) => { const k = Object.keys(r).find(k => re.test(k)); return k ? +r[k] : NaN; };
async function api(path, u, req) {
  if(req.method!=='GET'&&!(path==='/hl'&&req.method==='POST'))return {status:405,body:'{"error":"Method not allowed"}',ttl:0};
  const extra = await analysisRoutes(path, u, req);
  if (extra) return extra;
  if (path === '/hl' && req.method === 'POST') {   // fallback proxy for Hyperliquid prices
    let b;try{b=await req.json();}catch{return {status:400,body:'{"error":"Invalid JSON"}',ttl:0};}
    if (!validHL(b)) return { status: 400, body: 'bad type', ttl: 0 };
    const r = await fetch('https://api.hyperliquid.xyz/info', { signal: AbortSignal.timeout(5000), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.text(), ttl: 0 };
  }
  let body, ttl = 20;
  {
      if (path === '/news' || path === '/health') {
        const data = await collectNews(path === '/health');
        body = JSON.stringify(data); ttl = 25;
      } else if (path === '/calendar') {
        const all = (await Promise.all(['thisweek', 'nextweek'].map(async f => {
          const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${f}.json`, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
          return r.ok ? r.json() : [];
        }))).flat();
        if (!all.length) throw new Error('calendar feed empty');
        const seen = new Set();
        body = JSON.stringify(all.filter(e => { const k = e.country + e.title + e.date; if (seen.has(k)) return false; seen.add(k); return true; }).filter(e => KEEP.includes(e.country) && (e.impact === 'High' || (e.country === 'USD' && e.impact === 'Medium' && KEY.test(e.title))))
          .map(e => ({ title: e.title, country: e.country, date: e.date, impact: e.impact, forecast: e.forecast, previous: e.previous })));
        ttl = 60;
      } else if (path === '/yahoo') {
        const sym = u.searchParams.get('sym'), range = u.searchParams.get('range') || '1d', interval = u.searchParams.get('interval') || '5m';
        if (!YS.includes(sym) || !['1d', '5d', '1mo', '6mo', '2y'].includes(range) || !['1m', '5m', '15m', '60m', '1d'].includes(interval)) return { status: 400, body: 'bad request', ttl: 0 };
        body = JSON.stringify(await marketQuote(sym, range, interval));
        ttl = 30;
      } else if (path === '/cot') {
        const out = {};
        await Promise.allSettled(Object.entries(COT).map(async ([sym, c]) => {
          const r = await fetch(`https://publicreporting.cftc.gov/resource/${c.ds}.json?cftc_contract_market_code=${c.code}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=156`, {signal: AbortSignal.timeout(5000)});
          if (!r.ok) throw new Error(`CFTC ${sym} HTTP ${r.status}`);
          const rows = await r.json();
          if (!rows.length) throw new Error(`CFTC ${sym}: no rows for code ${c.code}`);
          const mapped = rows.map(x => ({ d: String(x.report_date_as_yyyy_mm_dd).slice(0, 10), l: num(x, c.f[0]), s: num(x, c.f[1]), l2: num(x, c.f[2]), s2: num(x, c.f[3]), oi: num(x, /^open_interest_all$/i) }));
          if (mapped.some(x => [x.l, x.s, x.l2, x.s2, x.oi].some(Number.isNaN))) throw new Error(`CFTC ${sym}: unexpected fields: ` + Object.keys(rows[0]).slice(0, 60).join(','));
          out[sym] = { title: c.title, group: c.group, group2: c.group2, inv: !!c.inv, rows: mapped };
        }));
        body = JSON.stringify(out); ttl = 21600;
      } else return { status: 404, body: 'not found', ttl: 0 };
  }
  return { status: 200, body, ttl };
}

// Netlify Functions (v2) wrapper: served at /api/* (see `config.path` below).
export default async (req) => {
  const u = new URL(req.url);
  let r;
  try { r = await api(u.pathname.replace(/^\/(\.netlify\/functions\/api|api)/, ''), u, req); }
  catch (e) { return new Response(JSON.stringify({ error: 'Upstream request failed.' }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
  return new Response(r.body, { status: r.status, headers: {
    'Content-Type': 'application/json',
    'Cache-Control': r.ttl ? 'public, max-age=0, must-revalidate' : 'no-store',
    'Netlify-CDN-Cache-Control': r.ttl ? `public, s-maxage=${r.ttl}, stale-while-revalidate=30` : 'no-store',
  } });
};
export const config = { path: '/api/*' };

function env(name) { return globalThis.Netlify?.env.get(name); }
function cleanItems(items) {
  const seen = new Set(), now = Date.now();
  return items.filter(x => x.title && Number.isFinite(x.ts) && x.ts <= now + 60000 && now - x.ts < 48 * 3600000)
    .sort((a,b) => b.ts-a.ts).filter(x => { const k = x.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu,''); if(seen.has(k)) return false; seen.add(k); return true; }).slice(0,150);
}
async function collectNews(full) {
  const sources = FEEDS.map(([name,url]) => ({name,url,kind:'rss'}));
  if (env('ALPHA_VANTAGE_API_KEY')) sources.push({name:'Alpha Vantage',kind:'av',url:'https://www.alphavantage.co/query?function=NEWS_SENTIMENT&sort=LATEST&limit=50&apikey='+encodeURIComponent(env('ALPHA_VANTAGE_API_KEY'))});
  const results = sources.map(s => ({name:s.name,ok:false,status:null,ms:0,count:0,error:'pending'}));
  const items = [], controller = new AbortController();
  let firstUseful; const useful = new Promise(resolve => {firstUseful=resolve;});
  const tasks = sources.map(async (s,i) => {
    const start = Date.now(), d=results[i];
    try {
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
      const r=s.kind==='av'?null:await fetch(s.url,{headers:{'User-Agent':'NewsSignal/1.0'},signal});
      d.status=r?.status??null;
      if(r && !r.ok) throw new Error('HTTP '+r.status);
      let parsed;
      if(s.kind==='av') {
        const j=await optionalSentiment(s.url,signal); d.status=200; if(!Array.isArray(j.feed)||!j.feed.length) throw new Error('Provider limit or empty feed');
        parsed=j.feed.map(x=>({title:x.title,src:x.source||s.name,link:x.url,ts:Date.parse(x.time_published.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z')),sentiment:Number(x.overall_sentiment_score),tickers:x.ticker_sentiment}));
      } else { parsed=parseFeed(await r.text(),s.name); if(!parsed.length) throw new Error('No parseable dated entries'); }
      d.ok=true;d.error=null;d.count=cleanItems(parsed).length; items.push(...parsed);
      if(d.count) firstUseful();
    } catch(e) {d.error=e.name==='TimeoutError'?'5 second timeout':e.name==='AbortError'?'partial response deadline':String(e.message).slice(0,100);}
    finally {d.ms=Date.now()-start;}
  });
  const all=Promise.all(tasks);
  if(full) await all;
  else await Promise.race([all,useful.then(()=>new Promise(r=>setTimeout(r,1200)))]);
  controller.abort(); await all;
  return {ok:results.filter(x=>x.ok).length,total:results.length,checkedAt:Date.now(),sources:results,failed:results.filter(x=>!x.ok),items:cleanItems(items)};
}
async function yahooChart(sym,range,interval,signal) {
  // Use Yahoo's alternate yen ticker in the fallback chain.
  const ticker=sym==='USDJPY=X'?'JPY=X':sym;
  return Promise.any(['query1','query2'].map(async host=>{
    const r=await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`,{signal,headers:{'User-Agent':'Mozilla/5.0'}});
    if(!r.ok) throw new Error('Yahoo HTTP '+r.status);
    const d=(await r.json()).chart?.result?.[0]; if(!d?.timestamp?.length) throw new Error('Empty Yahoo chart');
    const q=d.indicators.quote[0],m=d.meta;
    const series=d.timestamp.map((t,i)=>({t:t*1000,o:q.open[i]??q.close[i],h:q.high[i]??q.close[i],l:q.low[i]??q.close[i],c:q.close[i],v:Number.isFinite(q.volume?.[i])?q.volume[i]:null})).filter(x=>Number.isFinite(x.c)&&x.c>0);
    if(!series.length) throw new Error('No valid candles');
    return {price:m.regularMarketPrice??series.at(-1).c,prevClose:m.chartPreviousClose??m.previousClose??series[0].c,open:series[0].o,high:Math.max(...series.map(x=>x.h)),low:Math.min(...series.map(x=>x.l)),volume:m.regularMarketVolume||0,series,ts:(m.regularMarketTime*1000)||series.at(-1).t,source:'Yahoo Finance · delayed/indicative',delayed:true};
  }));
}
async function marketQuote(sym,range,interval) {
  const signal=AbortSignal.timeout(3800);
  try { return await yahooChart(sym,range,interval,signal); } catch (_) {}
  if(sym==='DX-Y.NYB') {
    try {return await calculatedDxy(range,interval);} catch(_) {}
  }
  // Provider is optional. Time series, rather than a synthetic quote, preserves signal integrity.
  const key=env('TWELVE_DATA_API_KEY');
  if(key&&sym!=='DX-Y.NYB') {
    try {
      const pair=sym.replace('=X','').replace(/^(...)(...)$/,'$1/$2');
      const iv={'1m':'1min','5m':'5min','15m':'15min','60m':'1h','1d':'1day'}[interval];
      const r=await fetch(`https://api.twelvedata.com/time_series?symbol=${pair}&interval=${iv}&outputsize=180&timezone=UTC&apikey=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(1500)});
      const j=await r.json();if(!r.ok||!j.values?.length) throw new Error('Unavailable');
      const series=j.values.map(x=>({t:Date.parse(x.datetime.replace(' ','T')+'Z'),o:+x.open,h:+x.high,l:+x.low,c:+x.close})).reverse();
      return {price:series.at(-1).c,prevClose:series[0].c,open:series[0].o,high:Math.max(...series.map(x=>x.h)),low:Math.min(...series.map(x=>x.l)),volume:0,series,ts:series.at(-1).t,source:'Twelve Data · indicative',delayed:true};
    }catch(_){}
  }
  // Daily reference rates are explicit, never fabricated intraday candles.
  const r=await fetch('https://open.er-api.com/v6/latest/USD',{signal:AbortSignal.timeout(2000)});
  if(!r.ok) throw new Error('All quote providers unavailable');
  const j=await r.json(),v=j.rates;
  const price=sym==='DX-Y.NYB'?50.14348112*(1/v.EUR)**-.576*v.JPY**.136*(1/v.GBP)**-.119*v.CAD**.091*v.SEK**.042*v.CHF**.036:sym==='USDJPY=X'?v.JPY:1/v[sym.slice(0,3)];
  if(!(price>0)) throw new Error('Invalid reference rates');
  return {price,prevClose:price,open:price,high:price,low:price,volume:0,series:[],ts:j.time_last_update_unix*1000,source:sym==='DX-Y.NYB'?'DXY (calculated) · daily reference · ExchangeRate-API':'ExchangeRate-API · daily reference',delayed:true,reference:true};
}

async function optionalSentiment(url, signal) {
  // Cache success and provider-limit responses for two hours, across cold starts.
  // If durable caching is unavailable, skip this optional provider to protect its quota.
  const {getStore}=await import('@netlify/blobs');
  const store=getStore('newssignal-provider-cache');
  const bounded=p=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Provider cache timeout')),400);timer.unref?.();})]);
  const cached=await bounded(store.get('alpha-vantage',{type:'json'}));
  if(cached&&Date.now()-cached.at<2*3600000) return cached.data;
  // A cached placeholder also backs off after a timeout or a free-plan rate limit.
  await bounded(store.setJSON('alpha-vantage',{at:Date.now(),data:{feed:[]}}));
  const r=await fetch(url,{signal});
  if(!r.ok) throw new Error('HTTP '+r.status);
  const data=await r.json();
  await bounded(store.setJSON('alpha-vantage',{at:Date.now(),data}));
  return data;
}

async function calculatedDxy(range,interval) {
  const symbols=['EURUSD=X','USDJPY=X','GBPUSD=X','CAD=X','SEK=X','CHF=X'];
  const signal=AbortSignal.timeout(1700);
  const parts=await Promise.all(symbols.map(sym=>yahooChart(sym,range,interval,signal)));
  const formula=v=>50.14348112*v[0]**-.576*v[1]**.136*v[2]**-.119*v[3]**.091*v[4]**.042*v[5]**.036;
  const maps=parts.map(x=>new Map(x.series.map(p=>[p.t,p.c])));
  // Only aligned real closes form a calculated close series. No invented OHLC range.
  const series=parts[0].series.filter(p=>maps.every(m=>m.has(p.t))).map(p=>{const c=formula(maps.map(m=>m.get(p.t)));return {t:p.t,o:c,h:c,l:c,c};});
  const price=formula(parts.map(x=>x.price));
  if(!(price>0)) throw new Error('Invalid DXY basket');
  return {price,prevClose:formula(parts.map(x=>x.prevClose)),open:series[0]?.c??price,high:Math.max(price,...series.map(x=>x.c)),low:Math.min(price,...series.map(x=>x.c)),volume:0,series,ts:Math.min(...parts.map(x=>x.ts)),source:'DXY (calculated) · Yahoo six-pair basket · close-only',delayed:true,calculated:true,reference:!series.length};
}

function validHL(b) {
  if(!b||!HL_TYPES.includes(b.type))return false;
  if(b.type==='metaAndAssetCtxs')return b.dex==='xyz'&&Object.keys(b).every(k=>['type','dex'].includes(k));
  if(b.type==='allMids')return (b.dex===undefined||b.dex==='xyz')&&Object.keys(b).every(k=>['type','dex'].includes(k));
  if(!Object.keys(b).every(k=>(b.type==='candleSnapshot'?['type','req']:['type','coin','startTime','endTime']).includes(k)))return false;
  const r=b.type==='candleSnapshot'?b.req:b;
  if(b.type==='candleSnapshot'&&r&&!Object.keys(r).every(k=>['coin','interval','startTime','endTime'].includes(k)))return false;
  if(!r||!['xyz:GOLD','xyz:XYZ100'].includes(r.coin))return false;
  if(b.type==='l2Book')return Object.keys(b).every(k=>['type','coin'].includes(k));
  return Number.isFinite(r.startTime)&&r.startTime>=Date.now()-2000*864e5&&r.startTime<=Date.now()&&
    (r.endTime===undefined||(Number.isFinite(r.endTime)&&r.endTime>=r.startTime&&r.endTime<=Date.now()+6e4))&&
    (b.type!=='candleSnapshot'||['1m','5m','15m','1h','4h','1d','1w'].includes(r.interval));
}
function driverSymbols(){return {'TNX':'^TNX','FVX':'^FVX','VIX':'^VIX','SPX':'^GSPC','WTI':'CL=F','COPPER':'HG=F','USDCNH':'CNH=X','USDZAR':'ZAR=X','DXY':'DX-Y.NYB'};}
async function fredSeries(id,signal){
  const r=await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id,{signal});if(!r.ok)throw new Error('FRED HTTP '+r.status);
  const series=(await r.text()).trim().split('\n').slice(1).map(l=>{const [d,c]=l.trim().split(',');return {t:Date.parse(d+'T00:00:00Z'),c:c&&c!=='.'?Number(c):NaN};}).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.c)).slice(-500);
  if(!series.length)throw new Error('FRED empty');return {series,price:series.at(-1).c,prevClose:series.at(-2)?.c,ts:series.at(-1).t,source:'FRED · daily observation',delayed:true};
}
async function analysisRoutes(path,u,req){
  if(!['/drivers','/fred','/market','/flow','/source-health'].includes(path))return null;
  if(req.method!=='GET')return {status:405,body:'{"error":"GET required"}',ttl:0};
  const symbols=driverSymbols(),ids=['DFII10','T10YIE','T10Y2Y'];
  if(path==='/fred'){
    const id=u.searchParams.get('id');if(!ids.includes(id))return {status:400,body:'{"error":"Unknown series"}',ttl:0};
    return {status:200,body:JSON.stringify(await fredSeries(id,AbortSignal.timeout(5000))),ttl:3600};
  }
  if(path==='/market'){
    const sym=u.searchParams.get('sym');if(!Object.values(symbols).includes(sym)&&!YS.includes(sym))return {status:400,body:'{"error":"Unknown market"}',ttl:0};
    const interval=u.searchParams.get('interval')||'1d',range=u.searchParams.get('range')||'6mo';
    if(!['15m','60m','1d','1wk'].includes(interval)||!['5d','1mo','6mo','2y','5y'].includes(range))return {status:400,body:'{"error":"Invalid interval or range"}',ttl:0};
    return {status:200,body:JSON.stringify(await yahooChart(sym,range,interval,AbortSignal.timeout(5000))),ttl:interval==='1d'||interval==='1wk'?1800:60};
  }
  if(path==='/flow'){
    const coin=u.searchParams.get('coin');if(!['xyz:GOLD','xyz:XYZ100'].includes(coin))return {status:400,body:'{"error":"Unknown coin"}',ttl:0};
    const tasks=[['context',{type:'metaAndAssetCtxs',dex:'xyz'}],['funding',{type:'fundingHistory',coin,startTime:Date.now()-864e5,endTime:Date.now()}]];
    const out={checkedAt:Date.now(),source:'Hyperliquid REST · xyz HIP-3',sources:[]};
    await Promise.allSettled(tasks.map(async([name,body])=>{const start=Date.now();try{const r=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(name==='context'){const i=j[0]?.universe?.findIndex(x=>x.name===coin||'xyz:'+x.name===coin);out.context=i>=0?j[1][i]:null;}else out.funding=j;out.sources.push({name,ok:true,ms:Date.now()-start});}catch(e){out.sources.push({name,ok:false,ms:Date.now()-start,error:'Source unavailable'});}}));
    return {status:200,body:JSON.stringify(out),ttl:60};
  }
  const out={checkedAt:Date.now(),data:{},sources:[]};
  const jobs=[...Object.entries(symbols).map(([name,sym])=>[name,signal=>yahooChart(sym,'6mo','1d',signal)]),...ids.map(id=>[id,signal=>fredSeries(id,signal)])];
  if(path==='/source-health')jobs.push(['Hyperliquid',async signal=>{const r=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs',dex:'xyz'}),signal});if(!r.ok)throw new Error('HTTP '+r.status);await r.json();return {source:'Hyperliquid · xyz'};}]);
  await Promise.allSettled(jobs.map(async([name,fn])=>{const at=Date.now();try{out.data[name]=await fn(AbortSignal.timeout(5000));out.sources.push({name,ok:true,ms:Date.now()-at});}catch(e){out.sources.push({name,ok:false,ms:Date.now()-at,error:'Upstream unavailable or timed out'});}}));
  return {status:200,body:JSON.stringify(out),ttl:300};
}
