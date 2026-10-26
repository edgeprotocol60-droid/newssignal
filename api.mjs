// Cloudflare Pages "advanced mode" worker: serves index.html AND the /api/* helpers. No keys needed.
//   /api/news      merged headlines from many RSS feeds (parsed here, so the browser never touches RSS)
//   /api/calendar  ForexFactory weekly calendar: every red-folder (High) event + key USD data
//   /api/yahoo     DXY + FX pairs (EURUSD, GBPUSD, USDJPY, AUDUSD) from Yahoo Finance
//   /api/cot       CFTC Commitments of Traders for gold, Nasdaq, USD index and currencies
//   /api/hl        fallback proxy for Hyperliquid prices (gold + Nasdaq are fetched directly by the browser)
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
  ['FXStreet', 'https://www.fxstreet.com/rss/news'],
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
    out.push({ title, src, ts: isNaN(ts) ? Date.now() : ts, link: dec(l || '') });
  }
  return out.slice(0, 12);
}
const KEEP = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];
const KEY = /ppi|producer price|pce|ism |retail sales|gdp|powell|fomc|federal funds|fed chair|adp|jolts|jobless|unemployment claims|non-farm|nonfarm|cpi/i;
const YS = ['DX-Y.NYB', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X'];
const HL_TYPES = ['candleSnapshot', 'allMids', 'metaAndAssetCtxs'];
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
  if (path === '/hl' && req.method === 'POST') {   // fallback proxy for Hyperliquid prices
    const b = await req.json();
    if (!HL_TYPES.includes(b.type)) return { status: 400, body: 'bad type', ttl: 0 };
    const r = await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.text(), ttl: 0 };
  }
  let body, ttl = 20;
  {
      if (path === '/news') {
        const res = await Promise.allSettled(FEEDS.map(async ([name, url]) => {
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsSignal)' }, signal: AbortSignal.timeout(7000) });
          if (!r.ok) throw new Error(name + ' ' + r.status);
          return parseFeed(await r.text(), name);
        }));
        const items = res.filter(x => x.status === 'fulfilled').flatMap(x => x.value).sort((a, b) => b.ts - a.ts).slice(0, 120);
        body = JSON.stringify({ ok: res.filter(x => x.status === 'fulfilled').length, total: FEEDS.length, failed: res.filter(x => x.status === 'rejected').map(x => String(x.reason).slice(0, 60)), items });
        if (!items.length) throw new Error('all news feeds failed: ' + res.map(x => x.reason).join('; ').slice(0, 200));
      } else if (path === '/calendar') {
        const all = (await Promise.all(['thisweek', 'nextweek'].map(async f => {
          const r = await fetch(`https://nfs.faireconomy.media/ff_calendar_${f}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          return r.ok ? r.json() : [];
        }))).flat();
        if (!all.length) throw new Error('calendar feed empty');
        const seen = new Set();
        body = JSON.stringify(all.filter(e => { const k = e.country + e.title + e.date; if (seen.has(k)) return false; seen.add(k); return true; }).filter(e => KEEP.includes(e.country) && (e.impact === 'High' || (e.country === 'USD' && e.impact === 'Medium' && KEY.test(e.title))))
          .map(e => ({ title: e.title, country: e.country, date: e.date, impact: e.impact, forecast: e.forecast, previous: e.previous })));
        ttl = 60;
      } else if (path === '/yahoo') {
        const sym = u.searchParams.get('sym'), range = u.searchParams.get('range') || '1d', interval = u.searchParams.get('interval') || '5m';
        if (!YS.includes(sym) || !['1d', '5d', '1mo', '6mo'].includes(range) || !['1m', '5m', '15m', '60m', '1d'].includes(interval)) return { status: 400, body: 'bad request', ttl: 0 };
        let r0, err;
        for (const h of ['query1', 'query2']) {
          try {
            const r = await fetch(`https://${h}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!r.ok) throw new Error('Yahoo ' + r.status);
            r0 = (await r.json())?.chart?.result?.[0]; if (r0?.timestamp) break;
          } catch (e) { err = e; }
        }
        if (!r0?.timestamp) throw err || new Error('No Yahoo data');
        const q = r0.indicators.quote[0], m = r0.meta;
        const series = r0.timestamp.map((t, i) => ({ t: t * 1000, o: q.open[i] ?? q.close[i], h: q.high[i] ?? q.close[i], l: q.low[i] ?? q.close[i], c: q.close[i] })).filter(s => s.c != null);
        body = JSON.stringify({ price: m.regularMarketPrice ?? series[series.length - 1].c, prevClose: m.chartPreviousClose ?? m.previousClose ?? series[0].c, open: m.regularMarketOpen ?? series[0].o,
          high: m.regularMarketDayHigh ?? Math.max(...series.map(s => s.h)), low: m.regularMarketDayLow ?? Math.min(...series.map(s => s.l)), volume: m.regularMarketVolume || 0, series });
        ttl = interval === '1m' ? 4 : 20;
      } else if (path === '/cot') {
        const out = {};
        await Promise.all(Object.entries(COT).map(async ([sym, c]) => {
          const r = await fetch(`https://publicreporting.cftc.gov/resource/${c.ds}.json?cftc_contract_market_code=${c.code}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=156`);
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
  catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
  return new Response(r.body, { status: r.status, headers: {
    'Content-Type': 'application/json',
    'Cache-Control': r.ttl ? 'public, max-age=0, must-revalidate' : 'no-store',
    'Netlify-CDN-Cache-Control': r.ttl ? `public, s-maxage=${r.ttl}, stale-while-revalidate=30` : 'no-store',
  } });
};
export const config = { path: '/api/*' };
