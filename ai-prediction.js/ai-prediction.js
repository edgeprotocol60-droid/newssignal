// ai-prediction.js — AI Prediction tab for NewsSignal.
// Add ONE line to index.html just before </body>:  <script src="ai-prediction.js"></script>
// Reads existing globals (state, ASSETS, callApi, newsFallback, calFallback, cotDirect). No API key needed.
(function () {
  const SYMS = ['NAS100', 'XAUUSD', 'AUDUSD'];
  const CUR = { NAS100: ['USD'], XAUUSD: ['USD'], AUDUSD: ['USD', 'AUD', 'CNY'] };
  const COT_SYM = { NAS100: 'NAS100', XAUUSD: 'XAUUSD', AUDUSD: 'AUDUSD' };
  const TOPIC = {
    XAUUSD: /gold|xau|bullion|safe.haven|dollar|yield|treasur|fed|fomc|inflation|cpi|pce|jobs|payroll|geopolit|war|tariff/i,
    NAS100: /nasdaq|tech|stocks|wall street|s&p|nvidia|apple|microsoft|ai\b|earnings|yield|fed|fomc|inflation|cpi|jobs|payroll|tariff/i,
    AUDUSD: /aussie|australia|rba|china|iron ore|commodit|risk|dollar|fed|fomc|inflation|cpi|jobs|payroll|tariff/i
  };
  const W = {
    XAUUSD: { up: ['safe haven', 'rate cut', 'dovish', 'weak dollar', 'dollar falls', 'dollar slips', 'yields fall', 'geopolit', 'war', 'tension', 'gold rises', 'gold jumps', 'gold surges', 'gold rallies', 'soft inflation', 'cooling inflation', 'weak jobs'],
              dn: ['hawkish', 'rate hike', 'strong dollar', 'dollar rises', 'dollar jumps', 'yields rise', 'yields jump', 'gold falls', 'gold slips', 'gold drops', 'ceasefire', 'strong jobs', 'hot inflation', 'inflation accelerates'] },
    NAS100: { up: ['rate cut', 'dovish', 'earnings beat', 'record high', 'rally', 'soft inflation', 'cooling inflation', 'yields fall', 'stocks rise', 'nasdaq rises', 'tech rally', 'trade deal'],
              dn: ['hawkish', 'rate hike', 'yields rise', 'yields jump', 'selloff', 'sell-off', 'tariff', 'recession', 'hot inflation', 'earnings miss', 'stocks fall', 'nasdaq falls', 'tech slump', 'inflation accelerates'] },
    AUDUSD: { up: ['rba hike', 'hawkish rba', 'china stimulus', 'iron ore rises', 'risk-on', 'weak dollar', 'dollar falls', 'dollar slips', 'rate cut', 'dovish fed', 'aussie rises', 'china growth'],
              dn: ['rba cut', 'dovish rba', 'china slowdown', 'iron ore falls', 'risk-off', 'strong dollar', 'dollar rises', 'dollar jumps', 'aussie falls', 'hawkish fed', 'tariff', 'china weak'] }
  };
  const S = { sel: 'XAUUSD', news: [], cal: [], cot: null, at: 0, busy: false, err: '' };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SAST = { timeZone: 'Africa/Johannesburg', hour12: false };
  const hm = t => new Date(t).toLocaleTimeString('en-ZA', { ...SAST, hour: '2-digit', minute: '2-digit' });
  const dhm = t => new Date(t).toLocaleString('en-US', { ...SAST, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const px = (sym, v) => (v == null || isNaN(v)) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: assetOf(sym).dp > 3 ? 4 : 2, maximumFractionDigits: assetOf(sym).dp > 3 ? 5 : 2 });

  // ---------- data ----------
  async function load() {
    if (S.busy) return; S.busy = true; S.err = ''; render();
    const [n, c, k] = await Promise.allSettled([
      callApi('/news').catch(() => newsFallback()),
      callApi('/calendar').catch(() => calFallback()),
      callApi('/cot').catch(() => cotDirect())
    ]);
    if (n.status === 'fulfilled') S.news = (n.value.items || n.value || []).filter(x => x.title && x.ts && Date.now() - x.ts < 48 * 36e5);
    if (c.status === 'fulfilled') S.cal = (Array.isArray(c.value) ? c.value : (c.value.events || c.value.items || [])).map(e => ({
      title: e.title || e.name, country: e.country || 'USD', when: e.when || Date.parse(e.date), imp: e.impact || (e.imp >= 4 ? 'High' : 'Medium'), fc: e.forecast || e.consensus, prev: e.previous || e.prev
    })).filter(e => e.title && Number.isFinite(e.when));
    if (k.status === 'fulfilled') S.cot = k.value.data || k.value;
    const bad = [n, c, k].filter(x => x.status === 'rejected').length;
    if (bad) S.err = bad + ' of 3 data sources unavailable. The read below uses what loaded.';
    S.at = Date.now(); S.busy = false; render();
  }

  // ---------- scoring ----------
  function techScore(sym) {
    const t = state.trends && state.trends[sym], q = state.quotes[sym];
    if (!t || !q) return null;
    const day = (q.price - q.prevClose) / q.prevClose * 100;
    const today = clamp(t.daily.score * 0.7 + clamp(day * 40, -60, 60) * 0.3, -100, 100);
    const swing = clamp(t.weekly.score * 0.6 + t.daily.score * 0.4, -100, 100);
    return { today, swing, t, q, day };
  }
  function newsScore(sym) {
    const w = W[sym], hits = []; let sum = 0;
    for (const it of S.news) {
      const age = (Date.now() - it.ts) / 36e5; if (age > 24) continue;
      const txt = it.title.toLowerCase(); if (!TOPIC[sym].test(txt)) continue;
      let v = 0; w.up.forEach(p => { if (txt.includes(p)) v += 1; }); w.dn.forEach(p => { if (txt.includes(p)) v -= 1; });
      const dec = Math.pow(0.5, age / 8); if (v) { sum += v * dec; hits.push({ it, v, age }); }
    }
    hits.sort((a, b) => Math.abs(b.v) / (1 + b.age) - Math.abs(a.v) / (1 + a.age));
    return { score: clamp(sum * 22, -100, 100), hits: hits.slice(0, 5), n: hits.length };
  }
  function cotScore(sym) {
    const e = S.cot && S.cot[COT_SYM[sym]]; if (!e || !e.rows || e.rows.length < 6) return null;
    const rows = e.rows, inv = e.inv ? -1 : 1;
    const net = rows.map(r => (r.l - r.s) * inv), now = net[0], ch1 = net[0] - net[1], ch4 = net[0] - net[4];
    const sorted = [...net].sort((a, b) => a - b), pct = sorted.findIndex(v => v >= now) / (sorted.length - 1) * 100;
    const oi = rows[0].oi || 1;
    const trend = clamp(ch4 / oi * 800, -100, 100), level = clamp((pct - 50) * 2, -100, 100);
    let score = trend * 0.6 + level * 0.4, note = '';
    if (pct > 92) { score *= 0.5; note = 'Positioning is crowded long, so the bullish case is fragile.'; }
    if (pct < 8) { score *= 0.5; note = 'Positioning is crowded short, so the bearish case is fragile.'; }
    return { score: clamp(score, -100, 100), now, ch1, ch4, pct, date: rows[0].d, group: e.group || 'Speculators', note };
  }
  function red(sym) {
    const cs = CUR[sym], now = Date.now();
    return S.cal.filter(e => e.imp === 'High' && cs.includes(e.country) && e.when > now - 3 * 36e5 && e.when < now + 7 * 864e5).sort((a, b) => a.when - b.when);
  }

  // ---------- session windows (shown in SAST) ----------
  function offMin(tz, d) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).find(x => x.type === 'timeZoneName').value;
    const m = p.match(/([+-])(\d+):?(\d+)?/); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + (+m[3] || 0)) : 0;
  }
  function at(tz, h, m) { // today's local clock time in tz -> UTC ms
    const d = new Date(), f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number);
    const guess = Date.UTC(f[0], f[1] - 1, f[2], h, m); return guess - offMin(tz, new Date(guess)) * 6e4;
  }
  function windows(sym) {
    const ny = (a, b, c, d) => [at('America/New_York', a, b), at('America/New_York', c, d)], ln = (a, b, c, d) => [at('Europe/London', a, b), at('Europe/London', c, d)];
    if (sym === 'NAS100') return [{ n: 'Best: after the US open settles', w: ny(10, 0, 11, 30) }, { n: 'Second chance: US afternoon trend', w: ny(14, 0, 15, 30) }, { n: 'Avoid: first 15 min of the cash open', w: ny(9, 30, 9, 45) }];
    if (sym === 'XAUUSD') return [{ n: 'Best: London and New York overlap', w: ln(13, 0, 16, 30) }, { n: 'Early: London open after the first sweep', w: ln(8, 20, 10, 0) }, { n: 'Avoid: thin Asian drift and the NY close', w: ny(16, 30, 18, 0) }];
    return [{ n: 'Best: London open', w: ln(8, 15, 10, 30) }, { n: 'Second: New York overlap', w: ny(8, 30, 11, 0) }, { n: 'Asia: only on AUD or China data', w: [at('Australia/Sydney', 9, 30), at('Australia/Sydney', 11, 0)] }];
  }

  // ---------- prediction ----------
  function predict(sym) {
    const t = techScore(sym), n = newsScore(sym), c = cotScore(sym);
    if (!t) return { wait: true };
    const nv = n.score, cv = c ? c.score : 0, cw = c ? 1 : 0;
    const today = clamp(t.today * 0.45 + nv * 0.35 + cv * 0.2 * cw + (c ? 0 : 0), -100, 100);
    const swing = clamp(t.swing * 0.5 + cv * 0.35 * cw + nv * 0.15 + (c ? 0 : t.swing * 0.35), -100, 100);
    const sgn = v => (v > 15 ? 1 : v < -15 ? -1 : 0), agree = [sgn(t.today), sgn(nv), c ? sgn(cv) : 0].filter(Boolean);
    const aligned = agree.length > 1 && agree.every(x => x === agree[0]), split = agree.includes(1) && agree.includes(-1);
    const conf = x => Math.round(clamp(Math.abs(x) * 0.8 + (aligned ? 15 : 0) - (split ? 20 : 0) + 20, 5, 92));
    return { t, n, c, today, swing, aligned, split, ctoday: conf(today), cswing: conf(swing), ev: red(sym) };
  }
  const lbl = v => v >= 35 ? ['Bullish', 'text-emerald-300', 'bg-emerald-500/15 border-emerald-500/40'] : v <= -35 ? ['Bearish', 'text-rose-300', 'bg-rose-500/15 border-rose-500/40'] : v >= 15 ? ['Lean bullish', 'text-teal-300', 'bg-teal-500/15 border-teal-500/40'] : v <= -15 ? ['Lean bearish', 'text-amber-300', 'bg-amber-500/15 border-amber-500/40'] : ['No edge', 'text-slate-300', 'bg-slate-500/15 border-slate-600/40'];

  function plan(sym, p) {
    const long = p.today > 0, q = p.t.q, tr = p.t.t.daily, f = tr.fast, s = tr.slow;
    const nxt = p.ev[0], soon = nxt && nxt.when - Date.now() < 90 * 6e4 && nxt.when > Date.now() - 30 * 6e4;
    const out = [];
    if (Math.abs(p.today) < 15) out.push('Mixed signals. Stand aside or trade small at the range edges until one side takes control.');
    else {
      out.push(long ? `Look to buy pullbacks. Zone: ${px(sym, f)} (20-day average) down toward ${px(sym, Math.max(q.low, s || q.low))}. Skip chasing breakouts above ${px(sym, q.high)}.`
                    : `Look to sell rallies. Zone: ${px(sym, f)} (20-day average) up toward ${px(sym, Math.min(q.high, s || q.high))}. Skip chasing breaks below ${px(sym, q.low)}.`);
      out.push(long ? `Invalidation: a 1h close below today's low ${px(sym, q.low)}. Take profit near ${px(sym, q.high)}, then the previous close ${px(sym, q.prevClose)} on a retest.`
                    : `Invalidation: a 1h close above today's high ${px(sym, q.high)}. Take profit near ${px(sym, q.low)}, then the previous close ${px(sym, q.prevClose)} on a retest.`);
      out.push('Confirmation to wait for: a 5m candle that closes back in the trade direction after the pullback, not the first touch of the level.');
    }
    if (soon) out.push(`Red-folder warning: ${nxt.title} (${nxt.country}) is at ${hm(nxt.when)} SAST. Stay flat from 15 min before. After the release, wait for the first 5m candle to close and trade the first pullback, not the spike.`);
    if (p.split) out.push('Technicals, news, and COT disagree. Cut size and demand cleaner confirmation.');
    return out;
  }

  // ---------- render ----------
  function bar(v) { const c = v >= 0 ? 'linear-gradient(to right,#34d399,#10b981)' : 'linear-gradient(to right,#fb7185,#f43f5e)'; return `<div class="relative h-2.5 rounded-full bg-slate-800 overflow-hidden"><div class="absolute inset-y-0 left-1/2 w-px bg-slate-600"></div><div class="absolute inset-y-0 left-1/2 rounded-full" style="width:${Math.abs(v) / 2}%;background:${c};transform:${v < 0 ? 'translateX(-100%)' : 'none'}"></div></div>`; }
  function leanCard(title, sub, v, conf) {
    const [t, c, b] = lbl(v);
    return `<div class="rounded-xl bg-slate-950/60 border border-slate-800 p-4"><div class="flex items-center justify-between"><div><div class="text-[13px] font-bold text-white">${title}</div><div class="text-[10px] text-slate-500">${sub}</div></div><span class="text-[12px] font-bold px-2 py-1 rounded-md border ${b} ${c}">${t}</span></div><div class="mt-3">${bar(v)}<div class="flex justify-between text-[9px] text-slate-500 mt-1"><span>Bearish</span><span>Score ${Math.round(v)}</span><span>Bullish</span></div></div><div class="text-[11px] text-slate-400 mt-2">Confidence <b class="text-white tabular-nums">${conf}%</b></div></div>`;
  }
  function row(k, v, cls) { return `<div class="flex items-center justify-between text-[11px] py-1 border-b border-slate-800/60"><span class="text-slate-500">${k}</span><span class="font-semibold tabular-nums ${cls || 'text-slate-200'}">${v}</span></div>`; }
  const sc = v => v > 15 ? 'text-emerald-300' : v < -15 ? 'text-rose-300' : 'text-slate-300';

  function render() {
    const root = $('aiBody'); if (!root) return;
    const sel = S.sel, p = predict(sel);
    let h = `<div class="flex flex-wrap items-center gap-2"><div class="flex items-center gap-1 bg-slate-800/60 rounded-lg p-0.5">${SYMS.map(s => `<button data-ai="${s}" class="text-[12px] font-bold px-3 py-1.5 rounded-md ${s === sel ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-700'}">${s}</button>`).join('')}</div><span class="flex-1"></span><span class="text-[10px] text-slate-500">${S.busy ? 'Loading news, COT and calendar…' : S.at ? 'Updated ' + hm(S.at) + ' SAST' : ''}</span><button id="aiRefresh" class="text-[11px] font-semibold px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200">Refresh</button></div>`;
    if (S.err) h += `<div class="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">${esc(S.err)}</div>`;
    if (p.wait) { root.innerHTML = h + '<div class="text-[12px] text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl p-6">Waiting for price and trend data. Open the Dashboard for a few seconds, then return here.</div>'; return; }
    const nx = p.ev[0];
    h += `<div class="grid gap-4 md:grid-cols-2">${leanCard('Today: day trading', 'Technicals 45%, news 35%, COT 20%', p.today, p.ctoday)}${leanCard('Long term: swing trading', 'Weekly trend and COT lead, news is secondary', p.swing, p.cswing)}</div>`;
    h += `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div class="text-[13px] font-bold text-white pb-2">What to lean on today for ${sel}</div><ul class="space-y-2 text-[12px] text-slate-300 list-disc pl-4">${plan(sel, p).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    h += `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div class="text-[13px] font-bold text-white pb-2">Best time to enter (SAST)</div><div class="space-y-1.5">${windows(sel).map(x => { const live = Date.now() >= x.w[0] && Date.now() <= x.w[1]; return `<div class="flex items-center justify-between text-[12px] rounded-lg px-3 py-2 ${live ? 'bg-amber-500/10 border border-amber-500/40' : 'bg-slate-950/60 border border-slate-800'}"><span class="text-slate-300">${x.n}</span><span class="font-semibold tabular-nums ${live ? 'text-amber-300' : 'text-slate-400'}">${hm(x.w[0])}–${hm(x.w[1])}${live ? ' · now' : ''}</span></div>`; }).join('')}</div>${nx ? `<p class="text-[11px] text-slate-500 mt-2">Next red folder: ${esc(nx.title)} (${nx.country}) at ${dhm(nx.when)} SAST. Avoid entries from 15 min before until the first 5m candle closes after the release.</p>` : ''}</div>`;
    const t = p.t, c = p.c;
    h += `<div class="grid gap-4 md:grid-cols-3"><div class="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div class="text-[13px] font-bold text-white pb-1">Technical</div>${row('Price', px(sel, t.q.price))}${row('Today', (t.day >= 0 ? '+' : '') + t.day.toFixed(2) + '%', sc(t.day))}${row('Daily trend', t.t.daily.dir + ' (' + t.t.daily.score + ')', sc(t.t.daily.score))}${row('Weekly trend', t.t.weekly.dir + ' (' + t.t.weekly.score + ')', sc(t.t.weekly.score))}${row('20-day avg', px(sel, t.t.daily.fast))}${row('Day range', px(sel, t.q.low) + ' – ' + px(sel, t.q.high))}</div>`;
    h += `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div class="text-[13px] font-bold text-white pb-1">COT positioning</div>${c ? row(esc(c.group) + ' net', c.now.toLocaleString(), sc(c.now)) + row('Week change', (c.ch1 >= 0 ? '+' : '') + c.ch1.toLocaleString(), sc(c.ch1)) + row('4-week change', (c.ch4 >= 0 ? '+' : '') + c.ch4.toLocaleString(), sc(c.ch4)) + row('3-year percentile', Math.round(c.pct) + '%') + row('Report date', esc(c.date)) + (c.note ? `<p class="text-[10px] text-amber-300 mt-2">${esc(c.note)}</p>` : '') : '<p class="text-[11px] text-slate-500">COT data not loaded.</p>'}</div>`;
    h += `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div class="text-[13px] font-bold text-white pb-1">News pressure <span class="${sc(p.n.score)} tabular-nums">${Math.round(p.n.score)}</span></div>${p.n.hits.length ? p.n.hits.map(x => `<a href="${esc(x.it.link || '#')}" target="_blank" rel="noopener noreferrer" class="block text-[11px] py-1.5 border-b border-slate-800/60 text-slate-300 hover:text-white"><span class="${x.v > 0 ? 'text-emerald-400' : 'text-rose-400'}">${x.v > 0 ? '▲' : '▼'}</span> ${esc(x.it.title)}<span class="text-slate-600"> · ${esc(x.it.src || '')} · ${Math.round(x.age)}h</span></a>`).join('') : '<p class="text-[11px] text-slate-500">No directional headlines for this market in the last 24 hours.</p>'}</div></div>`;
    h += `<div class="bg-slate-900 border border-slate-800 rounded-2xl p-4"><div class="flex items-center justify-between pb-2"><span class="text-[13px] font-bold text-white">Red-folder news, next 7 days</span><span class="text-[9px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/40 rounded-full px-2 py-0.5">${CUR[sel].join(' · ')}</span></div>${p.ev.length ? p.ev.slice(0, 10).map(e => `<div class="flex items-center justify-between gap-3 text-[11px] py-1.5 border-b border-slate-800/60"><span class="text-slate-200">${esc(e.country)} ${esc(e.title)}</span><span class="text-slate-500 tabular-nums shrink-0">${e.fc ? 'F ' + esc(e.fc) + ' · ' : ''}${dhm(e.when)}</span></div>`).join('') : '<p class="text-[11px] text-slate-500">No high-impact events found for this market.</p>'}</div>`;
    h += '<p class="text-[10px] text-slate-600 leading-relaxed">This is a rules-based read of live technicals, headline keywords, COT positioning, and the economic calendar. It is a decision aid, not a prediction or financial advice. Test it on a demo account and size risk yourself.</p>';
    root.innerHTML = h;
  }

  // ---------- tab wiring ----------
  function init() {
    const cotTab = $('tabCot'), cotMain = $('cotMain'); if (!cotTab || !cotMain) return;
    cotTab.insertAdjacentHTML('afterend', '<button id="tabAI" class="text-[12px] font-bold px-3 py-1 rounded-md text-slate-400">AI Prediction</button>');
    cotMain.insertAdjacentHTML('afterend', '<main id="aiMain" class="hidden max-w-[1600px] mx-auto p-4"><div id="aiBody" class="space-y-4"></div></main>');
    const off = () => { $('aiMain').classList.add('hidden'); $('tabAI').className = 'text-[12px] font-bold px-3 py-1 rounded-md text-slate-400'; };
    $('tabDash').addEventListener('click', off); cotTab.addEventListener('click', off);
    $('tabAI').addEventListener('click', () => {
      $('dashMain').classList.add('hidden'); cotMain.classList.add('hidden'); $('aiMain').classList.remove('hidden');
      $('tabAI').className = 'text-[12px] font-bold px-3 py-1 rounded-md bg-amber-500 text-slate-950';
      if (!S.at || Date.now() - S.at > 3e5) load(); else render();
    });
    $('aiBody').addEventListener('click', e => {
      const b = e.target.closest('[data-ai]'); if (b) { S.sel = b.dataset.ai; render(); }
      if (e.target.id === 'aiRefresh') load();
    });
    setInterval(() => { if (!document.hidden && !$('aiMain').classList.contains('hidden')) { Date.now() - S.at > 3e5 ? load() : render(); } }, 30000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
