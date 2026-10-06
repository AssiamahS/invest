// Backtest engine for the regression-channel setups in public/lib/analysis.js.
//
// The classifier is re-implemented here from the SAME exported primitives
// (regress / compositeScore / atr) so the thresholds can be parameters; at the
// default thresholds it is bit-identical to channelSetup() — run.mjs asserts
// that on a random sample of bars before any number is reported.

import { regress, compositeScore, atr } from "../public/lib/analysis.js";

export const WARMUP = 250; // bars of history before the first signal (all 4 composite windows exist)
export const HORIZON = 20; // bars forward the channel is projected for targets (analysis.js default)

export const DEFAULTS = Object.freeze({
  lookback: 120, zPull: -1, atrMult: 2, target: "T1", maxHold: 20, costBps: 5,
  // fixed thresholds, mirrored from channelSetup()
  zBreak: -3, zStretch: 1.8, zRally: 1, zOversold: -2, zRangeLo: -1.5, zRangeHi: 1.5, compTrend: 0.2,
});

// Per-bar channel features for one lookback. Computed once per symbol per
// lookback; every parameter combination then classifies from these numbers.
export function features(bars, lookback) {
  const closes = bars.map((b) => b.close);
  const out = new Array(bars.length).fill(null);
  for (let t = WARMUP; t < bars.length; t++) {
    const n = t + 1;
    const look = Math.min(lookback, n);
    const reg = regress(closes.slice(n - look, n), false);
    const last = closes[t];
    const fit = reg.fit(reg.n - 1);
    const sigmaAbs = reg.sigma;
    const z = sigmaAbs ? (last - fit) / sigmaAbs : 0;
    // compositeScore only reads the last 250 bars, atr the last 15 — identical
    // result to passing bars.slice(0, t+1), much less copying.
    const { composite } = compositeScore(bars.slice(n - 250, n), false, 252);
    const range = atr(bars.slice(n - 15, n), 14);
    const fitFwd = reg.fit(reg.n - 1 + HORIZON);
    out[t] = { z, composite, fit, sigma: sigmaAbs, atr: range, fitFwd, r2: reg.r2, last };
  }
  return out;
}

// Same decision tree as channelSetup(), with the pullback z threshold exposed.
export function classify(f, p) {
  const { z, composite } = f;
  if (composite > p.compTrend) {
    if (z <= p.zBreak) return { setup: "Breaking down through uptrend channel", bias: "avoid" };
    if (z <= p.zPull) return { setup: "Pullback in uptrend", bias: "long" };
    if (z >= p.zStretch) return { setup: "Stretched above uptrend", bias: "wait" };
    return { setup: "Riding uptrend", bias: "hold" };
  }
  if (composite < -p.compTrend) {
    if (z >= p.zRally) return { setup: "Rally into downtrend resistance", bias: "short" };
    if (z <= p.zOversold) return { setup: "Oversold in downtrend", bias: "avoid" };
    return { setup: "Downtrend", bias: "avoid" };
  }
  if (z <= p.zRangeLo) return { setup: "Range low", bias: "long" };
  if (z >= p.zRangeHi) return { setup: "Range high", bias: "short" };
  return { setup: "Mid-range chop", bias: "wait" };
}

// Plan levels exactly as channelSetup() builds them (stop re-anchored to the
// real fill in simulate()).
export function planLevels(f, side, p) {
  const sign = side === "short" ? -1 : 1;
  return {
    stopDist: p.atrMult * f.atr,
    target1: f.fitFwd,
    target2: f.fitFwd + sign * 2 * f.sigma,
  };
}

// Simulate one trade signalled on bar t: fill at bar t+1 open, exit at stop /
// target / time. Both touched in one bar => stop (conservative). Gaps through a
// level fill at the open. 5 bps per side.
export function simulate(bars, t, side, stopDist, target, maxHold, costBps) {
  const sign = side === "short" ? -1 : 1;
  const c = costBps / 1e4;
  const e = t + 1;
  if (e >= bars.length) return null;
  const fill = bars[e].open;
  const stop = fill - sign * stopDist;
  if (!(stopDist > 0) || !isFinite(stop)) return null;
  // degenerate: target already behind price at the fill
  if (target !== Infinity && sign * (target - fill) <= 0) return { skipped: "target_behind_fill" };

  let exitPx = null, exitIdx = null, reason = null;
  for (let i = e; i < bars.length; i++) {
    const b = bars[i];
    const hitStop = sign > 0 ? b.low <= stop : b.high >= stop;
    const hitTgt = target !== Infinity && (sign > 0 ? b.high >= target : b.low <= target);
    if (i > e) {
      // gap through a level at the open
      if (sign * (b.open - stop) <= 0) { exitPx = b.open; exitIdx = i; reason = "stop_gap"; break; }
      if (target !== Infinity && sign * (b.open - target) >= 0) { exitPx = b.open; exitIdx = i; reason = "target_gap"; break; }
    }
    if (hitStop) { exitPx = stop; exitIdx = i; reason = hitTgt ? "stop_ambiguous" : "stop"; break; }
    if (hitTgt) { exitPx = target; exitIdx = i; reason = "target"; break; }
    if (i - t >= maxHold) { exitPx = b.close; exitIdx = i; reason = "time"; break; }
  }
  if (exitIdx == null) { exitIdx = bars.length - 1; exitPx = bars[exitIdx].close; reason = "eod"; }

  const fillNet = fill * (1 + sign * c);
  const exitNet = exitPx * (1 - sign * c);
  const pnl = sign * (exitNet - fillNet);
  return {
    entryIdx: e, exitIdx, hold: exitIdx - t, fill, exitPx, stop, target, reason,
    risk: stopDist, R: pnl / stopDist, retPct: (pnl / fill) * 100,
    rr: target === Infinity ? null : Math.abs(target - fill) / stopDist,
  };
}

// Walk one symbol forward. Signals only from completed bars; a new entry is
// skipped while a trade in that symbol is open.
export function runSymbol(symbol, bars, feats, p, { onlyBias = null } = {}) {
  const trades = [];
  let skipped = 0, signals = 0;
  let busyUntil = -1;
  for (let t = WARMUP; t < bars.length - 1; t++) {
    const f = feats[t];
    if (!f) continue;
    const { setup, bias } = classify(f, p);
    if (bias !== "long" && bias !== "short") continue;
    if (onlyBias && bias !== onlyBias) continue;
    signals++;
    if (t <= busyUntil) continue;
    const lv = planLevels(f, bias, p);
    const target = p.target === "T1" ? lv.target1 : p.target === "T2" ? lv.target2 : Infinity;
    const tr = simulate(bars, t, bias, lv.stopDist, target, p.maxHold, p.costBps);
    if (!tr) continue;
    if (tr.skipped) { skipped++; continue; }
    busyUntil = tr.exitIdx;
    trades.push({ symbol, setup, bias, signalIdx: t, signalTime: bars[t].time, exitTime: bars[tr.exitIdx].time, z: f.z, composite: f.composite, ...tr });
  }
  return { trades, skipped, signals };
}

// Random-entry baseline: same stop / time rules, target at a fixed R multiple
// (the strategy's median reward:risk) or none. Seeded so reruns match.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runRandom(symbol, bars, feats, p, { rate, rrMult, seed, side = "long" }) {
  const rnd = mulberry32(seed);
  const trades = [];
  let busyUntil = -1;
  const sign = side === "short" ? -1 : 1;
  for (let t = WARMUP; t < bars.length - 1; t++) {
    const f = feats[t];
    if (!f || rnd() >= rate) continue;
    if (t <= busyUntil) continue;
    const stopDist = p.atrMult * f.atr;
    const fill = bars[t + 1].open;
    const target = rrMult == null ? Infinity : fill + sign * rrMult * stopDist;
    const tr = simulate(bars, t, side, stopDist, target, p.maxHold, p.costBps);
    if (!tr || tr.skipped) continue;
    busyUntil = tr.exitIdx;
    trades.push({ symbol, setup: "random", bias: side, signalIdx: t, signalTime: bars[t].time, exitTime: bars[tr.exitIdx].time, ...tr });
  }
  return trades;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r4 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1e4) / 1e4);

// Trade-list metrics. Equity curve / drawdown are in R, ordered by exit time.
export function metrics(trades) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const Rs = trades.map((t) => t.R);
  const wins = Rs.filter((r) => r > 0), losses = Rs.filter((r) => r <= 0);
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = -losses.reduce((a, b) => a + b, 0);
  const avg = mean(Rs);
  const sd = Math.sqrt(mean(Rs.map((r) => (r - avg) ** 2)) * (n / Math.max(1, n - 1)));
  let eq = 0, peak = 0, maxDD = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime || a.signalTime - b.signalTime)) {
    eq += t.R;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, peak - eq);
  }
  const reasons = {};
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  return {
    n,
    winRate: r4(wins.length / n),
    avgR: r4(avg),
    expectancyR: r4(avg), // = winRate*avgWin - lossRate*|avgLoss|
    avgWinR: r4(mean(wins)),
    avgLossR: r4(mean(losses)),
    profitFactor: r4(grossLoss ? grossWin / grossLoss : Infinity),
    sumR: r4(Rs.reduce((a, b) => a + b, 0)),
    tStat: r4(sd ? (avg / sd) * Math.sqrt(n) : 0),
    avgHold: r4(mean(trades.map((t) => t.hold))),
    maxDrawdownR: r4(maxDD),
    avgRetPct: r4(mean(trades.map((t) => t.retPct))),
    medianRR: r4(median(trades.map((t) => t.rr).filter((x) => x != null))),
    exits: reasons,
    significant: n >= 30,
  };
}

export function groupBy(trades, key) {
  const g = {};
  for (const t of trades) (g[key(t)] ||= []).push(t);
  return g;
}

export { mean, median };
