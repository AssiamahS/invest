// invest — shared analysis core. Plain ES module: the browser, the Worker and
// the local terminal server all import this, so every surface (chart, scanner,
// Claude's /api/analyze tool) computes the exact same numbers.

// OLS fit of closes against bar index. logFit regresses ln(price), which is the
// compounding-correct choice for multi-year windows.
export function regress(closes, logFit = false) {
  const y = logFit ? closes.map(Math.log) : closes;
  const n = y.length;
  const xbar = (n - 1) / 2;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - xbar) * (y[i] - ybar);
    sxx += (i - xbar) * (i - xbar);
    sst += (y[i] - ybar) * (y[i] - ybar);
  }
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const r = y[i] - (intercept + slope * i);
    sse += r * r;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  const band = (i, k) => {
    const v = intercept + slope * i + k * sigma;
    return logFit ? Math.exp(v) : v;
  };
  return { slope, intercept, sigma, r2, n, logFit, fit: (i) => band(i, 0), band };
}

export function annualizedPct(reg, lastFit, barsPerYear) {
  const perYear = reg.slope * barsPerYear;
  return reg.logFit ? (Math.exp(perYear) - 1) * 100 : (perYear / lastFit) * 100;
}

// 20/60/120/250-bar regressions -> per-window rows + composite score in [-1, 1].
// Each window votes its direction weighted by fit quality (R²) and length.
export function compositeScore(bars, logFit = false, barsPerYear = 252) {
  const windows = [20, 60, 120, 250].filter((w) => w <= bars.length);
  let score = 0, weight = 0;
  const rows = windows.map((w) => {
    const r = regress(bars.slice(bars.length - w).map((b) => b.close), logFit);
    const pct = annualizedPct(r, r.fit(r.n - 1), barsPerYear);
    score += Math.sign(r.slope) * r.r2 * w;
    weight += w;
    return { w, pct, r2: r.r2, isUp: r.slope > 0 };
  });
  return { composite: weight ? score / weight : 0, rows };
}

export function verdictLabel(c) {
  return c > 0.6 ? "Strong Uptrend" : c > 0.2 ? "Uptrend"
    : c < -0.6 ? "Strong Downtrend" : c < -0.2 ? "Downtrend" : "Neutral";
}

// Average true range over the last `period` bars. Falls back to close-to-close
// moves when a bar has no high/low (synthetic data, some indexes). Each bar's
// range is capped at 3× the median so one earnings gap can't set the stop.
export function atr(bars, period = 14) {
  const trs = [];
  for (let i = Math.max(1, bars.length - period); i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].close;
    trs.push(b.high != null && b.low != null
      ? Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc))
      : Math.abs(b.close - pc));
  }
  if (!trs.length) return 0;
  const sorted = [...trs].sort((a, b) => a - b);
  const cap = 3 * sorted[Math.floor(sorted.length / 2)];
  return trs.reduce((a, tr) => a + (cap > 0 ? Math.min(tr, cap) : tr), 0) / trs.length;
}

// Walk-forward backtest, 72 symbols, out-of-sample 2024-10 → 2026-10
// (backtest/REPORT.md): no setup beat a random long on the same stocks, and
// every short setup lost money. Shorts are demoted; longs ship with this note.
export const EDGE_NOTE = "Backtest 2024-26 (out-of-sample): no setup beat random entry; longs only matched market drift, shorts lost. Treat setups as location context, not a proven edge.";
export const MIN_BARS = 20;

// Price distance from the channel midline in σ units (σ in price terms).
function zAt(reg, i, price) {
  const f = reg.fit(i);
  const sigmaAbs = reg.logFit ? f * reg.sigma : reg.sigma;
  return { fit: f, sigmaAbs, z: sigmaAbs ? (price - f) / sigmaAbs : 0 };
}

// Classify where price sits in its regression channel relative to the
// multi-timeframe trend and build a mechanical trade plan around it.
// Targets use the channel projected `horizon` bars forward, because a sloped
// channel keeps moving while the trade plays out.
export function channelSetup(bars, { lookback = 120, logFit = false, barsPerYear = 252, horizon = 20 } = {}) {
  bars = bars.filter((b) => Number.isFinite(b.close) && (!logFit || b.close > 0));
  if (bars.length < MIN_BARS) throw new Error(`need at least ${MIN_BARS} valid bars, have ${bars.length}`);
  const look = Math.min(Math.max(MIN_BARS, Math.floor(lookback) || bars.length), bars.length);
  const win = bars.slice(bars.length - look);
  const reg = regress(win.map((b) => b.close), logFit);
  const last = bars[bars.length - 1].close;
  const { fit, sigmaAbs, z } = zAt(reg, reg.n - 1, last);
  const { composite } = compositeScore(bars, logFit, barsPerYear);
  const trendPct = annualizedPct(reg, fit, barsPerYear);
  const fwd = reg.n - 1 + horizon;

  let setup, bias;
  if (composite > 0.2) {
    if (z <= -3) { setup = "Breaking down through uptrend channel"; bias = "avoid"; }
    else if (z <= -1) { setup = "Pullback in uptrend"; bias = "long"; }
    else if (z >= 1.8) { setup = "Stretched above uptrend"; bias = "wait"; }
    else { setup = "Riding uptrend"; bias = "hold"; }
  } else if (composite < -0.2) {
    if (z >= 1) { setup = "Rally into downtrend resistance"; bias = "avoid"; }
    else if (z <= -2) { setup = "Oversold in downtrend"; bias = "avoid"; }
    else { setup = "Downtrend"; bias = "avoid"; }
  } else {
    if (z <= -1.5) { setup = "Range low"; bias = "long"; }
    else if (z >= 1.5) { setup = "Range high"; bias = "wait"; }
    else { setup = "Mid-range chop"; bias = "wait"; }
  }

  // Only long setups get a plan (shorts lost money in every backtest config).
  // The channel picks targets; the stop is 2×ATR from entry so one volatile
  // spike inside the window can't push it to a useless distance.
  // T1 = projected midline, T2 = projected upper band. A target at or below
  // entry is not a target, so T1 is dropped and the plan dies without T2.
  const range = atr(bars);
  const sigmaFwd = reg.logFit ? reg.fit(fwd) * reg.sigma : reg.sigma;
  let plan = null;
  if (bias === "long") {
    const stop = last - 2 * range;
    const t1 = reg.fit(fwd);
    const target2 = t1 + 2 * sigmaFwd;
    const risk = last - stop;
    if (target2 > last && risk > 0) {
      plan = { side: "long", entry: last, stop, target1: t1 > last ? t1 : null, target2, rr: (target2 - last) / risk };
    }
  }

  // Rank: trend quality × how far price is on the cheap side of its channel.
  const score = plan ? Math.max(composite, 0.25) * -z * reg.r2 : 0;

  return {
    setup, bias, score, z, composite, verdict: verdictLabel(composite),
    r2: reg.r2, trendPct, fit, sigma: sigmaAbs, atr: range, last, lookback: reg.n, horizon, plan,
    edge: EDGE_NOTE,
  };
}

// Five-year fundamentals projection (the "Qualtrim" method):
// revenue grows at revCagr, ends at `margin` net margin, share count drifts by
// shareChange/yr, and the market pays exitPE for the final earnings.
export function project({ revenue, revCagr, years = 5, margin, shares, exitPE, price, shareChange = 0 }) {
  const ok = [revenue, revCagr, years, margin, shares, exitPE, shareChange].every(Number.isFinite)
    && revenue > 0 && shares > 0 && years > 0 && revCagr > -1 && shareChange > -1;
  if (!ok) return { revenueEnd: null, netIncomeEnd: null, sharesEnd: null, epsEnd: null, priceEnd: null, cagr: null };
  const revenueEnd = revenue * Math.pow(1 + revCagr, years);
  const netIncomeEnd = revenueEnd * margin;
  const sharesEnd = shares * Math.pow(1 + shareChange, years);
  const epsEnd = netIncomeEnd / sharesEnd;
  const priceEnd = epsEnd * exitPE;
  const cagr = price > 0 && priceEnd > 0 ? Math.pow(priceEnd / price, 1 / years) - 1 : null;
  return { revenueEnd, netIncomeEnd, sharesEnd, epsEnd, priceEnd, cagr };
}

// Bear / base / bull defaults from Yahoo quoteSummary fields. The user can
// override every input in the Analyze tab; these are only starting points.
export function projectionDefaults(f) {
  const revGrowth = f.revenueGrowthNextYear ?? f.revenueGrowth ?? 0.08;
  const base = {
    revCagr: clamp(revGrowth * 0.75, -0.05, 0.4),
    margin: clamp(Math.max(f.profitMargins ?? 0.1, (f.operatingMargins ?? 0) * 0.8), 0.01, 0.5),
    exitPE: clamp(Math.min(f.forwardPE || 20, f.trailingPE || 20, 30), 8, 40),
  };
  const scale = (r, m, pe) => ({
    revCagr: clamp(base.revCagr * r, -0.05, 0.4), margin: clamp(base.margin * m, 0.01, 0.5), exitPE: clamp(base.exitPE * pe, 8, 40),
  });
  return { bear: scale(0.6, 0.8, 0.75), base, bull: scale(1.25, 1.2, 1.2) };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
