// Walk-forward backtest of the channelSetup() setups. See README.md for method.
//   node backtest/run.mjs            # uses backtest/cache, writes results.json + TABLES.md (REPORT.md is the hand-written verdict)
//   node backtest/run.mjs --refresh  # re-download bars first

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { channelSetup } from "../public/lib/analysis.js";
import { LISTS } from "../public/lib/lists.js";
import { loadUniverse } from "./data.mjs";
import { DEFAULTS, WARMUP, features, classify, planLevels, runSymbol, runRandom, metrics, groupBy, mulberry32, mean } from "./engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRID = {
  lookback: [60, 120, 250],
  zPull: [-0.5, -1, -1.5, -2],
  atrMult: [1.5, 2, 3],
  target: ["T1", "T2"],
  maxHold: [20, 40],
};
const MIN_IS_TRADES = 100; // a config must have this many in-sample trades to be eligible for selection
const RANDOM_SEEDS = 50;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

const t0 = Date.now();
const { bars: universe, failed } = await loadUniverse({ refresh: process.argv.includes("--refresh") });
const symbols = Object.keys(universe).filter((s) => universe[s].length > WARMUP + 30);
const tooShort = Object.keys(universe).filter((s) => !symbols.includes(s));
console.log(`symbols: ${symbols.length} usable, too short: ${tooShort.join(",") || "none"}, failed: ${failed.map((f) => f.symbol).join(",") || "none"}`);

// ---- features per symbol per lookback ---------------------------------------
const FEATS = {};
for (const lb of GRID.lookback) {
  FEATS[lb] = {};
  for (const s of symbols) FEATS[lb][s] = features(universe[s], lb);
}
console.log(`features computed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- parity check: harness classifier == channelSetup() at defaults ----------
{
  const rnd = mulberry32(7);
  let checked = 0;
  for (let k = 0; k < 400; k++) {
    const s = symbols[Math.floor(rnd() * symbols.length)];
    const lb = GRID.lookback[Math.floor(rnd() * 3)];
    const bars = universe[s];
    const t = WARMUP + Math.floor(rnd() * (bars.length - WARMUP));
    const ref = channelSetup(bars.slice(0, t + 1), { lookback: lb });
    const f = FEATS[lb][s][t];
    const { setup, bias } = classify(f, { ...DEFAULTS, lookback: lb });
    const lv = planLevels(f, bias === "short" ? "short" : "long", DEFAULTS);
    const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (setup !== ref.setup || bias !== ref.bias || !close(Math.abs(ref.plan.entry - ref.plan.stop), lv.stopDist)
      || !close(ref.plan.target1, lv.target1) || !close(ref.plan.target2, lv.target2) || !close(ref.z, f.z) || !close(ref.composite, f.composite)) {
      console.error("PARITY MISMATCH", { s, t, lb, setup, bias, ref: { setup: ref.setup, bias: ref.bias, plan: ref.plan, z: ref.z }, lv, z: f.z });
      process.exit(1);
    }
    checked++;
  }
  console.log(`parity check vs channelSetup(): ${checked}/400 sampled bars identical`);
}

// ---- windows ----------------------------------------------------------------
const lastTime = Math.max(...symbols.map((s) => universe[s][universe[s].length - 1].time));
const firstTime = Math.min(...symbols.map((s) => universe[s][0].time));
const SPLIT = lastTime - 2 * 365.25 * 86400; // last ~2 years are out-of-sample
const firstSignal = universe.SPY[WARMUP].time;
const windows = {
  data: { from: day(firstTime), to: day(lastTime) },
  warmupBars: WARMUP,
  inSample: { from: day(firstSignal), to: day(SPLIT) },
  outOfSample: { from: day(SPLIT), to: day(lastTime) },
};
const period = (tr) => (tr.signalTime < SPLIT ? "IS" : "OOS");
console.log(`in-sample signals ${windows.inSample.from} → ${windows.inSample.to}; out-of-sample ${windows.outOfSample.from} → ${windows.outOfSample.to}`);

// ---- run one config over the universe ---------------------------------------
function runConfig(p) {
  const all = [];
  let skipped = 0;
  for (const s of symbols) {
    const r = runSymbol(s, universe[s], FEATS[p.lookback][s], p);
    all.push(...r.trades);
    skipped += r.skipped;
  }
  return { trades: all, skipped };
}

function breakdown(trades) {
  const out = {};
  for (const per of ["IS", "OOS"]) {
    const tr = trades.filter((t) => period(t) === per);
    const bySetup = Object.fromEntries(Object.entries(groupBy(tr, (t) => t.setup)).map(([k, v]) => [k, metrics(v)]));
    const byBias = Object.fromEntries(Object.entries(groupBy(tr, (t) => t.bias)).map(([k, v]) => [k, metrics(v)]));
    const byList = {};
    for (const list of Object.keys(LISTS)) {
      const lt = tr.filter((t) => LISTS[list].includes(t.symbol));
      byList[list] = { all: metrics(lt), long: metrics(lt.filter((t) => t.bias === "long")), short: metrics(lt.filter((t) => t.bias === "short")) };
    }
    out[per] = { all: metrics(tr), byBias, bySetup, byList };
  }
  return out;
}

// ---- 1. the shipped defaults (lookback 120, z<=-1, 2xATR) -------------------
const defaultsRuns = {};
for (const target of GRID.target) for (const maxHold of GRID.maxHold) {
  const p = { ...DEFAULTS, target, maxHold };
  const { trades, skipped } = runConfig(p);
  defaultsRuns[`${target}_hold${maxHold}`] = { params: p, skippedDegenerate: skipped, ...breakdown(trades), _trades: trades };
}

// ---- 2. parameter sweep (selection in-sample only) --------------------------
const sweep = [];
for (const lookback of GRID.lookback) for (const zPull of GRID.zPull) for (const atrMult of GRID.atrMult) for (const target of GRID.target) for (const maxHold of GRID.maxHold) {
  const p = { ...DEFAULTS, lookback, zPull, atrMult, target, maxHold };
  const { trades } = runConfig(p);
  const row = { params: { lookback, zPull, atrMult, target, maxHold } };
  for (const per of ["IS", "OOS"]) {
    const tr = trades.filter((t) => period(t) === per);
    row[per] = {
      all: metrics(tr),
      long: metrics(tr.filter((t) => t.bias === "long")),
      short: metrics(tr.filter((t) => t.bias === "short")),
      pullback: metrics(tr.filter((t) => t.setup === "Pullback in uptrend")),
    };
  }
  row._trades = trades;
  sweep.push(row);
}
console.log(`sweep: ${sweep.length} configs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const pick = (book) => {
  const eligible = sweep.filter((r) => (r.IS[book].n || 0) >= MIN_IS_TRADES);
  return eligible.sort((a, b) => (b.IS[book].tStat || -9) - (a.IS[book].tStat || -9))[0] || null;
};
const chosenLong = pick("long");
const chosenShort = pick("short");
const chosenAll = pick("all");

// rank stability: does in-sample ranking predict out-of-sample? (Spearman)
function spearman(rows, book) {
  const ok = rows.filter((r) => (r.IS[book].n || 0) >= 30 && (r.OOS[book].n || 0) >= 30);
  const rank = (key) => {
    const idx = ok.map((r, i) => [r[key][book].avgR, i]).sort((a, b) => a[0] - b[0]);
    const rk = new Array(ok.length);
    idx.forEach(([, i], r) => (rk[i] = r));
    return rk;
  };
  const a = rank("IS"), b = rank("OOS");
  const n = ok.length;
  if (n < 3) return null;
  const d2 = a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 1000) / 1000;
}

// ---- 3. baselines ------------------------------------------------------------
// Random-entry baseline matched to a strategy trade subset: same side, same
// symbols, same entry rate, same stop / time rules, target at the subset's
// median reward:risk ("sameRR") or none ("timeOnly"). Reports where the
// strategy's avg R sits in the distribution of random seeds.
function randomBaseline(p, mine, { side = "long", syms = symbols } = {}) {
  const eligible = syms.reduce((s, sym) => s + (universe[sym].length - WARMUP - 1), 0);
  const rate = mine.length / eligible;
  const rrs = mine.map((t) => t.rr).filter((x) => x != null).sort((a, b) => a - b);
  const rrMed = rrs.length ? rrs[rrs.length >> 1] : null;
  const out = { side, symbols: syms.length, rate: r2(rate), rrMult: rrMed == null ? null : r2(rrMed) };
  for (const [name, rrMult] of Object.entries({ sameRR: rrMed, timeOnly: null })) {
    const acc = { IS: [], OOS: [] };
    for (let seed = 1; seed <= RANDOM_SEEDS; seed++) {
      const tr = [];
      for (const s of syms) tr.push(...runRandom(s, universe[s], FEATS[p.lookback][s], p, { rate, rrMult, seed: seed * 7919 + s.length, side }));
      for (const per of ["IS", "OOS"]) acc[per].push(metrics(tr.filter((t) => period(t) === per)));
    }
    out[name] = {};
    for (const per of ["IS", "OOS"]) {
      const ms = acc[per];
      const xs = ms.map((m) => m.avgR || 0);
      const mu = mean(xs), sd = Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
      const strat = metrics(mine.filter((t) => period(t) === per));
      out[name][per] = {
        seeds: RANDOM_SEEDS, nPerSeed: r2(mean(ms.map((m) => m.n || 0))), avgR: r2(mu), avgR_sdAcrossSeeds: r2(sd),
        winRate: r2(mean(ms.map((m) => m.winRate || 0))),
        strategyN: strat.n || 0, strategyAvgR: strat.avgR ?? null,
        excessR: strat.n ? r2(strat.avgR - mu) : null,
        zVsRandom: strat.n && sd ? r2((strat.avgR - mu) / sd) : null,
        percentile: strat.n ? r2(xs.filter((x) => x < strat.avgR).length / xs.length) : null,
      };
    }
  }
  return out;
}

// Capital terms: one unit of capital per trade, summed % returns per symbol,
// time-in-market exposure, versus buy-and-hold of the same symbols.
function capitalTerms(trades, per) {
  const rows = symbols.map((s) => {
    const b = universe[s];
    const iSplit = b.findIndex((x) => x.time >= SPLIT);
    const barsIn = per === "IS" ? iSplit - WARMUP : b.length - iSplit;
    const tr = trades.filter((t) => t.symbol === s && period(t) === per);
    const sumRet = tr.reduce((x, t) => x + t.retPct, 0);
    const exposure = tr.reduce((x, t) => x + t.hold, 0) / barsIn;
    const bhRet = (per === "IS" ? b[iSplit].close / b[WARMUP].close : b[b.length - 1].close / b[iSplit].close) - 1;
    return { sumRetPct: sumRet, exposure, bhRetPct: bhRet * 100 };
  });
  const exposure = mean(rows.map((r) => r.exposure));
  const bhMean = mean(rows.map((r) => r.bhRetPct));
  return { meanSumRetPctPerSymbol: r2(mean(rows.map((r) => r.sumRetPct))), medianSumRetPctPerSymbol: r2(med(rows.map((r) => r.sumRetPct))), meanExposure: r2(exposure), buyHoldMeanRetPct: r2(bhMean), buyHoldMedianRetPct: r2(med(rows.map((r) => r.bhRetPct))), buyHoldScaledByExposurePct: r2(bhMean * exposure) };
}

function buyAndHold() {
  const out = { perSymbol: {}, byList: {}, universe: {} };
  const rets = { IS: [], OOS: [] };
  for (const s of symbols) {
    const b = universe[s];
    const iSplit = b.findIndex((x) => x.time >= SPLIT);
    const start = b[WARMUP].close, mid = b[iSplit].close, end = b[b.length - 1].close;
    const yrsIS = (b[iSplit].time - b[WARMUP].time) / (365.25 * 86400), yrsOOS = (b[b.length - 1].time - b[iSplit].time) / (365.25 * 86400);
    const r = { IS: mid / start - 1, OOS: end / mid - 1, cagrIS: (mid / start) ** (1 / yrsIS) - 1, cagrOOS: (end / mid) ** (1 / yrsOOS) - 1 };
    out.perSymbol[s] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));
    rets.IS.push(r.IS); rets.OOS.push(r.OOS);
  }
  for (const list of Object.keys(LISTS)) {
    const ss = LISTS[list].filter((s) => symbols.includes(s));
    out.byList[list] = { n: ss.length, meanRetIS: r2(mean(ss.map((s) => out.perSymbol[s].IS))), meanRetOOS: r2(mean(ss.map((s) => out.perSymbol[s].OOS))), medianRetOOS: r2(med(ss.map((s) => out.perSymbol[s].OOS))) };
  }
  out.universe = { n: symbols.length, meanRetIS: r2(mean(rets.IS)), meanRetOOS: r2(mean(rets.OOS)), medianRetOOS: r2(med(rets.OOS)), pctPositiveOOS: r2(rets.OOS.filter((x) => x > 0).length / rets.OOS.length) };
  return out;
}
const r2 = (x) => Math.round(x * 1e4) / 1e4;
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// Strategy expressed in portfolio terms: risk 1% of equity per trade, compounded by exit order.
function equityStats(trades, per) {
  const tr = trades.filter((t) => period(t) === per).sort((a, b) => a.exitTime - b.exitTime);
  let eq = 1, peak = 1, dd = 0;
  for (const t of tr) { eq *= 1 + 0.01 * t.R; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  const barsInMarket = tr.reduce((s, t) => s + t.hold, 0);
  const span = per === "IS" ? SPLIT - firstSignal : lastTime - SPLIT;
  const yrs = span / (365.25 * 86400);
  return { trades: tr.length, totalReturnAt1pctRisk: r2(eq - 1), cagrAt1pctRisk: r2(eq ** (1 / yrs) - 1), maxDrawdownPct: r2(dd), avgOpenPositions: r2(barsInMarket / (span / 86400 * (252 / 365.25))) };
}

const bh = buyAndHold();
const baselines = {};
{
  const d = defaultsRuns.T1_hold20;
  const tr = d._trades;
  baselines.defaults_T1_hold20 = {
    byBias: {
      long: randomBaseline(d.params, tr.filter((t) => t.bias === "long")),
      short: randomBaseline(d.params, tr.filter((t) => t.bias === "short"), { side: "short" }),
    },
    bySetup: Object.fromEntries(Object.entries(groupBy(tr, (t) => t.setup)).map(([setup, ts]) => [setup, randomBaseline(d.params, ts, { side: ts[0].bias })])),
    byListLong: Object.fromEntries(Object.keys(LISTS).map((list) => {
      const syms = LISTS[list].filter((s) => symbols.includes(s));
      return [list, randomBaseline(d.params, tr.filter((t) => t.bias === "long" && syms.includes(t.symbol)), { syms })];
    })),
  };
  const d2 = defaultsRuns.T2_hold20;
  baselines.defaults_T2_hold20 = { byBias: { long: randomBaseline(d2.params, d2._trades.filter((t) => t.bias === "long")) } };
  if (chosenLong) baselines.chosenLong = { byBias: { long: randomBaseline({ ...DEFAULTS, ...chosenLong.params }, chosenLong._trades.filter((t) => t.bias === "long")) } };
}
const capital = {
  defaults_T1_hold20_long: { IS: capitalTerms(defaultsRuns.T1_hold20._trades.filter((t) => t.bias === "long"), "IS"), OOS: capitalTerms(defaultsRuns.T1_hold20._trades.filter((t) => t.bias === "long"), "OOS") },
  defaults_T1_hold20_short: { IS: capitalTerms(defaultsRuns.T1_hold20._trades.filter((t) => t.bias === "short"), "IS"), OOS: capitalTerms(defaultsRuns.T1_hold20._trades.filter((t) => t.bias === "short"), "OOS") },
  chosenLong_long: chosenLong && { IS: capitalTerms(chosenLong._trades.filter((t) => t.bias === "long"), "IS"), OOS: capitalTerms(chosenLong._trades.filter((t) => t.bias === "long"), "OOS") },
};

// ---- assemble results -------------------------------------------------------
const strip = (row) => { const { _trades, ...rest } = row; return rest; };
const chosenDetail = (row) => row && {
  ...strip(row),
  full: breakdown(row._trades),
  equity: { IS: equityStats(row._trades.filter((t) => t.bias === "long"), "IS"), OOS: equityStats(row._trades.filter((t) => t.bias === "long"), "OOS") },
};
const results = {
  generatedAt: new Date().toISOString(),
  command: "node backtest/run.mjs",
  universe: { symbols, tooShort, failed, lists: Object.fromEntries(Object.keys(LISTS).map((k) => [k, LISTS[k].length])) },
  windows,
  rules: { entry: "next bar open", stop: "atrMult × ATR14 from fill", targets: "T1 = projected midline (horizon 20), T2 = midline ± 2σ", bothTouched: "stop", costBps: DEFAULTS.costBps, oneOpenTradePerSymbol: true },
  grid: GRID,
  selection: { criterion: "max in-sample t-stat of avg R", minInSampleTrades: MIN_IS_TRADES },
  defaults: Object.fromEntries(Object.entries(defaultsRuns).map(([k, v]) => [k, { ...strip(v), equityLong: { IS: equityStats(v._trades.filter((t) => t.bias === "long"), "IS"), OOS: equityStats(v._trades.filter((t) => t.bias === "long"), "OOS") } }])),
  sweep: sweep.map(strip),
  rankStability: { spearman_IS_vs_OOS_avgR: { long: spearman(sweep, "long"), short: spearman(sweep, "short"), pullback: spearman(sweep, "pullback"), all: spearman(sweep, "all") } },
  chosen: { long: chosenDetail(chosenLong), short: chosenDetail(chosenShort), all: chosenDetail(chosenAll) },
  baselines,
  capitalTerms: capital,
  buyAndHold: bh,
};
await writeFile(join(HERE, "results.json"), JSON.stringify(results, null, 1));

// ---- console + REPORT.md ----------------------------------------------------
const fmt = (m) => (!m || !m.n ? "n=0" : `n=${m.n}${m.n < 30 ? "*" : ""} win=${(m.winRate * 100).toFixed(0)}% avgR=${m.avgR.toFixed(3)} PF=${m.profitFactor === Infinity ? "inf" : m.profitFactor.toFixed(2)} t=${m.tStat.toFixed(2)} hold=${m.avgHold.toFixed(1)} maxDD=${m.maxDrawdownR.toFixed(1)}R`);
const row = (m) => (!m || !m.n ? "| 0 | – | – | – | – | – | – |" : `| ${m.n}${m.n < 30 ? "*" : ""} | ${(m.winRate * 100).toFixed(0)}% | ${m.avgR.toFixed(3)} | ${m.profitFactor === Infinity ? "inf" : m.profitFactor.toFixed(2)} | ${m.tStat.toFixed(2)} | ${m.avgHold.toFixed(1)} | ${m.maxDrawdownR.toFixed(1)} |`);
const HDR = "| n | win | avg R | PF | t | hold | maxDD R |";
const SEP = "|---|---|---|---|---|---|---|";
const L = [];
const say = (s = "") => { L.push(s); console.log(s); };

say(`# Backtest tables — channelSetup() setups (auto-generated; verdict in REPORT.md)\n`);
say(`Generated ${results.generatedAt} by \`${results.command}\`. Data ${windows.data.from} → ${windows.data.to}, ${symbols.length} symbols (${tooShort.length ? `too short, skipped: ${tooShort.join(", ")}` : "none skipped"}).`);
say(`In-sample signals ${windows.inSample.from} → ${windows.inSample.to}; **out-of-sample ${windows.outOfSample.from} → ${windows.outOfSample.to}**. Costs 5 bps/side. \`*\` = fewer than 30 trades, not significant.\n`);

say(`## 1. Shipped defaults (lookback 120, pullback z ≤ -1, stop 2×ATR)\n`);
for (const [k, v] of Object.entries(defaultsRuns)) {
  say(`### ${k.replace("_", ", ")}\n`);
  for (const per of ["IS", "OOS"]) {
    say(`**${per}** by setup\n`);
    say(`| setup | bias ${HDR.slice(1)}`); say(`|---|---${SEP.slice(4)}`);
    const bs = v[per].bySetup;
    for (const s of Object.keys(bs).sort((a, b) => (bs[b].n || 0) - (bs[a].n || 0))) {
      const bias = v._trades.find((t) => t.setup === s).bias;
      say(`| ${s} | ${bias} ${row(bs[s]).slice(1)}`);
    }
    say(`| **all long** | long ${row(v[per].byBias.long).slice(1)}`);
    say(`| **all short** | short ${row(v[per].byBias.short).slice(1)}`);
    say();
  }
  say(`OOS by list (long / short avg R, n):\n`);
  say(`| list | long n | long avg R | long t | short n | short avg R | short t |`); say(`|---|---|---|---|---|---|---|`);
  for (const [list, m] of Object.entries(v.OOS.byList)) say(`| ${list} | ${m.long.n || 0} | ${m.long.n ? m.long.avgR.toFixed(3) : "–"} | ${m.long.n ? m.long.tStat.toFixed(2) : "–"} | ${m.short.n || 0} | ${m.short.n ? m.short.avgR.toFixed(3) : "–"} | ${m.short.n ? m.short.tStat.toFixed(2) : "–"} |`);
  say();
}

say(`## 2. Parameter sweep (${sweep.length} configs; selected on in-sample t-stat, min ${MIN_IS_TRADES} IS trades)\n`);
say(`Rank stability (Spearman of IS vs OOS avg R across configs with ≥30 trades in both): long ${results.rankStability.spearman_IS_vs_OOS_avgR.long}, pullback ${results.rankStability.spearman_IS_vs_OOS_avgR.pullback}, short ${results.rankStability.spearman_IS_vs_OOS_avgR.short}, all ${results.rankStability.spearman_IS_vs_OOS_avgR.all}.\n`);
for (const book of ["long", "short"]) {
  const top = sweep.filter((r) => (r.IS[book].n || 0) >= MIN_IS_TRADES).sort((a, b) => (b.IS[book].tStat || -9) - (a.IS[book].tStat || -9)).slice(0, 10);
  say(`### Top 10 ${book} configs by in-sample t-stat, with their out-of-sample result\n`);
  say(`| lookback | zPull | ATR× | target | hold | IS n | IS avg R | IS t | **OOS n** | **OOS avg R** | OOS PF | OOS t |`); say(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of top) {
    const p = r.params, i = r.IS[book], o = r.OOS[book];
    say(`| ${p.lookback} | ${p.zPull} | ${p.atrMult} | ${p.target} | ${p.maxHold} | ${i.n} | ${i.avgR.toFixed(3)} | ${i.tStat.toFixed(2)} | **${o.n || 0}${(o.n || 0) < 30 ? "*" : ""}** | **${o.n ? o.avgR.toFixed(3) : "–"}** | ${o.n ? (o.profitFactor === Infinity ? "inf" : o.profitFactor.toFixed(2)) : "–"} | ${o.n ? o.tStat.toFixed(2) : "–"} |`);
  }
  say();
}
const oosPos = (book) => sweep.filter((r) => (r.OOS[book].n || 0) >= 30);
for (const book of ["long", "short", "pullback"]) {
  const rows = oosPos(book);
  const pos = rows.filter((r) => r.OOS[book].avgR > 0).length;
  const bestOOS = rows.sort((a, b) => b.OOS[book].avgR - a.OOS[book].avgR)[0];
  say(`- ${book}: ${pos}/${rows.length} configs with ≥30 OOS trades have positive OOS avg R; OOS avg R range ${rows.length ? `${rows[rows.length - 1].OOS[book].avgR.toFixed(3)} .. ${bestOOS.OOS[book].avgR.toFixed(3)}` : "–"} (best-OOS config, hindsight only: ${bestOOS ? JSON.stringify(bestOOS.params) : "–"}).`);
}
say();

for (const [name, row_] of [["long", chosenLong], ["short", chosenShort]]) {
  if (!row_) { say(`## 3. Chosen ${name} config: none eligible (no config reached ${MIN_IS_TRADES} IS trades)\n`); continue; }
  const d = results.chosen[name];
  say(`## 3${name === "long" ? "a" : "b"}. Chosen ${name} config (in-sample pick): ${JSON.stringify(row_.params)}\n`);
  say(`| period | book ${HDR.slice(1)}`); say(`|---|---${SEP.slice(4)}`);
  for (const per of ["IS", "OOS"]) say(`| ${per} | ${name} ${row(row_[per][name]).slice(1)}`);
  say();
  say(`OOS by setup:\n`);
  say(`| setup ${HDR.slice(1)}`); say(`|---${SEP.slice(4)}`);
  for (const [s, m] of Object.entries(d.full.OOS.bySetup)) say(`| ${s} ${row(m).slice(1)}`);
  say();
  say(`OOS by list (${name} side):\n`);
  say(`| list ${HDR.slice(1)}`); say(`|---${SEP.slice(4)}`);
  for (const [list, m] of Object.entries(d.full.OOS.byList)) say(`| ${list} ${row(m[name]).slice(1)}`);
  say();
  if (name === "long") say(`Long book at 1% equity risk per trade: IS ${JSON.stringify(d.equity.IS)}; OOS ${JSON.stringify(d.equity.OOS)}.\n`);
}

say(`## 4. Baselines — does the setup beat a random entry with the same rules?\n`);
say(`Random entries matched to each strategy subset: same side, same symbols, same entry rate, same stop and time exit; \`sameRR\` puts the target at the subset's median reward:risk, \`timeOnly\` has no target. ${RANDOM_SEEDS} seeds. **excess** = strategy avg R − random mean avg R; **pct** = share of random seeds the strategy beat (0.50 = no better than random, ≥0.95 = beats random at ~5% level).\n`);
const BH = `| subset | side | OOS n | strategy avg R | random avg R ± sd (sameRR) | excess | pct | random timeOnly avg R | excess vs timeOnly |`;
const BS = `|---|---|---|---|---|---|---|---|---|`;
const brow = (name, b) => {
  const s = b.sameRR.OOS, t = b.timeOnly.OOS;
  return `| ${name} | ${b.side} | ${s.strategyN}${s.strategyN < 30 ? "*" : ""} | ${s.strategyAvgR == null ? "–" : s.strategyAvgR.toFixed(3)} | ${s.avgR.toFixed(3)} ± ${s.avgR_sdAcrossSeeds.toFixed(3)} | ${s.excessR == null ? "–" : (s.excessR >= 0 ? "+" : "") + s.excessR.toFixed(3)} | ${s.percentile == null ? "–" : s.percentile.toFixed(2)} | ${t.avgR.toFixed(3)} ± ${t.avgR_sdAcrossSeeds.toFixed(3)} | ${t.excessR == null ? "–" : (t.excessR >= 0 ? "+" : "") + t.excessR.toFixed(3)} |`;
};
say(`### Defaults (lookback 120, z ≤ -1, 2×ATR, T1, hold 20) — OOS\n`);
say(BH); say(BS);
const b0 = baselines.defaults_T1_hold20;
say(brow("all long", b0.byBias.long));
say(brow("all short", b0.byBias.short));
for (const [setup, b] of Object.entries(b0.bySetup)) say(brow(setup, b));
for (const [list, b] of Object.entries(b0.byListLong)) say(brow(`${list} (long)`, b));
say(brow("all long, T2 hold 20", baselines.defaults_T2_hold20.byBias.long));
if (baselines.chosenLong) say(brow(`chosen long ${JSON.stringify(chosenLong.params)}`, baselines.chosenLong.byBias.long));
say();
say(`Same comparison in-sample (for reference):\n`);
say(`| subset | IS strategy avg R | IS random sameRR avg R ± sd | excess | pct |`); say(`|---|---|---|---|---|`);
for (const [name, b] of [["all long", b0.byBias.long], ["all short", b0.byBias.short], ...Object.entries(b0.bySetup)]) { const s = b.sameRR.IS; say(`| ${name} | ${s.strategyAvgR == null ? "–" : s.strategyAvgR.toFixed(3)} (n=${s.strategyN}) | ${s.avgR.toFixed(3)} ± ${s.avgR_sdAcrossSeeds.toFixed(3)} | ${s.excessR == null ? "–" : (s.excessR >= 0 ? "+" : "") + s.excessR.toFixed(3)} | ${s.percentile == null ? "–" : s.percentile.toFixed(2)} |`); }
say();
say(`### Buy & hold\n`);
say(`Equal-weight per symbol: universe mean IS ${(bh.universe.meanRetIS * 100).toFixed(1)}%, **OOS ${(bh.universe.meanRetOOS * 100).toFixed(1)}%** (median ${(bh.universe.medianRetOOS * 100).toFixed(1)}%, ${(bh.universe.pctPositiveOOS * 100).toFixed(0)}% of symbols up).\n`);
say(`| list | n | B&H IS mean | B&H OOS mean | B&H OOS median |`); say(`|---|---|---|---|---|`);
for (const [list, m] of Object.entries(bh.byList)) say(`| ${list} | ${m.n} | ${(m.meanRetIS * 100).toFixed(1)}% | ${(m.meanRetOOS * 100).toFixed(1)}% | ${(m.medianRetOOS * 100).toFixed(1)}% |`);
say();
say(`Capital terms (one unit of capital per trade, % returns summed per symbol, then averaged across symbols):\n`);
say(`| book | period | mean Σ trade % / symbol | median | time in market | B&H mean % | B&H × exposure |`); say(`|---|---|---|---|---|---|---|`);
for (const [k, v] of Object.entries(capital)) if (v) for (const per of ["IS", "OOS"]) { const c = v[per]; say(`| ${k} | ${per} | ${c.meanSumRetPctPerSymbol.toFixed(1)}% | ${c.medianSumRetPctPerSymbol.toFixed(1)}% | ${(c.meanExposure * 100).toFixed(0)}% | ${c.buyHoldMeanRetPct.toFixed(1)}% | ${c.buyHoldScaledByExposurePct.toFixed(1)}% |`); }
say();
say(`Default long book (T1, hold 20) compounded at 1% equity risk per trade (unrealistic: ~${results.defaults.T1_hold20.equityLong.OOS.avgOpenPositions.toFixed(0)} positions open at once): IS ${JSON.stringify(results.defaults.T1_hold20.equityLong.IS)}, OOS ${JSON.stringify(results.defaults.T1_hold20.equityLong.OOS)}.`);
say();
say(`Elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

await writeFile(join(HERE, "TABLES.md"), L.join("\n") + "\n");
console.log(`\nwrote ${join(HERE, "results.json")} and ${join(HERE, "TABLES.md")}`);
