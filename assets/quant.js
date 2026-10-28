/* Pure, auditable indicator calculations. All inputs are observed OHLC candles. */
(function (root) {
  "use strict";
  const avg = (a) =>
    a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const ema = (v, n) => {
    if (!v.length) return [];
    let e = v[0];
    return v.map((x) => (e = (x * 2) / (n + 1) + e * (1 - 2 / (n + 1))));
  };
  function wilder(v, n) {
    const o = Array(v.length).fill(null);
    if (v.length < n) return o;
    let x = avg(v.slice(0, n));
    o[n - 1] = x;
    for (let i = n; i < v.length; i++) o[i] = x = (x * (n - 1) + v[i]) / n;
    return o;
  }
  function atr(s, n = 14) {
    return [
      null,
      ...wilder(
        s
          .slice(1)
          .map((b, i) =>
            Math.max(b.h - b.l, Math.abs(b.h - s[i].c), Math.abs(b.l - s[i].c)),
          ),
        n,
      ),
    ];
  }
  function adx(s, n = 14) {
    if (s.length < 2 * n) return null;
    const tr = [],
      p = [],
      m = [];
    for (let i = 1; i < s.length; i++) {
      const u = s[i].h - s[i - 1].h,
        d = s[i - 1].l - s[i].l;
      tr.push(
        Math.max(
          s[i].h - s[i].l,
          Math.abs(s[i].h - s[i - 1].c),
          Math.abs(s[i].l - s[i - 1].c),
        ),
      );
      p.push(u > d && u > 0 ? u : 0);
      m.push(d > u && d > 0 ? d : 0);
    }
    const a = wilder(tr, n),
      b = wilder(p, n),
      c = wilder(m, n),
      dx = [];
    let plus, minus;
    for (let i = n - 1; i < a.length; i++) {
      plus = a[i] ? (100 * b[i]) / a[i] : 0;
      minus = a[i] ? (100 * c[i]) / a[i] : 0;
      dx.push(
        plus + minus ? (100 * Math.abs(plus - minus)) / (plus + minus) : 0,
      );
    }
    return { adx: wilder(dx, n).at(-1), plus, minus };
  }
  function vwap(s, start, volume = true) {
    const a = s.filter((b) => b.t >= start);
    if (!a.length || s[0].t > start) return null;
    let w = 0,
      sum = 0,
      sq = 0;
    for (const b of a) {
      const v = volume ? b.v : 1;
      if (!(v > 0)) continue;
      const x = (b.h + b.l + b.c) / 3;
      w += v;
      sum += x * v;
      sq += x * x * v;
    }
    if (!w) return null;
    const value = sum / w,
      sd = Math.sqrt(Math.max(0, sq / w - value * value));
    return {
      value,
      sd,
      bands: [value - 2 * sd, value - sd, value + sd, value + 2 * sd],
      mode: volume
        ? "Volume weighted"
        : "Time weighted (no centralised volume)",
    };
  }
  function pivots(h, l, c) {
    const p = (h + l + c) / 3,
      r = h - l;
    return {
      P: p,
      R1: 2 * p - l,
      S1: 2 * p - h,
      R2: p + r,
      S2: p - r,
      R3: h + 2 * (p - l),
      S3: l - 2 * (h - p),
      H1: c + (r * 1.1) / 12,
      L1: c - (r * 1.1) / 12,
      H2: c + (r * 1.1) / 6,
      L2: c - (r * 1.1) / 6,
      H3: c + (r * 1.1) / 4,
      L3: c - (r * 1.1) / 4,
      H4: c + (r * 1.1) / 2,
      L4: c - (r * 1.1) / 2,
    };
  }
  function structure(s, k = 2) {
    const points = [];
    let hi = null,
      lo = null;
    for (let i = k; i < s.length - k; i++) {
      const b = s[i],
        a = s.slice(i - k, i + k + 1);
      if (a.every((v, j) => j === k || v.h < b.h)) {
        points.push({
          t: b.t,
          p: b.h,
          label: hi === null ? "H" : b.h > hi ? "HH" : "LH",
          side: "high",
        });
        hi = b.h;
      }
      if (a.every((v, j) => j === k || v.l > b.l)) {
        points.push({
          t: b.t,
          p: b.l,
          label: lo === null ? "L" : b.l > lo ? "HL" : "LL",
          side: "low",
        });
        lo = b.l;
      }
    }
    const hs = points.filter((p) => p.side === "high"),
      ls = points.filter((p) => p.side === "low");
    let dir =
      hs.at(-1)?.label === "HH" && ls.at(-1)?.label === "HL"
        ? 1
        : hs.at(-1)?.label === "LH" && ls.at(-1)?.label === "LL"
          ? -1
          : 0;
    const indexed = new Map();
    for (const p of points) {
      if (!indexed.has(p.t)) indexed.set(p.t, []);
      indexed.get(p.t).push(p);
    }
    const events = [];
    let bias = 0,
      lastH = null,
      lastL = null;
    for (let i = k * 2 + 1; i < s.length; i++) {
      const pivot = indexed.get(s[i - k - 1].t) || [];
      for (const p of pivot) {
        if (p.side === "high") lastH = { ...p, broken: false };
        else lastL = { ...p, broken: false };
      }
      for (const [p, d] of [
        [lastH, 1],
        [lastL, -1],
      ])
        if (p && !p.broken && (d > 0 ? s[i].c > p.p : s[i].c < p.p)) {
          events.push({
            t: s[i].t,
            p: p.p,
            label: bias && bias !== d ? "CHoCH" : "BOS",
            dir: d,
          });
          p.broken = true;
          bias = d;
        }
    }
    return { dir, points: points.slice(-40), events: events.slice(-20) };
  }
  function supertrend(s, n = 10, m = 3) {
    const a = atr(s, n);
    let upper,
      lower,
      dir = 1,
      value;
    for (let i = n; i < s.length; i++) {
      const mid = (s[i].h + s[i].l) / 2,
        u = mid + m * a[i],
        l = mid - m * a[i];
      if (upper === undefined) {
        upper = u;
        lower = l;
      } else {
        const ou = upper,
          ol = lower;
        upper = u < ou || s[i - 1].c > ou ? u : ou;
        lower = l > ol || s[i - 1].c < ol ? l : ol;
        if (dir < 0 && s[i].c > upper) dir = 1;
        else if (dir > 0 && s[i].c < lower) dir = -1;
      }
      value = dir > 0 ? lower : upper;
    }
    return value === undefined ? null : { dir, value };
  }
  function trend(s, k = 2) {
    if (s.length < 60) return null;
    const c = s.map((b) => b.c),
      a = atr(s),
      v = a.at(-1),
      d = adx(s),
      e20 = ema(c, 20).at(-1),
      e50 = ema(c, 50).at(-1),
      e200 = s.length >= 200 ? ema(c, 200).at(-1) : null,
      last = c.at(-1),
      st = structure(s, k),
      tr = supertrend(s),
      recent = a.filter(Number.isFinite).slice(-100);
    let squeeze = null,
      fired = false;
    function sq(i) {
      const x = c.slice(i - 19, i + 1),
        mid = avg(x),
        sd = Math.sqrt(avg(x.map((v) => (v - mid) ** 2))),
        kc = ema(c.slice(0, i + 1), 20).at(-1);
      return mid + 2 * sd < kc + 1.5 * a[i] && mid - 2 * sd > kc - 1.5 * a[i];
    }
    if (s.length > 35) {
      squeeze = sq(s.length - 1);
      fired = !squeeze && sq(s.length - 2);
    }
    const dir = Math.sign(e20 - e50),
      score = Math.round(
        100 *
          ([
            d?.adx >= 20,
            dir === st.dir,
            dir === tr?.dir,
            e200 !== null && Math.sign(last - e200) === dir,
          ].filter(Boolean).length /
            4),
      );
    return {
      atr: v,
      pctl:
        recent.length === 100
          ? (100 * recent.filter((x) => x <= v).length) / recent.length
          : null,
      adx: d,
      e20,
      e50,
      e200,
      sma50: avg(c.slice(-50)),
      sma200: s.length >= 200 ? avg(c.slice(-200)) : null,
      dir,
      structure: st,
      supertrend: tr,
      squeeze,
      fired,
      score,
      label: squeeze
        ? "Squeeze"
        : score >= 75
          ? "Strong trend"
          : score >= 50
            ? "Developing"
            : "Range",
    };
  }
  function aggregate(s, ms, offset = 0) {
    const map = new Map();
    for (const b of s) {
      const t = Math.floor((b.t - offset) / ms) * ms + offset;
      let a = map.get(t);
      if (!a) {
        a = { ...b, t, v: b.v ?? 0 };
        map.set(t, a);
      } else {
        a.h = Math.max(a.h, b.h);
        a.l = Math.min(a.l, b.l);
        a.c = b.c;
        a.v += b.v ?? 0;
      }
    }
    return [...map.values()];
  }
  function corr(a, b, n) {
    const ma = new Map(
        a.map((x) => [new Date(x.t).toISOString().slice(0, 10), x.c]),
      ),
      mb = new Map(
        b.map((x) => [new Date(x.t).toISOString().slice(0, 10), x.c]),
      ),
      days = [...ma.keys()].filter((k) => mb.has(k)).sort();
    const x = [],
      y = [];
    for (let i = 1; i < days.length; i++) {
      x.push(ma.get(days[i]) / ma.get(days[i - 1]) - 1);
      y.push(mb.get(days[i]) / mb.get(days[i - 1]) - 1);
    }
    if (x.length < n) return null;
    const xx = x.slice(-n),
      yy = y.slice(-n),
      u = avg(xx),
      v = avg(yy),
      den = Math.sqrt(
        xx.reduce((s, z) => s + (z - u) ** 2, 0) *
          yy.reduce((s, z) => s + (z - v) ** 2, 0),
      );
    return den
      ? xx.reduce((s, z, i) => s + (z - u) * (yy[i] - v), 0) / den
      : null;
  }
  root.Quant = {
    avg,
    ema,
    atr,
    adx,
    vwap,
    pivots,
    structure,
    trend,
    aggregate,
    corr,
  };
  root.runSelfTests = function () {
    const s = Array.from({ length: 60 }, (_, i) => ({
      t: i,
      o: i + 10,
      h: i + 12,
      l: i + 10,
      c: i + 11,
      v: 1,
    }));
    const results = [
      ["ATR constant true range", Math.abs(atr(s).at(-1) - 2) < 1e-9],
      ["ADX monotonic trend", Math.abs(adx(s).adx - 100) < 1e-9],
      [
        "VWAP weighted vector",
        Math.abs(
          vwap(
            [
              { t: 0, h: 10, l: 10, c: 10, v: 1 },
              { t: 1, h: 20, l: 20, c: 20, v: 3 },
            ],
            0,
          ).value - 17.5,
        ) < 1e-9,
      ],
      [
        "Classic pivot vector",
        pivots(12, 8, 10).R1 === 12 && pivots(12, 8, 10).S1 === 8,
      ],
      [
        "Insufficient history",
        adx(s.slice(0, 10)) === null && vwap(s, -1) === null,
      ],
    ];
    console.table(results.map(([test, pass]) => ({ test, pass })));
    return results.every((x) => x[1]);
  };
})(typeof window === "undefined" ? globalThis : window);
