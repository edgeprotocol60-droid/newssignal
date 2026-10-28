/* Institutional analysis extension. No synthetic observations or missing-data passes. */
"use strict";
const ANALYSIS_CONFIG = (window.ANALYSIS_CONFIG = {
  weights: {
    trend: 12,
    structure: 12,
    adx: 8,
    vwap: 10,
    room: 8,
    intermarket: 8,
    news: 7,
    cot: 6,
    flow: 7,
    volatility: 6,
    currency: 6,
  },
  fractal: 2,
  minRR: 1.5,
  confirmGrade: 65,
});
const qa = {
  bars: {},
  meta: {},
  flow: {},
  drivers: {},
  driverStatus: [],
  models: {},
  busy: false,
  lastPoll: 0,
  active: false,
  overlay: { vwap: false, levels: false, structure: false },
  anchorMode: false,
  anchors: {},
  risk: {},
  journal: [],
  journalReady: false,
  lastPaint: 0,
  alerts: new Map(),
};
const qesc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const qnum = (x, n = 2) =>
  Number.isFinite(x)
    ? x.toLocaleString("en-US", { maximumFractionDigits: n })
    : "n/a";
const qtime = (t) =>
  new Date(t).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour12: false,
  });
const qlast = (a) => a?.at(-1);
function qstatus(source, ts, delayed = true, maxAge = 300000) {
  const age = Number.isFinite(ts)
      ? Math.max(0, Math.floor((Date.now() - ts) / 1000))
      : null,
    stale = age === null || age * 1000 > maxAge;
  return `<span class="qa-status"><i class="qa-dot ${stale ? "qa-stale" : delayed ? "" : "qa-live"}"></i>${qesc(source || "No feed")} · ${age === null ? "n/a · awaiting observations" : `updated ${age}s ago`} ${stale ? "· stale" : delayed ? "· delayed" : ""}</span>`;
}
function qb(sym, tf) {
  return qa.bars[sym + ":" + tf] || [];
}
function qput(sym, tf, bars, meta) {
  qa.bars[sym + ":" + tf] = bars
    .filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) && b.c > 0)
    .slice(-700);
  qa.meta[sym + ":" + tf] = { ...meta, received: Date.now() };
}
function qweek(t, fx = false) {
  const d = new Date(t);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monday = day - ((d.getUTCDay() + 6) % 7) * 864e5;
  return fx ? monday - 2 * 36e5 : monday;
}
function qday(t, fx = false) {
  const offset = fx ? 22 * 36e5 : 0;
  return Math.floor((t - offset) / 864e5) * 864e5 + offset;
}
function qsession(t) {
  const day = Math.floor(t / 864e5) * 864e5,
    h = (t - day) / 36e5;
  return day + (h >= 12 ? 12 : h >= 7 ? 7 : 0) * 36e5;
}
function qperiod(s, start, end) {
  const a = s.filter((b) => b.t >= start && b.t < end);
  if (!a.length || s[0].t > start) return null;
  return {
    h: Math.max(...a.map((b) => b.h)),
    l: Math.min(...a.map((b) => b.l)),
    c: a.at(-1).c,
    ht: a.reduce((a, b) => (b.h > a.h ? b : a)).t,
    lt: a.reduce((a, b) => (b.l < a.l ? b : a)).t,
  };
}
function qpreviousDay(sym, s) {
  const boundary = qday(Date.now(), !isHL(assetOf(sym).yahoo)),
    last = s.filter((b) => b.t < boundary).at(-1);
  if (!last) return null;
  const start = qday(last.t, !isHL(assetOf(sym).yahoo));
  return qperiod(s, start, start + 864e5);
}
function qlevels(sym, s, daily, atr, price) {
  if (!(atr > 0)) return [];
  const fx = !isHL(assetOf(sym).yahoo),
    now = Date.now(),
    day = qday(now, fx),
    week = qweek(now, fx),
    month =
      Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1) -
      (fx ? 2 * 36e5 : 0),
    prevMonth =
      Date.UTC(
        new Date(now).getUTCFullYear(),
        new Date(now).getUTCMonth() - 1,
        1,
      ) - (fx ? 2 * 36e5 : 0);
  const levels = [];
  const add = (p, label) => {
    if (Number.isFinite(p)) levels.push({ p, labels: [label], count: 1 });
  };
  const periodData = fx ? qb(sym, "1h") : daily;
  const dayData = fx ? s : daily;
  for (const [label, start, end] of [
    ["Previous day", day - 864e5, day],
    ["Previous week", week - 7 * 864e5, week],
    ["Previous month", prevMonth, month],
  ]) {
    const p =
      label === "Previous day"
        ? qpreviousDay(sym, dayData)
        : qperiod(periodData, start, end);
    if (!p) continue;
    add(p.h, label + " high");
    add(p.l, label + " low");
    add(p.c, label + " close");
    if (label === "Previous day")
      for (const [k, v] of Object.entries(Quant.pivots(p.h, p.l, p.c)))
        add(
          v,
          (k.startsWith("H") || k.startsWith("L") ? "Camarilla " : "Classic ") +
            k,
        );
  }
  const utcDay = Math.floor(now / 864e5) * 864e5;
  for (const [name, start, end] of [
    ["Asia", 0, 9],
    ["London", 7, 16],
    ["New York", 12, 21],
  ]) {
    const p = qperiod(
      s,
      utcDay + start * 36e5,
      Math.min(now, utcDay + end * 36e5),
    );
    if (p) {
      add(p.h, name + " high");
      add(p.l, name + " low");
    }
  }
  const steps =
    sym === "XAUUSD"
      ? [50, 100]
      : sym === "NAS100"
        ? [250, 500]
        : sym === "USDJPY"
          ? [0.5, 1]
          : sym === "DXY"
            ? [0.5, 1]
            : [0.005, 0.01];
  for (const step of steps)
    for (let i = -2; i <= 2; i++)
      add(Math.round(price / step) * step + i * step, "Round " + step);
  const piv = Quant.structure(s, ANALYSIS_CONFIG.fractal).points;
  for (let i = 1; i < piv.length; i++) {
    const b = piv[i];
    if (
      piv
        .slice(0, i)
        .some((a) => a.side === b.side && Math.abs(a.p - b.p) <= 0.1 * atr)
    )
      add(
        b.p,
        b.side === "high"
          ? "Equal highs · liquidity"
          : "Equal lows · liquidity",
      );
  }
  for (let i = 1; i < daily.length; i++) {
    if (Math.abs(daily[i].o - daily[i - 1].c) > 0.15 * atr) {
      const low = Math.min(daily[i].o, daily[i - 1].c),
        high = Math.max(daily[i].o, daily[i - 1].c);
      if (
        !daily
          .slice(i)
          .some((b) => (daily[i].o > daily[i - 1].c ? b.l <= low : b.h >= high))
      ) {
        add(low, "Open gap edge");
        add(high, "Open gap edge");
      }
    }
  }
  levels.sort((a, b) => a.p - b.p);
  const zones = [];
  for (const l of levels) {
    const z = zones.at(-1);
    if (z && Math.abs(l.p - z.p) <= 0.15 * atr) {
      z.p = (z.p * z.count + l.p) / (z.count + 1);
      z.count++;
      z.labels.push(...l.labels);
    } else zones.push({ ...l });
  }
  for (const z of zones) {
    z.touches = s.filter(
      (b) => b.l <= z.p + 0.05 * atr && b.h >= z.p - 0.05 * atr,
    ).length;
    z.rank = z.count + Math.min(5, z.touches);
  }
  return zones
    .sort((a, b) => Math.abs(a.p - price) - Math.abs(b.p - price))
    .slice(0, 32)
    .sort((a, b) => b.p - a.p);
}
function qvwaps(sym, s, atr, price) {
  const now = Date.now(),
    fx = !isHL(assetOf(sym).yahoo),
    day = qday(now, fx),
    week = qweek(now, fx),
    prev = qpreviousDay(sym, s);
  const event =
    calStatus === "live"
      ? EVENTS.filter(
          (e) =>
            e.imp >= 5 &&
            e.when <= now &&
            /non.?farm|payroll|cpi|fomc/i.test(e.name),
        ).at(-1)
      : null;
  const anchors = [
    ["Session", qsession(now)],
    ["Daily", day],
    ["Weekly", week],
    ["Week open anchor", week],
    ["Previous day high anchor", prev?.ht],
    ["Previous day low anchor", prev?.lt],
    ["Last NFP/CPI/FOMC", event?.when],
    ["Custom anchor", qa.anchors[sym]],
  ];
  return anchors.map(([label, t]) => ({
    label,
    t,
    ...(Number.isFinite(t) ? Quant.vwap(s, t, !fx) : null),
    reason: !Number.isFinite(t)
      ? "Anchor unavailable"
      : s[0]?.t > t
        ? "History does not reach anchor"
        : "Volume unavailable",
  }));
}
function qdriverRules(sym) {
  return sym === "XAUUSD"
    ? { DXY: -1, DFII10: -1, TNX: -1, VIX: 1 }
    : sym === "NAS100"
      ? { TNX: -1, DFII10: -1, VIX: -1, SPX: 1 }
      : sym === "AUDUSD"
        ? { COPPER: 1, USDCNH: -1, SPX: 1, DXY: -1 }
        : sym === "USDJPY"
          ? { TNX: 1, FVX: 1, VIX: -1 }
          : sym === "DXY"
            ? { TNX: 1, DFII10: 1 }
            : { DXY: -1, SPX: 1 };
}
function qdrivers(sym, dir = 1) {
  return Object.entries(qdriverRules(sym)).map(([key, sign]) => {
    const d = qa.drivers[key],
      change = d && Number.isFinite(d.prevClose) ? d.price - d.prevClose : null,
      fresh =
        d &&
        Date.now() - d.ts <
          (key.startsWith("D") || key.startsWith("T10")
            ? 6 * 864e5
            : 4 * 864e5);
    const x = change === null || !fresh ? 0 : Math.sign(change) * sign * dir;
    return {
      key,
      d,
      fresh,
      change,
      x,
      label: x > 0 ? "supportive" : x < 0 ? "adverse" : "neutral",
    };
  });
}
function qflowChange(sym, ms) {
  const f = qa.flow[sym],
    a = f?.oi;
  if (!a?.length) return null;
  const last = a.at(-1),
    then = a.find((x) => x.t >= last.t - ms);
  if (!then || last.t - then.t < ms * 0.9 || Date.now() - last.t > 60000)
    return null;
  return { pct: (last.oi / then.oi - 1) * 100, price: last.price - then.price };
}
function qrisk(sym) {
  const r = qa.risk[sym] || {},
    sg = SIGNAL_CFG[sym],
    parse = (x) => Number(String(x).replaceAll(",", ""));
  const entry = r.entry ?? parse(sg.plan[0]),
    stop = r.stop ?? parse(sg.plan[1]),
    target = r.target ?? parse(sg.plan[2]),
    dir = Math.sign(sg.score),
    valid =
      [entry, stop, target].every((x) => Number.isFinite(x) && x > 0) &&
      dir !== 0 &&
      (entry - stop) * dir > 0 &&
      (target - entry) * dir > 0;
  return {
    entry,
    stop,
    target,
    dir,
    valid,
    rr: valid ? Math.abs((target - entry) / (entry - stop)) : null,
    min: r.minRR ?? ANALYSIS_CONFIG.minRR,
  };
}
function qconfluence(sym, m) {
  const w = ANALYSIS_CONFIG.weights,
    sg = SIGNAL_CFG[sym],
    dir = Math.sign(sg.score),
    checks = [];
  const add = (key, label, value, reason) =>
    checks.push({
      key,
      label,
      status: value === null ? "neutral" : value ? "pass" : "fail",
      reason,
      weight: w[key] || 0,
    });
  const aligned = (t) => t && t.dir === dir;
  const freshTF = (tf) =>
    Date.now() - (qa.meta[sym + ":" + tf]?.ts || 0) <
    (tf === "1W" ? 10 * 864e5 : tf === "1D" ? 5 * 864e5 : 36e5)
      ? m.tf[tf]
      : null;
  const day = freshTF("1D"),
    week = freshTF("1W"),
    h = freshTF("1h"),
    min = freshTF("15m"),
    news = newsBias(sym),
    cot =
      cotData?.[sym] &&
      Date.now() - Date.parse(cotData[sym].m.date + "T00:00:00Z") < 14 * 864e5
        ? cotData[sym]
        : null,
    price = state.quotes[sym]?.price;
  const fresh =
    qa.meta[sym + ":15m"] &&
    Date.now() - (state.quotes[sym]?.ts || 0) <
      (isHL(assetOf(sym).yahoo) ? 90000 : 36e5);
  add(
    "trend",
    "Daily + weekly trend",
    day && week ? aligned(day) && aligned(week) : null,
    day && week
      ? `Daily ${day.dir > 0 ? "up" : "down"}, weekly ${week.dir > 0 ? "up" : "down"}`
      : "n/a · insufficient daily / weekly history",
  );
  add(
    "structure",
    "15m + 1h structure",
    min && h
      ? aligned(min) &&
          aligned(h) &&
          min.structure.dir === dir &&
          h.structure.dir === dir
      : null,
    "EMA20/50 and confirmed fractal HH/HL or LH/LL must agree",
  );
  add(
    "adx",
    "1h ADX(14)",
    h?.adx?.adx != null ? h.adx.adx >= 20 : null,
    `ADX ${qnum(h?.adx?.adx)} · threshold 20`,
  );
  const vs = m.vwaps.find((x) => x.label === "Session"),
    vw = m.vwaps.find((x) => x.label === "Weekly");
  add(
    "vwap",
    "Session + weekly VWAP",
    vs?.value && vw?.value
      ? (price - vs.value) * dir > 0 && (price - vw.value) * dir > 0
      : null,
    "Price must be on the direction side of both anchors",
  );
  const opp = m.levels
      .filter((x) => (x.p - price) * dir > 0)
      .sort((a, b) => Math.abs(a.p - price) - Math.abs(b.p - price))[0],
    room = opp && m.atr ? Math.abs(opp.p - price) / m.atr : null;
  add(
    "room",
    "Room to opposing zone",
    room === null ? null : room >= 1,
    `${qnum(room)} ATR to nearest opposing zone`,
  );
  const drivers = qdrivers(sym, dir),
    available = drivers.filter((x) => x.d && x.fresh && x.change !== null);
  add(
    "intermarket",
    "Intermarket drivers",
    available.length === drivers.length
      ? available.reduce((s, x) => s + x.x, 0) > 0
      : null,
    drivers.map((x) => x.key + " " + x.label).join(", "),
  );
  add(
    "news",
    "News bias",
    news.n ? Math.sign(news.score) === dir : null,
    news.n
      ? `${news.score} headline bias · ${news.score * sg.score < 0 ? "TECHNICAL / NEWS DISAGREE" : "heuristic alignment"}`
      : "n/a · no recent relevant headlines",
  );
  const percentile = cot?.m?.pctl,
    against = cot?.inv ? 100 - percentile : percentile;
  add(
    "cot",
    "COT not extreme against",
    percentile !== undefined ? (dir > 0 ? against > 10 : against < 90) : null,
    percentile !== undefined
      ? `${percentile}th percentile · report ${cot.m.date}`
      : "n/a · CFTC unavailable",
  );
  const f = qa.flow[sym],
    oi = qflowChange(sym, 300000),
    fund = Number(f?.ctx?.funding),
    stream = f?.times;
  const flowFresh =
    stream &&
    ["trades", "activeAssetCtx", "l2Book"].every(
      (k) => Date.now() - (stream[k] || 0) < 60000,
    );
  add(
    "flow",
    "Positioning / flow",
    isHL(assetOf(sym).yahoo)
      ? flowFresh && oi && Number.isFinite(fund)
        ? oi.pct > 0 &&
          Math.sign(oi.price) === dir &&
          Math.sign(f.cvd) === dir &&
          fund * dir < 0.0003
        : null
      : percentile !== undefined
        ? dir > 0
          ? against > 10
          : against < 90
        : null,
    isHL(assetOf(sym).yahoo)
      ? "5m OI, observed-session CVD and funding crowding · requires fresh streams"
      : "COT proxy; spot FX has no centralised volume",
  );
  add(
    "volatility",
    "Volatility regime",
    h?.pctl != null ? h.pctl < 98 : null,
    `1h ATR percentile ${qnum(h?.pctl)} · 100 observations required`,
  );
  if (/^(EUR|GBP|AUD|USDJPY)/.test(sym)) {
    const base = sym.slice(0, 3),
      quote = sym.slice(3),
      b = curStrength(base),
      q = curStrength(quote);
    add(
      "currency",
      "Currency strength",
      b.t?.live && q.t?.live ? b.score * dir > 0 && q.score * dir < 0 : null,
      b.t?.live && q.t?.live
        ? `${base} ${b.score}, ${quote} ${q.score}`
        : "n/a · currency trend histories unavailable",
    );
  } else
    add(
      "currency",
      "Currency strength",
      null,
      "Not applicable to this instrument",
    );
  const now = Date.now(),
    event =
      calStatus === "live"
        ? EVENTS.find(
            (e) =>
              e.imp >= 5 &&
              e.when >= now - 5 * 6e4 &&
              e.when <= now + 30 * 6e4 &&
              (e.country === "USD" || sym.includes(e.country)),
          )
        : null,
    r = qrisk(sym),
    veto = [];
  if (event) veto.push("Red-folder within 30m: " + event.name);
  if (calStatus !== "live") veto.push("Live calendar unavailable");
  if (!r.valid) veto.push("Valid entry, stop and target required");
  else if (r.rr < r.min) veto.push(`R:R ${qnum(r.rr)} below ${r.min}`);
  if (!fresh) veto.push("Price stale or unavailable");
  if (!dir) veto.push("No directional setup");
  const applicable = checks.filter(
      (x) => !(x.key === "currency" && !/^(EUR|GBP|AUD|USDJPY)/.test(sym)),
    ),
    den = applicable.reduce((s, c) => s + c.weight, 0),
    score = Math.round(
      (100 *
        applicable
          .filter((x) => x.status === "pass")
          .reduce((s, c) => s + c.weight, 0)) /
        den,
    ),
    coverage = Math.round(
      (100 *
        applicable
          .filter((x) => x.status !== "neutral")
          .reduce((s, c) => s + c.weight, 0)) /
        den,
    );
  const grade =
    veto.length || score < 50
      ? "No trade"
      : score >= 80
        ? "A"
        : score >= 65
          ? "B"
          : "C";
  const confirmed =
    !veto.length && score >= ANALYSIS_CONFIG.confirmGrade && coverage >= 80;
  return {
    score,
    grade,
    dir,
    checks,
    veto,
    coverage,
    confirmed,
    reasons: [
      ...veto,
      ...checks
        .filter((c) => c.status !== "pass")
        .map((c) => c.label + ": " + c.reason),
    ].slice(0, 3),
  };
}
function qmodel(sym) {
  const tf = {};
  for (const t of ["15m", "1h", "4h", "1D", "1W"])
    tf[t] = Quant.trend(qb(sym, t), ANALYSIS_CONFIG.fractal);
  const atr = tf["1h"]?.atr,
    price = state.quotes[sym]?.price,
    s = qb(sym, "15m");
  const m = {
    tf,
    atr,
    price,
    levels: qlevels(sym, s, qb(sym, "1D"), atr, price),
    vwaps: qvwaps(sym, s, atr, price),
  };
  m.confluence = qconfluence(sym, m);
  qa.models[sym] = m;
  return m;
}
function qbanner(c) {
  return `<div class="qa-banner"><strong>${c.confirmed ? "CONFIRMED " + (c.dir > 0 ? "LONG" : "SHORT") : "STAND ASIDE"} <span class="qa-chip">${c.grade} · ${c.score}/100</span></strong><small>Trade filter · ${c.coverage}% data coverage · indicator agreement, not a probability</small><div>${c.reasons.length ? c.reasons.map(qesc).join("<br>") : "Directional checks aligned; manage execution and risk."}</div></div>`;
}
function qtable(head, rows) {
  return `<table class="qa-table"><thead><tr>${head.map((h) => `<th>${qesc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}">n/a · waiting for sufficient verified history</td></tr>`}</tbody></table>`;
}
function qsection(n, title, body, source) {
  return `<details class="qa-section" id="qa-section-${n}" ${n === 1 ? "open" : ""}><summary>0${n} / ${title}</summary><div class="qa-body">${source}${body}</div></details>`;
}
function qrender() {
  if (document.hidden || document.activeElement?.closest("#qa-risk")) return;
  const sym = state.selected,
    m = qa.models[sym] || qmodel(sym),
    a = assetOf(sym),
    c = m.confluence,
    meta = qa.meta[sym + ":15m"],
    source = qstatus(meta?.source, meta?.ts, meta?.delayed !== false, 36e5);
  const body = document.getElementById("qa-content");
  if (!body) return;
  const open = [...body.querySelectorAll("details[open]")].map((x) => x.id);
  const oldRisk = body.querySelector("#qa-risk");
  const focusInRisk = oldRisk?.contains(document.activeElement);
  let riskNode = oldRisk;
  let html = qsection(
    1,
    "Confluence engine",
    qbanner(c) +
      c.checks
        .map(
          (x) =>
            `<div class="qa-check"><span class="qa-${x.status}">${x.status}</span><div><b>${qesc(x.label)}</b> <small>weight ${x.weight}</small><br><small>${qesc(x.reason)}</small></div></div>`,
        )
        .join("") +
      '<p class="qa-note">Neutral or missing checks earn no points. Grade C is observation only. A/B requires at least 80% coverage and no veto. Decision aid, not advice.</p>',
    source,
  );
  html += qsection(
    2,
    "VWAP & anchors",
    `<p class="qa-note">Session resets: Asia 02:00, London 09:00, New York 14:00 SAST. Daily reset: ${isHL(a.yahoo) ? "02:00 SAST" : "00:00 SAST (22:00 UTC)"}. Weekly: ${isHL(a.yahoo) ? "Monday 02:00" : "Monday 00:00"} SAST. FX/DXY use time weights. Bands use weighted price dispersion.</p>` +
      qtable(
        ["Anchor", "VWAP / ±1σ / ±2σ", "Distance"],
        m.vwaps.map((v) => [
          qesc(v.label),
          v.value
            ? `${qnum(v.value, a.dp)}<br><small>±${qnum(v.sd, a.dp)} / ±${qnum(2 * v.sd, a.dp)}</small>`
            : `n/a · ${qesc(v.reason)}`,
          v.value
            ? `${qnum((m.price - v.value) / m.atr)} ATR<br>${qnum((m.price / v.value - 1) * 100)}%`
            : "n/a",
        ]),
      ) +
      '<button id="qa-anchor">Set custom anchor: tap chart</button><p class="qa-note">Only candles at or after the anchor enter the calculation. Older anchors require full available history.</p>',
    source,
  );
  const sup = m.levels
      .filter((x) => x.p < m.price)
      .sort((a, b) => b.p - a.p)[0],
    res = m.levels.filter((x) => x.p > m.price).sort((a, b) => a.p - b.p)[0];
  html += qsection(
    3,
    "Key levels & liquidity",
    qtable(
      ["Price", "Zone / rank", "Distance / tests"],
      m.levels.map((z) => [
        `<span class="${z === sup ? "qa-pass" : z === res ? "qa-fail" : ""}">${qnum(z.p, a.dp)}${z === sup ? " · support" : z === res ? " · resistance" : ""}</span>`,
        `${qesc(z.labels.join(" + "))}<br><small>Confluence ${z.count} · rank ${z.rank}</small>`,
        `${qnum((z.p - m.price) / m.atr)} ATR / ${qnum((z.p / m.price - 1) * 100)}%<br>${z.touches ? "Tested " + z.touches + " bars" : "Untested in loaded window"}`,
      ]),
    ) +
      '<p class="qa-note">Merge tolerance 0.15 ATR; equal highs/lows 0.1 ATR. Touch count is bars in the loaded window, not independent visits. Daily Yahoo bars use provider sessions; FX exact rollover levels require complete intraday coverage. Previous period rows are omitted when history is insufficient.</p><button id="qa-notify">Enable optional browser alerts</button>',
    source,
  );
  const dr = qdrivers(sym, c.dir || 1);
  html += qsection(
    4,
    "Intermarket & correlations",
    qtable(
      ["Driver", "Direction / observation", "Effect"],
      dr.map((x) => [
        qesc(x.key),
        `${x.change === null ? "n/a" : x.change > 0 ? "↑" : x.change < 0 ? "↓" : "flat"} · ${qnum(x.d?.price)}${qstatus(x.d?.source, x.d?.ts, true, 6 * 864e5)}`,
        `<span class="qa-${x.x > 0 ? "pass" : x.x < 0 ? "fail" : "neutral"}">${x.label}</span>`,
      ]),
    ) +
      '<p class="qa-note">Effect relative to the selected ' +
      (c.dir > 0 ? "long" : "short") +
      " direction. CNH strength is inverse USDCNH. Yield correlations use relative changes of observed yield levels. Observation dates align before returns are calculated.</p>" +
      qtable(
        ["All drivers", "Value / daily change", "Observation"],
        Object.entries(qa.drivers).map(([name, d]) => [
          qesc(name),
          qnum(d.price) + " / " + qnum(d.price - d.prevClose),
          qstatus(d.source, d.ts, true, 6 * 864e5),
        ]),
      ) +
      qcorrelations() +
      qtable(
        ["Source", "Health", "Latency"],
        qa.driverStatus.map((x) => [
          qesc(x.name),
          x.ok ? "Available" : "n/a · upstream failed",
          qnum(x.ms, 0) + "ms",
        ]),
      ),
    qstatus("Yahoo daily / FRED daily", qa.driverAt, true, 900000),
  );
  html += qsection(
    5,
    "Trend strength & structure",
    qtable(
      ["TF / score", "Strength / volatility", "Trend / structure"],
      Object.entries(m.tf).map(([tf, t]) => [
        tf + (t ? `<br><b>${t.score}/100</b> ${t.label}` : ""),
        t
          ? `ADX ${qnum(t.adx?.adx)}<br>+DI ${qnum(t.adx?.plus)} / −DI ${qnum(t.adx?.minus)}<br>ATR ${qnum(t.atr, a.dp)} · pct ${qnum(t.pctl)}`
          : "n/a · needs 60+ bars",
        t
          ? `EMA20/50 ${t.dir > 0 ? "↑" : "↓"}<br>SMA50 ${qnum(t.sma50, a.dp)} / SMA200 ${qnum(t.sma200, a.dp)}<br>${t.sma200 ? `SMA ${t.sma50 > t.sma200 ? "golden" : "death"} state · price ${m.price > t.sma200 ? "above" : "below"} 200` : "SMA200 n/a"}<br>EMA50 ${qnum(t.e50, a.dp)} / EMA200 ${qnum(t.e200, a.dp)}<br>${t.e200 ? `EMA ${t.e50 > t.e200 ? "golden" : "death"} state · price ${m.price > t.e200 ? "above" : "below"} 200` : "200-bar state n/a"}<br>Supertrend ${t.supertrend?.dir > 0 ? "↑" : "↓"} ${qnum(t.supertrend?.value, a.dp)}<br>${t.squeeze ? "Squeeze on" : t.fired ? "Squeeze fired" : "Squeeze off"} · ${t.structure.points
              .slice(-2)
              .map((p) => p.label)
              .join(
                "/",
              )}${qstatus(qa.meta[sym + ":" + tf]?.source, qa.meta[sym + ":" + tf]?.ts, qa.meta[sym + ":" + tf]?.delayed !== false, tf === "1D" || tf === "1W" ? 9 * 864e5 : 36e5)}`
          : "n/a",
      ]),
    ) +
      qtable(
        ["Structure event", "Time (SAST)", "Level"],
        (m.tf["15m"]?.structure.events || [])
          .slice(-8)
          .reverse()
          .map((e) => [
            e.label + " " + (e.dir > 0 ? "↑" : "↓"),
            qtime(e.t),
            qnum(e.p, a.dp),
          ]),
      ) +
      '<label>Fractal wings <input id="qa-fractal" type="number" min="1" max="5" value="' +
      ANALYSIS_CONFIG.fractal +
      '"></label><p class="qa-note">Confirmed pivots lag by the chosen wings. BOS/CHoCH uses candle closes through confirmed pivots. 4h and weekly bars are aggregated from observed hourly/daily data; the current bar is provisional.</p>',
    source,
  );
  html += qsection(
    6,
    "Positioning & flow",
    qflowHtml(sym),
    isHL(a.yahoo)
      ? qstatus(
          "Hyperliquid · xyz HIP-3 WebSocket",
          qa.flow[sym]?.at,
          false,
          60000,
        )
      : qstatus(
          "CFTC · weekly report",
          cotData?.[sym]
            ? Date.parse(cotData[sym].m.date + "T00:00:00Z")
            : null,
          true,
          10 * 864e5,
        ),
  );
  html += qsection(
    7,
    "Risk desk & trade journal",
    '<div id="qa-risk-placeholder"></div>',
    qstatus(
      "Manual inputs / Netlify journal · USDZAR Yahoo",
      qa.drivers.USDZAR?.ts,
      true,
      4 * 864e5,
    ),
  );
  body.innerHTML = html;
  if (open.length)
    body
      .querySelectorAll("details")
      .forEach((x) => (x.open = open.includes(x.id)));
  const ph = document.getElementById("qa-risk-placeholder");
  if (riskNode && riskNode.dataset.sym === sym) {
    ph.replaceWith(riskNode);
  } else {
    ph.outerHTML = qriskForm(sym);
  }
  if (!focusInRisk) qriskOutput();
  document.getElementById("qa-anchor").onclick = () => {
    qa.anchorMode = true;
    showTab("dash");
    showEventToast("Tap the chart to choose a custom VWAP anchor");
  };
  document.getElementById("qa-notify").onclick = () => {
    if ("Notification" in window) Notification.requestPermission();
  };
  document.getElementById("qa-fractal").onchange = (e) => {
    ANALYSIS_CONFIG.fractal = Math.max(
      1,
      Math.min(5, Number(e.target.value) || 2),
    );
    qrecompute();
  };
  qbindRisk();
}
function qcorrelations() {
  if (qa.correlationHTML && Date.now() - qa.correlationAt < 60000)
    return qa.correlationHTML;
  qa.correlationAt = Date.now();
  const driverKeys = Object.keys(qa.drivers);
  return (qa.correlationHTML =
    ["20", "60"]
      .map(
        (n) =>
          `<h3>${n}-day daily-return correlations</h3><div class="qa-correlation">` +
          qtable(
            ["Market", ...driverKeys],
            ASSETS.map((a) => [
              a.sym,
              ...driverKeys.map((k) => {
                const x = Quant.corr(
                    qb(a.sym, "1D"),
                    qa.drivers[k]?.series || [],
                    +n,
                  ),
                  long = Quant.corr(
                    qb(a.sym, "1D"),
                    qa.drivers[k]?.series || [],
                    60,
                  ),
                  short = Quant.corr(
                    qb(a.sym, "1D"),
                    qa.drivers[k]?.series || [],
                    20,
                  ),
                  breakdown =
                    short !== null &&
                    long !== null &&
                    Math.abs(short - long) > 0.5;
                return `<span style="display:block;background:${x === null ? "transparent" : x > 0 ? "rgba(52,211,153," + Math.abs(x) * 0.4 + ")" : "rgba(251,113,133," + Math.abs(x) * 0.4 + ")"}">${qnum(x)}${breakdown ? " ⚠" : ""}</span>`;
              }),
            ]),
          ) +
          "</div>",
      )
      .join("") +
    '<p class="qa-note">⚠ Correlation breakdown: |20d − 60d| &gt; 0.5. n/a means fewer aligned observations or zero return variance. Correlation is descriptive, not causation.</p>');
}
function qflowHtml(sym) {
  if (!isHL(assetOf(sym).yahoo)) {
    const cot = cotData?.[sym];
    return (
      `<p>Spot FX and DXY have no centralised volume feed here. Flow input is weekly CFTC positioning, not live spot order flow.</p>` +
      (cot
        ? qtable(
            ["Report", "Net", "Percentile"],
            [[qesc(cot.m.date), qnum(cot.m.L, 0), qnum(cot.m.pctl) + "th"]],
          )
        : "n/a · CFTC unavailable")
    );
  }
  const f = qa.flow[sym];
  if (!f) return "n/a · awaiting Hyperliquid context, book and trades";
  const ctx = f.ctx || {},
    num = (k) => (ctx[k] === undefined ? null : Number(ctx[k])),
    fund = num("funding"),
    mark = num("markPx"),
    oracle = num("oraclePx"),
    history = f.funding || [],
    avg = history.length
      ? Quant.avg(
          history.map((x) => Number(x.fundingRate)).filter(Number.isFinite),
        )
      : null,
    change = qflowChange(sym, 300000);
  const classify = change
    ? change.price > 0
      ? change.pct > 0
        ? "New longs · trend confirmation"
        : "Short covering · weak"
      : change.pct > 0
        ? "New shorts · trend confirmation"
        : "Long liquidation"
    : "n/a · collect at least 5m history";
  const rows = [
    [
      "Current hourly funding",
      fund === null ? "n/a" : qnum(fund * 100, 5) + "%",
    ],
    [
      "24h mean hourly funding",
      avg === null
        ? "n/a · funding history unavailable"
        : qnum(avg * 100, 5) + "% · " + history.length + " observations",
    ],
    [
      "Annualised (simple, 24 × 365)",
      fund === null ? "n/a" : qnum(fund * 24 * 365 * 100) + "%",
    ],
    ["Open interest", qnum(num("openInterest"))],
    ...[
      [300000, "5m"],
      [36e5, "1h"],
      [864e5, "24h"],
    ].map(([ms, label]) => [
      "OI Δ " + label,
      qflowChange(sym, ms)
        ? qnum(qflowChange(sym, ms).pct) + "%"
        : "n/a · collecting " + label + " observations",
    ]),
    ["Price / OI regime", classify],
    [
      "Mark / oracle premium",
      mark && oracle
        ? qnum((mark / oracle - 1) * 100, 4) + "%"
        : "n/a · oracle unavailable",
    ],
    ["24h notional volume", qnum(num("dayNtlVlm"))],
    [
      "Top 10 book imbalance",
      Number.isFinite(f.imbalance)
        ? qnum(f.imbalance * 100) + "%"
        : "n/a · awaiting book",
    ],
    [
      "Observed-session CVD",
      Number.isFinite(f.cvd)
        ? qnum(f.cvd) + " contracts · since " + qtime(f.start)
        : "n/a · awaiting trades",
    ],
  ];
  const points = f.cvdPoints || [],
    min = Math.min(...points.map((p) => p.v)),
    max = Math.max(...points.map((p) => p.v));
  return (
    qtable(["Metric", "Observation"], rows) +
    `<svg class="qa-spark" viewBox="0 0 300 36" role="img" aria-label="Observed cumulative volume delta"><polyline fill="none" stroke="#d8a84d" points="${points.map((p, i) => `${(i / Math.max(1, points.length - 1)) * 300},${32 - ((p.v - min) / Math.max(1e-9, max - min)) * 28}`).join(" ")}"/></svg>` +
    qtable(
      ["Stream", "Freshness"],
      ["activeAssetCtx", "trades", "l2Book"].map((k) => [
        k,
        qstatus("Hyperliquid " + k, f.times?.[k], false, 60000),
      ]),
    ) +
    '<p class="qa-note">CVD starts at the first observed trade, resets at session opens, and excludes replayed snapshots. Stream gaps invalidate confirmation. OI changes need elapsed observation history; 24h needs this page open for a full day. Funding thresholds are heuristics; annualised rate is not a forecast.</p>'
  );
}
function qriskForm(sym) {
  const r = qa.risk[sym] || {},
    v = qrisk(sym),
    contract =
      r.contract ??
      (sym === "XAUUSD" ? 100 : sym === "NAS100" || sym === "DXY" ? 1 : 100000);
  const input = (key, label, value, step = "any") =>
    `<label>${label}<input data-risk="${key}" type="number" step="${step}" value="${Number.isFinite(value) ? value : ""}"></label>`;
  return `<div id="qa-risk" data-sym="${sym}"><p class="qa-note">Contract values must match your broker. XAU: ounces/lot; Nasdaq: $/point/lot; FX: base units/lot. DXY defaults to $1 per point as an editable sizing assumption.</p><div class="qa-form">${input("account", "Account balance", r.account)}<label>Account currency<select data-risk="currency"><option ${r.currency !== "ZAR" ? "selected" : ""}>USD</option><option ${r.currency === "ZAR" ? "selected" : ""}>ZAR</option></select></label>${input("riskPct", "Risk %", r.riskPct ?? 1)}${input("entry", "Entry", v.entry)}${input("stop", "Stop", v.stop)}${input("target", "Target", v.target)}${input("contract", "Contract / lot", contract)}${input("pointValue", "Point value multiplier", r.pointValue ?? 1)}${input("minRR", "Minimum reward:risk", r.minRR ?? ANALYSIS_CONFIG.minRR)}${input("lossLimit", "Daily loss limit (USD)", r.lossLimit)}${input("winProb", "Assumed win rate % (for EV)", r.winProb)}${input("resultR", "Journal result in R", r.resultR)}</div><div class="qa-actions">${[1, 1.5, 2].map((n) => `<button data-atr-stop="${n}">${n}× ATR stop</button>`).join("")}<button id="qa-prefill">Prefill signal</button></div><div id="qa-risk-output" class="qa-risk-output"></div><div class="qa-actions"><button id="qa-journal-add">Record closed trade</button><button id="qa-export">Export CSV</button></div><div id="qa-journal-stats"></div><small id="qa-save-state">${qa.journalReady ? "Private browser desk · database connected" : "Storage pending · entries are not saved yet"}</small><p class="qa-note">The private desk is associated with this browser by a secure cookie. Settings, anchors and trades persist in Netlify Database. Export your journal before clearing browser cookies. Partial outcomes and fees should be included in recorded R.</p></div>`;
}
function qriskValues() {
  const el = document.getElementById("qa-risk");
  if (!el) return;
  const sym = el.dataset.sym;
  qa.risk[sym] = qa.risk[sym] || {};
  for (const i of el.querySelectorAll("[data-risk]")) {
    const k = i.dataset.risk;
    if (i.value === "") delete qa.risk[sym][k];
    else qa.risk[sym][k] = k === "currency" ? i.value : Number(i.value);
  }
  return qa.risk[sym];
}
function qriskCalc(sym) {
  const r = qa.risk[sym] || {},
    v = qrisk(sym),
    fx = sym === "USDJPY",
    rate = qa.drivers.USDZAR,
    rateOK = rate && Date.now() - rate.ts < 4 * 864e5;
  let riskUSD =
    r.account > 0 && r.riskPct > 0 && r.riskPct <= 100
      ? (r.account * r.riskPct) / 100
      : null;
  if (r.currency === "ZAR")
    riskUSD = rateOK && riskUSD ? riskUSD / rate.price : null;
  const contract =
      r.contract ??
      (sym === "XAUUSD" ? 100 : sym === "NAS100" || sym === "DXY" ? 1 : 100000),
    mult = r.pointValue ?? 1,
    lossPerLot = v.valid
      ? (Math.abs(v.entry - v.stop) * contract * mult) / (fx ? v.entry : 1)
      : null;
  const lots = riskUSD && lossPerLot > 0 ? riskUSD / lossPerLot : null,
    prob = r.winProb >= 0 && r.winProb <= 100 ? r.winProb / 100 : null;
  return {
    ...v,
    riskUSD,
    lots,
    ev: prob !== null && v.rr ? prob * v.rr - (1 - prob) : null,
    lossPerLot,
  };
}
function qriskOutput() {
  const sym = state.selected,
    r = qa.risk[sym] || {},
    v = qriskCalc(sym),
    out = document.getElementById("qa-risk-output");
  if (out)
    out.innerHTML = `Risk USD <b>${qnum(v.riskUSD)}</b> · Lots <b>${qnum(v.lots, 4)}</b><br>R:R <b>${qnum(v.rr)}</b> · Breakeven win rate <b>${v.rr ? qnum(100 / (1 + v.rr)) + "%" : "n/a"}</b><br>Expected value <b>${qnum(v.ev)} R</b> (uses your assumed win rate)<br><span class="${v.valid && v.rr >= v.min ? "qa-pass" : "qa-fail"}">${v.valid ? (v.rr >= v.min ? "R:R filter passed" : "R:R veto active") : "Valid direction, entry, stop and target required"}</span>${r.currency === "ZAR" && !qa.drivers.USDZAR ? "<br>n/a · live USDZAR conversion unavailable" : ""}`;
  const trades = qa.journal,
    stats = document.getElementById("qa-journal-stats"),
    today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Johannesburg",
    }),
    daily = trades.filter(
      (t) =>
        new Date(t.t).toLocaleDateString("en-CA", {
          timeZone: "Africa/Johannesburg",
        }) === today,
    ),
    loss = -daily
      .filter((t) => t.r < 0)
      .reduce((s, t) => s + t.r * t.riskUSD, 0);
  if (stats)
    stats.innerHTML =
      `<p>${trades.length} trades · Win rate ${trades.length ? qnum((100 * trades.filter((t) => t.r > 0).length) / trades.length) + "%" : "n/a"} · Expectancy ${trades.length ? qnum(Quant.avg(trades.map((t) => t.r))) + " R" : "n/a"}</p><p class="${r.lossLimit > 0 && loss >= r.lossLimit ? "qa-fail" : ""}">SAST daily realised gross loss: $${qnum(loss)} / ${r.lossLimit > 0 ? "$" + qnum(r.lossLimit) : "limit not set"}${r.lossLimit > 0 && loss >= r.lossLimit ? " · LOSS LIMIT REACHED" : ""}</p>` +
      qtable(
        ["Market / SAST", "R", "Risk USD"],
        trades
          .slice(-10)
          .reverse()
          .map((t) => [
            t.sym + "<br><small>" + qtime(t.t) + "</small>",
            qnum(t.r),
            qnum(t.riskUSD),
          ]),
      );
}
let qsaveTimer;
function qsave() {
  clearTimeout(qsaveTimer);
  qsaveTimer = setTimeout(async () => {
    const label = document.getElementById("qa-save-state");
    if (!qa.journalReady) {
      if (label) label.textContent = "Storage unavailable · changes not saved";
      return;
    }
    try {
      const r = await fetch("/api/desk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          risk: qa.risk,
          anchors: qa.anchors,
          journal: qa.journal,
        }),
      });
      if (!r.ok) throw Error();
      if (label) label.textContent = "Saved to private Netlify desk";
    } catch {
      if (label) label.textContent = "Save failed · export journal and retry";
    }
  }, 700);
}
function qbindRisk() {
  const el = document.getElementById("qa-risk");
  if (!el) return;
  el.querySelectorAll("[data-risk]").forEach(
    (i) =>
      (i.oninput = () => {
        qriskValues();
        qriskOutput();
        qsave();
        const m = qa.models[state.selected];
        if (m) m.confluence = qconfluence(state.selected, m);
      }),
  );
  el.querySelectorAll("[data-atr-stop]").forEach(
    (b) =>
      (b.onclick = () => {
        qriskValues();
        const sym = state.selected,
          r = qa.risk[sym],
          atr = qa.models[sym]?.atr,
          d = Math.sign(SIGNAL_CFG[sym].score);
        if (r.entry && atr && d) {
          r.stop = r.entry - d * Number(b.dataset.atrStop) * atr;
          el.querySelector('[data-risk="stop"]').value = r.stop;
          qriskOutput();
          qsave();
        }
      }),
  );
  el.querySelector("#qa-prefill").onclick = () => {
    const sym = state.selected,
      r = qa.risk[sym] || {};
    for (const k of ["entry", "stop", "target"]) delete r[k];
    qa.risk[sym] = r;
    el.outerHTML = qriskForm(sym);
    qbindRisk();
    qriskOutput();
    qsave();
  };
  el.querySelector("#qa-journal-add").onclick = () => {
    qriskValues();
    const r = qa.risk[state.selected],
      v = qriskCalc(state.selected);
    if (
      !qa.journalReady ||
      !Number.isFinite(r.resultR) ||
      Math.abs(r.resultR) > 100 ||
      !(v.riskUSD > 0)
    ) {
      showEventToast(
        "Enter a valid R result and account risk; storage must be connected",
      );
      return;
    }
    if (qa.journal.length >= 500) {
      showEventToast("Journal holds 500 trades; export before continuing");
      return;
    }
    qa.journal.push({
      sym: state.selected,
      t: Date.now(),
      r: r.resultR,
      riskUSD: v.riskUSD,
    });
    qriskOutput();
    qsave();
  };
  el.querySelector("#qa-export").onclick = () => {
    const csv =
        "market,time_sast,R,risk_USD\n" +
        qa.journal
          .map((t) =>
            [t.sym, qtime(t.t), t.r, t.riskUSD]
              .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
              .join(","),
          )
          .join("\n"),
      url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      a = document.createElement("a");
    a.href = url;
    a.download = "newssignal-journal.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
async function qloadDesk() {
  try {
    const r = await fetch("/api/desk");
    if (!r.ok) throw Error();
    const d = await r.json();
    qa.risk = d.risk || {};
    qa.anchors = d.anchors || {};
    qa.journal = d.journal || [];
    qa.journalReady = true;
  } catch {
    qa.journalReady = false;
  }
  qrecompute();
}
let qsocket = null,
  qretry = 0,
  qreconnect,
  qheartbeat,
  qcomputeTimer,
  qdirty = new Set();
function qschedule(sym) {
  if (sym) qdirty.add(sym);
  if (document.hidden || qcomputeTimer) return;
  qcomputeTimer = setTimeout(
    () => {
      qcomputeTimer = null;
      qrecompute();
    },
    Math.max(0, 1000 - (Date.now() - qa.lastPaint)),
  );
}
function qrecompute() {
  if (document.hidden) return;
  qa.lastPaint = Date.now();
  const syms = qdirty.size ? [...qdirty] : ASSETS.map((a) => a.sym);
  qdirty.clear();
  for (const sym of syms) {
    const s = qb(sym, "15m");
    if (s.length >= 60) SIGNAL_CFG[sym] = computeSignal(sym, s);
    const old = qa.models[sym],
      m = qmodel(sym);
    if (old) qalerts(sym, old, m);
  }
  renderSignalBoard();
  if (!qa.active) renderSignalDetail();
  qrenderSummaries();
  if (qa.active) qrender();
  if (Object.values(qa.overlay).some(Boolean)) renderChart();
}
function qrenderSummaries() {
  for (const el of document.querySelectorAll("#signalBoard [data-sym]")) {
    const c = qa.models[el.dataset.sym]?.confluence;
    if (!c) continue;
    let chip = el.querySelector(".qa-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "qa-chip";
      el.appendChild(chip);
    }
    chip.textContent = c.grade + " " + c.score;
    chip.title = c.reasons.join("; ");
  }
  const dest = document.getElementById("qa-signal-confluence");
  if (dest) {
    const sym = state.selected,
      c = qa.models[sym]?.confluence;
    if (c)
      dest.innerHTML =
        qbanner(c) +
        qstatus(
          qa.meta[sym + ":15m"]?.source,
          state.quotes[sym]?.ts,
          !state.quotes[sym]?.ws,
          90000,
        );
  }
}
async function qhistory(a, tf) {
  const hl = isHL(a.yahoo);
  const cfg = {
    "15m": ["15m", "1mo", 700],
    "1h": ["60m", "1mo", 700],
    "1D": ["1d", "2y", 700],
    "1W": ["1wk", "5y", 260],
  }[tf];
  try {
    let series, meta;
    if (hl) {
      const iv = { "15m": "15m", "1h": "1h", "1D": "1d", "1W": "1w" }[tf];
      series = await hlCandles(a.yahoo, iv, cfg[2]);
      meta = {
        source: "Hyperliquid · REST + candle WebSocket",
        ts: series.at(-1)?.t,
        delayed: false,
      };
    } else {
      const j = await callApi(
        `/market?sym=${encodeURIComponent(a.yahoo)}&range=${cfg[1]}&interval=${cfg[0]}`,
      );
      series = j.series;
      meta = j;
    }
    if (!series?.length) return;
    const existing = qb(a.sym, tf),
      last = existing.at(-1);
    if (last && last.t >= series.at(-1).t) {
      const i = series.findIndex((b) => b.t === last.t);
      if (i >= 0 && Date.now() - (qa.meta[a.sym + ":" + tf]?.ts || 0) < 60000)
        series[i] = last;
    }
    qput(a.sym, tf, series, meta);
    if (tf === "1h") {
      qput(a.sym, "4h", Quant.aggregate(qb(a.sym, tf), 4 * 36e5), meta);
    }
    qschedule(a.sym);
  } catch (e) {
    const key = a.sym + ":" + tf;
    qa.meta[key] = { ...qa.meta[key], error: "Feed unavailable" };
  }
}
async function qpoll() {
  if (
    document.hidden ||
    qa.busy ||
    (qa.lastPoll && Date.now() - qa.lastPoll < 120000)
  )
    return;
  qa.busy = true;
  const now = Date.now(),
    initial = !qa.lastPoll,
    dueLong = initial || now - qa.longAt > 1800000;
  try {
    await Promise.allSettled(
      ASSETS.flatMap((a) =>
        ["15m", "1h", ...(dueLong ? ["1D", "1W"] : [])].map((tf) =>
          qhistory(a, tf),
        ),
      ),
    );
    if (dueLong) qa.longAt = now;
    if (initial || now - (qa.driverFetched || 0) > 300000) {
      qa.driverFetched = now;
      try {
        const j = await callApi("/drivers", 8000);
        qa.drivers = j.data;
        qa.driverStatus = j.sources;
        qa.driverAt = j.checkedAt;
      } catch {
        qa.driverStatus = [{ name: "Drivers", ok: false }];
      }
    }
    if (initial || now - (qa.fundingFetched || 0) > 3600000) {
      qa.fundingFetched = now;
      await Promise.allSettled(
        ASSETS.filter((a) => isHL(a.yahoo)).map(async (a) => {
          try {
            const rows = await hlPost({
              type: "fundingHistory",
              coin: a.yahoo,
              startTime: Date.now() - 864e5,
              endTime: Date.now(),
            });
            qflow(a.sym).funding = Array.isArray(rows) ? rows : [];
          } catch {}
        }),
      );
    }
    qa.lastPoll = now;
  } finally {
    qa.busy = false;
    qschedule();
  }
}
function qflow(sym) {
  return (
    qa.flow[sym] ||
    (qa.flow[sym] = {
      times: {},
      oi: [],
      cvdPoints: [],
      seen: new Set(),
      session: qsession(Date.now()),
      start: Date.now(),
    })
  );
}
function qcoin(coin) {
  return ASSETS.find((a) => a.yahoo === coin || a.yahoo.split(":")[1] === coin);
}
function qmessage(m) {
  if (document.hidden) return;
  const d = m.data,
    now = Date.now();
  if (m.channel === "candle") {
    for (const b of Array.isArray(d) ? d : [d]) {
      const a = qcoin(b.s);
      if (!a) continue;
      const candle = { t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v };
      if (
        ![candle.t, candle.o, candle.h, candle.l, candle.c, candle.v].every(
          Number.isFinite,
        )
      )
        continue;
      const tf = {
        "15m": "15m",
        "1h": "1h",
        "4h": "4h",
        "1d": "1D",
        "1w": "1W",
      }[b.i];
      if (tf) {
        const arr = qb(a.sym, tf);
        const i = arr.findIndex((x) => x.t === candle.t);
        if (i >= 0) arr[i] = candle;
        else if (!arr.length || candle.t > arr.at(-1).t) arr.push(candle);
        if (arr.length > 700) arr.shift();
        qa.bars[a.sym + ":" + tf] = arr;
        qa.meta[a.sym + ":" + tf] = {
          source: "Hyperliquid · candle WebSocket",
          ts: now,
          delayed: false,
        };
      }
      const q = state.quotes[a.sym];
      if (q && b.i === "1m") {
        q.price = candle.c;
        q.high = Math.max(q.high, candle.h);
        q.low = Math.min(q.low, candle.l);
        q.ts = now;
        q.ws = true;
        state.sources[a.sym] = "LIVE";
        bumpLiveTick(a.sym, candle.c);
      }
      qschedule(a.sym);
    }
    return;
  }
  if (m.channel === "trades") {
    for (const t of d || []) {
      const a = qcoin(t.coin);
      if (!a) continue;
      const f = qflow(a.sym),
        session = qsession(now);
      if (f.session !== session) {
        f.session = session;
        f.cvd = undefined;
        f.cvdPoints.length = 0;
        f.start = now;
        f.seen.clear();
      }
      const id = t.tid ?? `${t.hash}:${t.time}:${t.px}:${t.sz}:${t.side}`;
      if (f.seen.has(id)) continue;
      f.seen.add(id);
      if (f.seen.size > 5000) f.seen.delete(f.seen.values().next().value);
      if (
        !Number.isFinite(+t.sz) ||
        !["B", "A"].includes(t.side) ||
        +t.time < f.start - 1000
      )
        continue;
      f.cvd = (f.cvd ?? 0) + (t.side === "B" ? 1 : -1) * Number(t.sz);
      f.times.trades = +t.time;
      f.at = now;
      if (!f.cvdPoints.length || now - f.cvdPoints.at(-1).t >= 1000) {
        f.cvdPoints.push({ t: now, v: f.cvd });
        if (f.cvdPoints.length > 180) f.cvdPoints.shift();
      }
      qschedule(a.sym);
    }
    return;
  }
  const a = qcoin(d?.coin);
  if (!a) return;
  const f = qflow(a.sym);
  if (m.channel === "activeAssetCtx") {
    f.ctx = d.ctx;
    f.times.activeAssetCtx = now;
    const oi = Number(d.ctx?.openInterest),
      price = Number(d.ctx?.markPx);
    if (oi > 0 && price > 0 && (!f.oi.length || now - f.oi.at(-1).t >= 30000)) {
      f.oi.push({ t: now, oi, price });
      if (f.oi.length > 3000) f.oi.shift();
    }
  }
  if (m.channel === "l2Book") {
    const b = d.levels?.[0]?.slice(0, 10).reduce((s, x) => s + Number(x.sz), 0),
      ask = d.levels?.[1]?.slice(0, 10).reduce((s, x) => s + Number(x.sz), 0);
    f.imbalance =
      Number.isFinite(b + ask) && b + ask > 0 ? (b - ask) / (b + ask) : null;
    f.times.l2Book = Number(d.time) || now;
  }
  f.at = now;
  qschedule(a.sym);
}
window.analysisConnect = function () {
  if (document.hidden || (qsocket && [0, 1].includes(qsocket.readyState)))
    return;
  clearTimeout(qreconnect);
  const ws = new WebSocket("wss://api.hyperliquid.xyz/ws");
  qsocket = ws;
  let seen = Date.now();
  ws.onopen = () => {
    qretry = 0;
    for (const a of ASSETS.filter((a) => isHL(a.yahoo))) {
      for (const tf of ["1m", "15m", "1h", "4h", "1d", "1w"])
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: { type: "candle", coin: a.yahoo, interval: tf },
          }),
        );
      for (const type of ["trades", "l2Book", "activeAssetCtx"])
        ws.send(
          JSON.stringify({
            method: "subscribe",
            subscription: { type, coin: a.yahoo },
          }),
        );
    }
    clearInterval(qheartbeat);
    qheartbeat = setInterval(() => {
      if (Date.now() - seen > 60000) {
        ws.close();
        return;
      }
      if (ws.readyState === 1) ws.send(JSON.stringify({ method: "ping" }));
    }, 20000);
  };
  ws.onmessage = (e) => {
    seen = Date.now();
    try {
      qmessage(JSON.parse(e.data));
    } catch {}
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    if (qsocket !== ws) return;
    clearInterval(qheartbeat);
    for (const f of Object.values(qa.flow)) {
      f.cvd = undefined;
      f.cvdPoints.length = 0;
      f.start = Date.now();
      f.times = {};
    }
    qsocket = null;
    if (!document.hidden)
      qreconnect = setTimeout(
        window.analysisConnect,
        Math.min(60000, 1000 * 2 ** qretry++) + Math.random() * 500,
      );
  };
};
function qalert(key, text) {
  if (document.hidden) return;
  const last = qa.alerts.get(key) || 0;
  if (Date.now() - last < 15 * 60000) return;
  qa.alerts.set(key, Date.now());
  showEventToast(text);
  if ("Notification" in window && Notification.permission === "granted")
    new Notification("NewsSignal analysis", { body: text });
}
function qalerts(sym, old, m) {
  if (!m.atr || !m.price) return;
  for (const z of m.levels) {
    if (
      Math.abs(m.price - z.p) <= m.atr * 0.05 &&
      Math.abs(old.price - z.p) > m.atr * 0.05
    )
      qalert(
        sym + ":" + z.labels.join(),
        sym + " touched " + z.labels.join(" + ") + " " + qnum(z.p),
      );
  }
  for (const [tf, t] of Object.entries(m.tf)) {
    const event = t?.structure.events.at(-1),
      previous = old.tf[tf]?.structure.events.at(-1);
    if (event && event.t !== previous?.t && Date.now() - event.t < 36e5)
      qalert(
        sym + tf + event.t,
        sym + " " + tf + " " + event.label + " " + qtime(event.t),
      );
    if (t?.fired && !old.tf[tf]?.fired)
      qalert(sym + tf + "squeeze", sym + " " + tf + " squeeze fired");
  }
}
window.analysisOverlay = function (series, x, y, min, max) {
  const m = qa.models[state.selected];
  if (!m) return "";
  let svg = "";
  const line = (p, color, label) => {
    if (p < min || p > max || !Number.isFinite(p)) return;
    svg += `<line x1="12" x2="740" y1="${y(p)}" y2="${y(p)}" stroke="${color}" opacity=".65" stroke-dasharray="5 4"/><text x="16" y="${y(p) - 3}" font-size="9" fill="${color}">${qesc(label)}</text>`;
  };
  if (qa.overlay.vwap)
    for (const v of m.vwaps.filter((v) => v.value)) {
      line(v.value, "#d8a84d", v.label);
      let weight = 0,
        total = 0,
        path = "",
        j = 0;
      const volume = isHL(assetOf(state.selected).yahoo);
      for (const b of qb(state.selected, "15m")) {
        if (b.t < v.t) continue;
        const w = volume ? b.v : 1;
        if (!(w > 0)) continue;
        weight += w;
        total += ((b.h + b.l + b.c) / 3) * w;
        if (b.t < series[0].t || b.t > series.at(-1).t) continue;
        while (j < series.length - 1 && series[j].t < b.t) j++;
        const value = total / weight;
        if (value < min || value > max) {
          path += " ";
          continue;
        }
        path +=
          (path.trim() && !path.endsWith(" ") ? "L" : "M") +
          x(j) +
          "," +
          y(value);
      }
      if (path.trim())
        svg += `<path d="${path}" fill="none" stroke="#d8a84d" stroke-width="1.3" opacity=".8"/>`;

      if (v.label === "Session")
        v.bands.forEach((p, i) =>
          line(
            p,
            "#64748b",
            (i < 2 ? "−" : "+") + (i === 0 || i === 3 ? "2" : "1") + "σ",
          ),
        );
    }
  if (qa.overlay.levels)
    for (const z of m.levels)
      line(z.p, z.p > m.price ? "#fb7185" : "#34d399", z.labels[0]);
  if (qa.overlay.structure) {
    const t =
        m.tf[
          { "1m": "15m", "5m": "15m", "1h": "1h", "1D": "1D" }[state.chartTf]
        ],
      events = [...(t?.structure.points || []), ...(t?.structure.events || [])];
    for (const p of events) {
      if (p.t < series[0].t || p.t > series.at(-1).t) continue;
      let i = series.findIndex((b) => b.t >= p.t);
      if (i < 0) continue;
      svg += `<text x="${x(i)}" y="${y(p.p) - 6}" fill="#93c5fd" font-size="10">${p.label}${p.dir ? " " + new Date(p.t).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</text>`;
    }
  }
  return svg;
};
function qinit() {
  const main = document.createElement("main");
  main.id = "analysisMain";
  main.className = "hidden";
  main.innerHTML = `<header><div><small>NEWSIGNAL / DECISION DESK · SAST</small><h1>Institutional analysis</h1></div><select id="qa-market" aria-label="Analysis market">${ASSETS.map((a) => `<option>${a.sym}</option>`).join("")}</select></header><p class="qa-note">Live observations, explicit gaps. Expand a section to inspect the trade filter. Decision aid, not advice.</p><div id="qa-content"></div>`;
  document.getElementById("cotMain").after(main);
  const tab = document.createElement("button");
  tab.id = "tabAnalysis";
  tab.textContent = "Analysis";
  tab.className = "text-[12px] font-bold px-3 py-1 rounded-md";
  document.getElementById("tabCot").after(tab);
  tab.parentElement.classList.add("qa-tabs");
  tab.parentElement.parentElement.classList.add("qa-header-row");
  const oldTab = showTab;
  showTab = function (t) {
    oldTab(t);
    qa.active = t === "analysis";
    main.classList.toggle("hidden", !qa.active);
    tab.className =
      "text-[12px] font-bold px-3 py-1 rounded-md " +
      (qa.active
        ? "bg-slate-700 text-white"
        : "text-slate-400 hover:bg-slate-800");
    if (qa.active) {
      document.getElementById("qa-market").value = state.selected;
      qrecompute();
    }
  };
  tab.onclick = () => showTab("analysis");
  document.getElementById("qa-market").onchange = (e) => {
    selectAsset(e.target.value);
    qrecompute();
  };
  const oldSelect = selectAsset;
  selectAsset = function (sym) {
    oldSelect(sym);
    if (qa.active) document.getElementById("qa-market").value = sym;
    qschedule(sym);
  };
  const block = document.createElement("div");
  block.id = "qa-signal-confluence";
  document
    .getElementById("sigSym")
    .closest(".bg-slate-900")
    .children[0].after(block);
  const controls = document.createElement("div");
  controls.className = "qa-controls";
  controls.innerHTML = ["vwap", "levels", "structure"]
    .map(
      (k) =>
        `<button data-overlay="${k}" aria-pressed="false">${k.toUpperCase()}</button>`,
    )
    .join("");
  document.getElementById("mainChart").before(controls);
  controls.querySelectorAll("button").forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.overlay;
        qa.overlay[k] = !qa.overlay[k];
        b.setAttribute("aria-pressed", String(qa.overlay[k]));
        b.style.color = qa.overlay[k] ? "#fbbf24" : "#94a3b8";
        renderChart();
      }),
  );
  document.getElementById("mainChart").addEventListener("click", (e) => {
    if (!qa.anchorMode) return;
    const svg = e.currentTarget,
      cd = state.chartCache[state.selected + ":" + state.chartTf],
      s = cd?.series || state.quotes[state.selected]?.series;
    if (!s?.length) return;
    const box = svg.getBoundingClientRect(),
      fraction = Math.max(
        0,
        Math.min(1, (((e.clientX - box.left) / box.width) * 800 - 12) / 728),
      ),
      i = Math.round(fraction * (s.length - 1));
    qa.anchors[state.selected] = s[i].t;
    qa.anchorMode = false;
    qa.overlay.vwap = true;
    qsave();
    qrecompute();
    showEventToast("Custom anchor: " + qtime(s[i].t));
  });
  const oldBoard = renderSignalBoard;
  renderSignalBoard = function () {
    oldBoard();
    qrenderSummaries();
  };
  const oldDetail = renderSignalDetail;
  renderSignalDetail = function () {
    oldDetail();
    qrenderSummaries();
  };
  qloadDesk();
  qrecompute();
  document.dispatchEvent(new Event("analysis-ready"));
  qpoll();
  setInterval(() => {
    if (!document.hidden) qpoll();
  }, 60000);
  setInterval(() => {
    if (!document.hidden) qschedule();
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(qreconnect);
      clearTimeout(qcomputeTimer);
      qcomputeTimer = null;
      qsocket?.close();
      clearInterval(qheartbeat);
    } else {
      window.analysisConnect();
      qpoll();
      qschedule();
    }
  });
}
qinit();
