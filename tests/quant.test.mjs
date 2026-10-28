import test from "node:test";
import assert from "node:assert/strict";
import "../assets/quant.js";
const Q = globalThis.Quant;
test("known indicator vectors pass", () =>
  assert.equal(globalThis.runSelfTests(), true));
test("ATR includes overnight gaps, while flat ADX is zero", () => {
  const s = Array.from({ length: 50 }, (_, i) => ({
    t: i,
    h: 10,
    l: 10,
    c: 10,
    o: 10,
    v: 1,
  }));
  assert.equal(Q.adx(s).adx, 0);
  s[49] = { t: 49, h: 22, l: 20, c: 21, o: 20, v: 1 };
  assert.ok(Math.abs(Q.atr(s).at(-1) - 12 / 14) < 1e-12);
});
test("VWAP refuses incomplete anchors and does not invent volume", () => {
  const s = [
    { t: 1, h: 10, l: 10, c: 10 },
    { t: 2, h: 20, l: 20, c: 20 },
  ];
  assert.equal(Q.vwap(s, 0, false), null);
  assert.equal(Q.vwap(s, 1, true), null);
  assert.equal(Q.vwap(s, 1, false).value, 15);
});
test("correlation requires aligned observations and rejects flat series", () => {
  const a = Array.from({ length: 70 }, (_, i) => ({
    t: Date.UTC(2026, 0, i + 1),
    c: 100 + i * i,
  }));
  assert.ok(Math.abs(Q.corr(a, a, 60) - 1) < 1e-12);
  assert.equal(Q.corr(a.slice(0, 15), a, 20), null);
  assert.equal(
    Q.corr(
      a,
      a.map((x) => ({ ...x, c: 1 })),
      20,
    ),
    null,
  );
});
test("fractal pivots require right-hand confirmation", () => {
  const s = [1, 2, 5, 2, 1, 3].map((c, i) => ({ t: i, o: c, h: c, l: c, c }));
  assert.equal(Q.structure(s.slice(0, 3), 2).points.length, 0);
  assert.equal(Q.structure(s, 2).points[0].p, 5);
});
