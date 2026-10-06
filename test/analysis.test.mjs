import { test } from "node:test";
import assert from "node:assert/strict";
import { regress, project, channelSetup, atr } from "../public/lib/analysis.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("regress recovers a perfect line", () => {
  const r = regress([10, 12, 14, 16, 18, 20]);
  near(r.slope, 2, 1e-9);
  near(r.r2, 1, 1e-9);
  near(r.fit(5), 20, 1e-9);
});

// The MercadoLibre case from the October 2026 portfolio video:
// 28% revenue CAGR for 5 years, 8.5% net margin, 25x exit P/E -> ~$5K, ~24%/yr.
test("project reproduces the MELI 2031 projection", () => {
  const p = project({
    revenue: 35.18e9, revCagr: 0.28, years: 5, margin: 0.085,
    shares: 50.7e6, exitPE: 25, price: 1730, shareChange: 0,
  });
  near(p.revenueEnd / 1e9, 120.8, 0.2);
  near(p.netIncomeEnd / 1e9, 10.27, 0.03);
  near(p.priceEnd, 5065, 15);
  near(p.cagr, 0.24, 0.005);
});

test("channelSetup flags a pullback in a clean uptrend as a long", () => {
  // steady uptrend with noise, last bar dropped to the bottom of the channel
  const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5 + (i % 2 ? 2 : -2));
  closes[249] = 100 + 249 * 0.5 - 5;
  const s = channelSetup(closes.map((c) => ({ close: c })), { lookback: 120 });
  assert.equal(s.bias, "long");
  assert.ok(s.z < -1, `z=${s.z}`);
  assert.ok(s.plan.stop < s.plan.entry && s.plan.target2 > s.plan.entry);
  assert.ok(s.plan.rr > 1);
  // ATR stop: 2x the average true range under entry, not a channel break
  near(s.plan.entry - s.plan.stop, 2 * s.atr, 1e-9);
  assert.ok(s.plan.entry - s.plan.stop < 12, `stop too wide: ${s.plan.entry - s.plan.stop}`);
});

test("atr uses true range when highs and lows exist", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({ high: 102 + i, low: 98 + i, close: 100 + i }));
  near(atr(bars, 14), 4, 1e-9);
});

test("channelSetup says wait when stretched above an uptrend", () => {
  const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5 + (i % 2 ? 2 : -2));
  closes[249] = 100 + 249 * 0.5 + 6;
  const s = channelSetup(closes.map((c) => ({ close: c })), { lookback: 120 });
  assert.equal(s.bias, "wait");
});
