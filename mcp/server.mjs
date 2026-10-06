// invest MCP — read-only analysis tools for any Claude Code chat.
// Same math as the web terminal (public/lib/analysis.js via src/worker.js),
// called in-process: no server has to be running for the tools to work.
//
// Every tool returns the raw numbers as structuredContent (validated against
// an outputSchema) plus the same JSON as a text block. Nothing here places
// orders or writes to disk/brokerage/account state; paper trading and
// watchlist edits are deliberately NOT exposed in this phase.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBars, getFundamentals, scenarios, SYMBOL_RE, SCAN_MAX } from "../src/worker.js";
import { channelSetup, compositeScore, project } from "../public/lib/analysis.js";
import { sma, rsi, pctChange } from "../public/lib/indicators.js";
import { LISTS } from "../public/lib/lists.js";
import { getWatchlist } from "../src/watchlist.mjs";
import { GLOSSARY } from "../public/lib/glossary.js";

const TERMINAL_URL = process.env.INVEST_URL || "http://127.0.0.1:8811";
const WATCHLIST_PATH = process.env.INVEST_WATCHLIST || join(homedir(), ".invest", "watchlist.json");
const DEFAULT_LOOKBACK = 120;
const MONTH_BARS = 21;
const MIN_BARS = 20; // smallest window compositeScore/channelSetup can fit

const server = new McpServer({ name: "invest", version: "2.0.0" });

// ---------- helpers ----------

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

// Keep the number of a finite value, otherwise null, so schema validation never
// trips on NaN/undefined coming out of Yahoo or a degenerate regression.
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, d = 4) => (num(v) == null ? null : +v.toFixed(d));

function normalizeSymbol(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) {
    throw new Error(`bad symbol "${raw}": expected 1-12 chars of A-Z 0-9 . ^ = - (e.g. AAPL, BRK-B, ^VIX)`);
  }
  return s;
}

function normalizeSymbols(list) {
  return [...new Set(list.map(normalizeSymbol))];
}

function resolveUniverse(symbols, list) {
  if (symbols?.length) return { list: null, symbols: normalizeSymbols(symbols).slice(0, SCAN_MAX) };
  const name = list || "watchlist";
  if (name === "watchlist") return { list: name, symbols: normalizeSymbols(getWatchlist()).slice(0, SCAN_MAX) };
  if (!LISTS[name]) throw new Error(`unknown list "${name}"; have: watchlist, ${Object.keys(LISTS).join(", ")}`);
  return { list: name, symbols: LISTS[name].slice(0, SCAN_MAX) };
}

// Result envelope: structured data for clients that read it, identical JSON as text for those that don't.
const ok = (data) => ({ structuredContent: data, content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: e?.message || String(e) }) }] });
const guarded = (fn) => async (args) => { try { return ok(await fn(args ?? {})); } catch (e) { return fail(e); } };

// Yahoo's 1y chart meta has no regularMarketPreviousClose (chartPreviousClose
// is the close before the RANGE start) so fall back to the second-to-last bar.
function dailyChange(meta, bars) {
  const px = num(meta.regularMarketPrice) ?? bars[bars.length - 1].close;
  const prev = num(meta.regularMarketPreviousClose) ?? (bars.length > 1 ? bars[bars.length - 2].close : null);
  return { price: px, previousClose: prev, abs: prev ? px - prev : null, pct: prev ? (px - prev) / prev : null };
}

function regressionBlock(s) {
  return {
    mid: round(s.fit), upper: round(s.fit + 2 * s.sigma), lower: round(s.fit - 2 * s.sigma),
    z: round(s.z), r2: round(s.r2), slopePctYr: round(s.trendPct, 2), sigma: round(s.sigma),
    lookback: s.lookback, horizon: s.horizon,
  };
}

// null when the setup isn't a long entry (shorts and hold/wait/avoid get no plan).
function planBlock(s) {
  const p = s.plan;
  if (!p) return null;
  const risk = p.entry - p.stop;
  const reward = p.target2 - p.entry;
  return {
    side: p.side, entry: round(p.entry), stop: round(p.stop), target1: round(p.target1), target2: round(p.target2),
    risk: round(risk), reward: round(reward), rr: round(p.rr),
  };
}

const setupBlock = (s) => ({ label: s.setup, bias: s.bias, score: round(s.score, 6), edge: s.edge });
const trendBlock = (composite, rows) => ({
  composite: round(composite), verdict: verdictOf(composite),
  timeframes: rows.map((r) => ({ w: r.w, pct: round(r.pct, 2), r2: round(r.r2), isUp: r.isUp })),
});
const verdictOf = (c) => (c > 0.6 ? "Strong Uptrend" : c > 0.2 ? "Uptrend" : c < -0.6 ? "Strong Downtrend" : c < -0.2 ? "Downtrend" : "Neutral");

function indicatorBlock(closes) {
  return { sma20: round(sma(closes, 20)), sma50: round(sma(closes, 50)), sma200: round(sma(closes, 200)), rsi14: round(rsi(closes, 14), 2) };
}

function scenarioBlock(sc) {
  if (!sc) return null;
  const one = (v) => ({
    revCagr: round(v.revCagr), margin: round(v.margin), exitPE: round(v.exitPE, 2),
    revenueEnd: round(v.revenueEnd, 0), netIncomeEnd: round(v.netIncomeEnd, 0), epsEnd: round(v.epsEnd, 2),
    priceEnd: round(v.priceEnd, 2), cagr: round(v.cagr),
  });
  return { bear: one(sc.bear), base: one(sc.base), bull: one(sc.bull) };
}

function fundamentalsBlock(f) {
  if (!f || f.error) return null;
  const out = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === "number" ? num(v) : v ?? null;
  return out;
}

// Price-only read shared by every tool: 1y of bars, the channel setup at
// `lookback`, the close series and today's change.
async function priceRead(symbol, lookback) {
  const { bars, meta } = await getBars(symbol, "1y");
  if (bars.length < MIN_BARS) throw new Error(`${symbol}: only ${bars.length} bars, need ${MIN_BARS}+`);
  return { bars, meta, s: channelSetup(bars, { lookback }), closes: bars.map((b) => b.close), chg: dailyChange(meta, bars) };
}

// One symbol, everything, from the bars up: this is what analyze_stock and
// compare_stocks share. Fundamentals failures are reported, not fatal.
async function fullRead(symbol, lookback, { withFundamentals = true } = {}) {
  const [{ bars, meta, s, closes, chg }, fundamentals] = await Promise.all([
    priceRead(symbol, lookback),
    withFundamentals ? getFundamentals(symbol).catch((e) => ({ error: e.message })) : Promise.resolve(null),
  ]);
  const { composite, rows } = compositeScore(bars);
  return {
    symbol: meta.symbol || symbol,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date(bars[bars.length - 1].time * 1000).toISOString(),
    price: round(chg.price), previousClose: round(chg.previousClose),
    change1d: { abs: round(chg.abs), pct: round(chg.pct) },
    change1m: round(pctChange(closes, MONTH_BARS)),
    yearHigh: round(Math.max(...closes)), yearLow: round(Math.min(...closes)),
    bars: bars.length,
    regression: regressionBlock(s),
    atr14: round(s.atr),
    indicators: indicatorBlock(closes),
    trend: trendBlock(composite, rows),
    setup: setupBlock(s),
    tradePlan: planBlock(s),
    fundamentals: fundamentalsBlock(fundamentals),
    fundamentalsError: fundamentals?.error || null,
    valuation: fundamentals && !fundamentals.error ? scenarioBlock(scenarios(fundamentals)) : null,
    chartUrl: `${TERMINAL_URL}/?s=${encodeURIComponent(symbol)}`,
  };
}

// ---------- schemas ----------

const Sym = z.string().min(1).max(12).describe("ticker, e.g. AAPL, BRK-B, ^VIX");
const Lookback = z.number().int().min(20).max(500).optional().describe(`regression window in daily bars, default ${DEFAULT_LOOKBACK}`);
const N = z.number().nullable();

const RegressionOut = z.object({
  mid: N, upper: N, lower: N, z: N, r2: N, slopePctYr: N, sigma: N, lookback: z.number(), horizon: z.number(),
}).describe("OLS channel on closes: mid = fitted value at the last bar, upper/lower = mid ± 2σ, z = (price-mid)/σ, slopePctYr = annualized slope");
const PlanOut = z.object({ side: z.enum(["long"]), entry: N, stop: N, target1: N, target2: N, risk: N, reward: N, rr: N }).nullable()
  .describe("long-only mechanical plan, null unless setup.bias is long: stop = entry − 2×ATR14, target1 = channel midline projected `horizon` bars ahead (null if not above entry), target2 = projected upper band, rr = reward/risk to target2");
const SetupOut = z.object({ label: z.string(), bias: z.enum(["long", "short", "hold", "wait", "avoid"]), score: N, edge: z.string().describe("backtest verdict on these setups — read before calling anything a buy") });
const TimeframeOut = z.object({ w: z.number(), pct: N, r2: N, isUp: z.boolean() });
const TrendOut = z.object({ composite: N, verdict: z.string(), timeframes: z.array(TimeframeOut) })
  .describe("composite in [-1,1] = R²-and-length weighted vote of 20/60/120/250-bar regressions");
const IndicatorsOut = z.object({ sma20: N, sma50: N, sma200: N, rsi14: N });
const ScenarioOut = z.object({ revCagr: N, margin: N, exitPE: N, revenueEnd: N, netIncomeEnd: N, epsEnd: N, priceEnd: N, cagr: N });
const ValuationOut = z.object({ bear: ScenarioOut, base: ScenarioOut, bull: ScenarioOut }).nullable();
const FundamentalsOut = z.record(z.string(), z.union([z.number(), z.string(), z.null()])).nullable()
  .describe("Yahoo quoteSummary fields (marketCap, revenue, revenueGrowth, margins, PE, EPS, FCF, analyst target...) or null when unavailable");

const FullReadShape = {
  symbol: z.string(), asOf: z.string(), price: N, previousClose: N,
  change1d: z.object({ abs: N, pct: N }), change1m: N, yearHigh: N, yearLow: N, bars: z.number(),
  regression: RegressionOut, atr14: N, indicators: IndicatorsOut, trend: TrendOut, setup: SetupOut, tradePlan: PlanOut,
  fundamentals: FundamentalsOut, fundamentalsError: z.string().nullable(), valuation: ValuationOut, chartUrl: z.string(),
};
const FullReadOut = z.object(FullReadShape);

// ---------- tools ----------

server.registerTool("analyze_stock", {
  title: "Analyze stock",
  description: "Full read on one ticker, as raw numbers: price and 1d/1m change, regression channel (mid/upper/lower/z/R²/slope), ATR14, SMA20/50/200 + RSI14, multi-timeframe trend composite, setup label + bias, mechanical trade plan (entry, 2×ATR stop, channel-projected targets, R:R), Yahoo fundamentals and bear/base/bull 5-year valuation scenarios. Read-only.",
  inputSchema: { symbol: Sym, lookback: Lookback },
  outputSchema: FullReadShape,
  annotations: READ_ONLY,
}, guarded(async ({ symbol, lookback }) => fullRead(normalizeSymbol(symbol), lookback || DEFAULT_LOOKBACK)));

const ScanRowOut = z.object({
  rank: z.number(), symbol: z.string(), price: N, change1dPct: N, change1mPct: N,
  setup: SetupOut, regression: RegressionOut, atr14: N, rsi14: N,
  trend: z.object({ composite: N, verdict: z.string() }), tradePlan: PlanOut,
});
const ScanShape = {
  lookback: z.number(), universe: z.object({ list: z.string().nullable(), symbols: z.array(z.string()) }),
  biasFilter: z.string().nullable(), ordering: z.string(), count: z.number(),
  results: z.array(ScanRowOut), errors: z.array(z.object({ symbol: z.string(), error: z.string() })),
};

server.registerTool("scan_market", {
  title: "Scan market",
  description: "Rank a universe by regression-channel setup score (best long pullbacks / short rallies first). Pass symbols, or a list: watchlist (default), megacaps, semis, growth, etfs. Deterministic order: score desc, then symbol asc. Each row carries the raw metrics the rank came from. Read-only.",
  inputSchema: {
    symbols: z.array(Sym).max(SCAN_MAX).optional(),
    list: z.enum(["watchlist", "megacaps", "semis", "growth", "etfs"]).optional(),
    lookback: Lookback,
    bias: z.enum(["long", "short", "hold", "wait", "avoid"]).optional().describe("only return rows with this bias"),
  },
  outputSchema: ScanShape,
  annotations: READ_ONLY,
}, guarded(async ({ symbols, list, lookback, bias }) => {
  const look = lookback || DEFAULT_LOOKBACK;
  const universe = resolveUniverse(symbols, list);
  if (!universe.symbols.length) throw new Error("empty universe");
  const settled = await Promise.all(universe.symbols.map(async (sym) => {
    try {
      const { s, closes, chg } = await priceRead(sym, look);
      return {
        symbol: sym, price: round(chg.price), change1dPct: round(chg.pct), change1mPct: round(pctChange(closes, MONTH_BARS)),
        setup: setupBlock(s), regression: regressionBlock(s), atr14: round(s.atr), rsi14: round(rsi(closes, 14), 2),
        trend: { composite: round(s.composite), verdict: s.verdict }, tradePlan: planBlock(s),
      };
    } catch (e) {
      return { symbol: sym, error: e.message };
    }
  }));
  const errors = settled.filter((r) => r.error);
  let rows = settled.filter((r) => !r.error);
  if (bias) rows = rows.filter((r) => r.setup.bias === bias);
  rows.sort((a, b) => ((b.setup.score ?? 0) - (a.setup.score ?? 0)) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { lookback: look, universe, biasFilter: bias || null, ordering: "setup.score desc, symbol asc", count: rows.length, results: rows, errors };
}));

const ProjectShape = {
  symbol: z.string(), price: N,
  inputs: z.object({
    revenue: N, shares: N, revenueGrowth: N, margin: N, exitPE: N, years: z.number(), shareChange: N,
    source: z.record(z.string(), z.enum(["user", "base-default"])),
  }).describe("exact numbers fed to project(); `source` says which knobs you set vs. which came from the base-case defaults"),
  projection: ScenarioOut.describe("revenueEnd = revenue×(1+g)^years, netIncomeEnd = revenueEnd×margin, epsEnd = netIncomeEnd/sharesEnd, priceEnd = epsEnd×exitPE, cagr = (priceEnd/price)^(1/years)-1"),
  scenarios: ValuationOut,
  currentFundamentals: z.object({ revenueGrowth: N, revenueGrowthNextYear: N, profitMargins: N, operatingMargins: N, trailingPE: N, forwardPE: N }),
};

server.registerTool("project_stock", {
  title: "Project stock",
  description: "Five-year (or N-year) price projection: revenue × (1+growth)^years × net margin ÷ shares × exit P/E. Any knob you omit comes from the base-case defaults derived from current fundamentals; the bear/base/bull defaults are returned too. Read-only.",
  inputSchema: {
    symbol: Sym,
    revenueGrowth: z.number().min(-0.9).max(3).optional().describe("revenue CAGR, e.g. 0.28 for 28%/yr"),
    margin: z.number().min(-1).max(1).optional().describe("net margin in the final year, e.g. 0.085"),
    exitPE: z.number().min(0).max(500).optional().describe("P/E the market pays on final-year EPS"),
    years: z.number().int().min(1).max(15).optional().describe("default 5"),
    shareChange: z.number().min(-0.5).max(0.5).optional().describe("share count change per year, e.g. -0.02 for 2% buybacks; default 0"),
  },
  outputSchema: ProjectShape,
  annotations: READ_ONLY,
}, guarded(async ({ symbol, revenueGrowth, margin, exitPE, years = 5, shareChange = 0 }) => {
  const sym = normalizeSymbol(symbol);
  const f = await getFundamentals(sym);
  const sc = scenarios(f);
  if (!sc) throw new Error(`${sym}: missing revenue/shares/price, cannot project (revenue=${f.revenue}, shares=${f.shares}, price=${f.price})`);
  const inputs = {
    revenue: f.revenue, shares: f.shares, price: f.price, years, shareChange,
    revCagr: revenueGrowth ?? sc.base.revCagr, margin: margin ?? sc.base.margin, exitPE: exitPE ?? sc.base.exitPE,
  };
  const p = project(inputs);
  return {
    symbol: sym, price: round(f.price),
    inputs: {
      revenue: num(f.revenue), shares: num(f.shares), revenueGrowth: round(inputs.revCagr, 6), margin: round(inputs.margin, 6),
      exitPE: round(inputs.exitPE, 4), years, shareChange: round(shareChange, 6),
      source: {
        revenueGrowth: revenueGrowth != null ? "user" : "base-default",
        margin: margin != null ? "user" : "base-default",
        exitPE: exitPE != null ? "user" : "base-default",
      },
    },
    projection: {
      revCagr: round(inputs.revCagr, 6), margin: round(inputs.margin, 6), exitPE: round(inputs.exitPE, 4),
      revenueEnd: round(p.revenueEnd, 0), netIncomeEnd: round(p.netIncomeEnd, 0), epsEnd: round(p.epsEnd, 2), priceEnd: round(p.priceEnd, 2), cagr: round(p.cagr),
    },
    scenarios: scenarioBlock(sc),
    currentFundamentals: {
      revenueGrowth: num(f.revenueGrowth), revenueGrowthNextYear: num(f.revenueGrowthNextYear),
      profitMargins: num(f.profitMargins), operatingMargins: num(f.operatingMargins), trailingPE: num(f.trailingPE), forwardPE: num(f.forwardPE),
    },
  };
}));

const CompareShape = {
  lookback: z.number(), ordering: z.string(),
  rows: z.array(z.object({
    rank: z.number(), symbol: z.string(), price: N, change1dPct: N, change1mPct: N,
    setup: SetupOut, trend: z.object({ composite: N, verdict: z.string() }), regression: RegressionOut, atr14: N, indicators: IndicatorsOut, tradePlan: PlanOut,
    fundamentals: z.object({
      marketCap: N, revenue: N, revenueGrowth: N, revenueGrowthNextYear: N, profitMargins: N, operatingMargins: N,
      trailingPE: N, forwardPE: N, pegRatio: N, freeCashflow: N, beta: N, analystTarget: N, analystRating: z.string().nullable(),
    }).nullable(),
    baseCaseCagr: N,
  })),
  errors: z.array(z.object({ symbol: z.string(), error: z.string() })),
};

server.registerTool("compare_stocks", {
  title: "Compare stocks",
  description: "Side-by-side raw metrics for 2-8 tickers: price/changes, setup + bias + score, trend composite, channel z/R²/slope, ATR, SMAs/RSI, key fundamentals (cap, growth, margins, P/E, PEG, FCF, beta, analyst target) and base-case 5y CAGR. Rows ordered by setup score desc, symbol asc. Read-only.",
  inputSchema: { symbols: z.array(Sym).min(2).max(8), lookback: Lookback },
  outputSchema: CompareShape,
  annotations: READ_ONLY,
}, guarded(async ({ symbols, lookback }) => {
  const look = lookback || DEFAULT_LOOKBACK;
  const syms = normalizeSymbols(symbols);
  if (syms.length < 2) throw new Error("need at least 2 distinct symbols");
  const settled = await Promise.all(syms.map((s) => fullRead(s, look).then((r) => ({ ok: r })).catch((e) => ({ symbol: s, error: e.message }))));
  const errors = settled.filter((r) => r.error).map(({ symbol, error }) => ({ symbol, error }));
  const pick = (f) => (f ? {
    marketCap: f.marketCap, revenue: f.revenue, revenueGrowth: f.revenueGrowth, revenueGrowthNextYear: f.revenueGrowthNextYear,
    profitMargins: f.profitMargins, operatingMargins: f.operatingMargins, trailingPE: f.trailingPE, forwardPE: f.forwardPE,
    pegRatio: f.pegRatio, freeCashflow: f.freeCashflow, beta: f.beta, analystTarget: f.analystTarget, analystRating: f.analystRating ?? null,
  } : null);
  const rows = settled.filter((r) => r.ok).map(({ ok: r }) => ({
    symbol: r.symbol, price: r.price, change1dPct: r.change1d.pct, change1mPct: r.change1m,
    setup: r.setup, trend: { composite: r.trend.composite, verdict: r.trend.verdict }, regression: r.regression, atr14: r.atr14,
    indicators: r.indicators, tradePlan: r.tradePlan, fundamentals: pick(r.fundamentals), baseCaseCagr: r.valuation?.base.cagr ?? null,
  }));
  rows.sort((a, b) => ((b.setup.score ?? 0) - (a.setup.score ?? 0)) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { lookback: look, ordering: "setup.score desc, symbol asc", rows, errors };
}));

server.registerTool("get_watchlist", {
  title: "Get watchlist",
  description: "Read the shared watchlist (~/.invest/watchlist.json, or $INVEST_WATCHLIST; built-in default when the file is absent). Read-only; this server has no tool that edits it.",
  inputSchema: {},
  outputSchema: { symbols: z.array(z.string()), count: z.number(), path: z.string(), source: z.enum(["file", "default"]) },
  annotations: { ...READ_ONLY, openWorldHint: false },
}, guarded(async () => {
  const symbols = getWatchlist();
  return { symbols, count: symbols.length, path: WATCHLIST_PATH, source: existsSync(WATCHLIST_PATH) ? "file" : "default" };
}));

const INDEXES = ["SPY", "QQQ", "IWM"];
const SECTORS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU"];
const OFFENSE = ["XLK", "XLY"], DEFENSE = ["XLP", "XLU", "XLV"];
const CtxRowOut = z.object({
  symbol: z.string(), price: N, change1dPct: N, change1mPct: N,
  trend: z.object({ composite: N, verdict: z.string() }), z: N, r2: N, slopePctYr: N, setup: z.string(), bias: z.string(),
  sma50: N, sma200: N, rsi14: N, aboveSma50: z.boolean().nullable(), aboveSma200: z.boolean().nullable(),
});
const CtxErr = z.object({ symbol: z.string(), error: z.string() });
const ContextShape = {
  asOf: z.string(), lookback: z.number(),
  indexes: z.array(CtxRowOut), sectors: z.array(CtxRowOut),
  vix: z.object({ level: N, change1dPct: N, change1mPct: N, zone: z.enum(["calm", "normal", "elevated", "stressed", "unknown"]) }).nullable(),
  tnx: z.object({ yieldPct: N, change1dPct: N, change1mPct: N, change1mAbs: N, trend: z.string() }).nullable(),
  regime: z.object({
    label: z.enum(["risk-on", "risk-off", "mixed"]), score: z.number(), maxScore: z.number(),
    rule: z.string(),
    votes: z.record(z.string(), z.number()),
    inputs: z.record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.null()])),
  }),
  errors: z.array(CtxErr),
};

server.registerTool("get_market_context", {
  title: "Get market context",
  description: "Market backdrop from the same channel math: SPY/QQQ/IWM and sector ETFs (XLK XLF XLE XLV XLI XLY XLP XLU) with trend composite, z, R², 1d/1m change, SMA50/200; ^VIX level and ^TNX 10y yield; plus a simple, fully-disclosed risk-on/off vote (index trends, VIX, offense-vs-defense sector 1m spread). Read-only.",
  inputSchema: {},
  outputSchema: ContextShape,
  annotations: READ_ONLY,
}, guarded(async () => {
  const look = DEFAULT_LOOKBACK;
  const all = [...INDEXES, ...SECTORS, "^VIX", "^TNX"];
  const got = {};
  const errors = [];
  await Promise.all(all.map(async (sym) => {
    try {
      const { s, closes, chg } = await priceRead(sym, look);
      const s50 = sma(closes, 50), s200 = sma(closes, 200);
      got[sym] = {
        symbol: sym, price: round(chg.price), change1dPct: round(chg.pct), change1mPct: round(pctChange(closes, MONTH_BARS)),
        trend: { composite: round(s.composite), verdict: s.verdict }, z: round(s.z), r2: round(s.r2), slopePctYr: round(s.trendPct, 2),
        setup: s.setup, bias: s.bias, sma50: round(s50), sma200: round(s200), rsi14: round(rsi(closes, 14), 2),
        aboveSma50: s50 == null ? null : chg.price > s50, aboveSma200: s200 == null ? null : chg.price > s200,
        _prevMonthClose: closes.length > MONTH_BARS ? closes[closes.length - 1 - MONTH_BARS] : null,
      };
    } catch (e) { errors.push({ symbol: sym, error: e.message }); }
  }));
  const row = (sym) => { const r = got[sym]; if (!r) return null; const { _prevMonthClose, ...rest } = r; return rest; };

  const vixRow = got["^VIX"];
  const vixLevel = vixRow?.price ?? null;
  const vix = vixRow ? {
    level: vixLevel, change1dPct: vixRow.change1dPct, change1mPct: vixRow.change1mPct,
    zone: vixLevel == null ? "unknown" : vixLevel < 15 ? "calm" : vixLevel < 20 ? "normal" : vixLevel < 30 ? "elevated" : "stressed",
  } : null;
  const tnxRow = got["^TNX"];
  const tnx = tnxRow ? {
    yieldPct: tnxRow.price, change1dPct: tnxRow.change1dPct, change1mPct: tnxRow.change1mPct,
    change1mAbs: tnxRow._prevMonthClose == null ? null : round(tnxRow.price - tnxRow._prevMonthClose),
    trend: tnxRow.trend.verdict,
  } : null;

  // Regime vote. Each input is one vote in {-1, 0, +1}; the raw inputs ship
  // with the answer so the caller can disagree with the thresholds.
  const votes = {};
  const trendVote = (sym) => { const c = got[sym]?.trend.composite; return c == null ? 0 : c > 0.2 ? 1 : c < -0.2 ? -1 : 0; };
  for (const sym of INDEXES) votes[`${sym}.trend`] = trendVote(sym);
  votes["SPY.aboveSma50"] = got.SPY?.aboveSma50 == null ? 0 : got.SPY.aboveSma50 ? 1 : -1;
  votes["VIX.level"] = vixLevel == null ? 0 : vixLevel < 20 ? 1 : vixLevel > 25 ? -1 : 0;
  const avg = (syms) => { const v = syms.map((s) => got[s]?.change1mPct).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const offense1m = avg(OFFENSE), defense1m = avg(DEFENSE);
  const spread = offense1m == null || defense1m == null ? null : round(offense1m - defense1m);
  votes["sectors.offenseMinusDefense1m"] = spread == null ? 0 : spread > 0.01 ? 1 : spread < -0.01 ? -1 : 0;
  const score = Object.values(votes).reduce((a, b) => a + b, 0);
  const maxScore = Object.keys(votes).length;
  const regime = {
    label: score >= 2 ? "risk-on" : score <= -2 ? "risk-off" : "mixed",
    score, maxScore,
    rule: "votes: index composite >0.2 → +1 / <-0.2 → -1 (SPY, QQQ, IWM); SPY above SMA50 ±1; VIX <20 → +1, >25 → -1; (XLK,XLY) minus (XLP,XLU,XLV) 1m change >+1% → +1, <-1% → -1. sum ≥ 2 risk-on, ≤ -2 risk-off, else mixed",
    votes,
    inputs: {
      spyComposite: got.SPY?.trend.composite ?? null, qqqComposite: got.QQQ?.trend.composite ?? null, iwmComposite: got.IWM?.trend.composite ?? null,
      spyAboveSma50: got.SPY?.aboveSma50 ?? null, spyAboveSma200: got.SPY?.aboveSma200 ?? null,
      vixLevel, tnxYieldPct: tnxRow?.price ?? null, offense1mPct: round(offense1m), defense1mPct: round(defense1m), offenseMinusDefense1mPct: spread,
    },
  };
  return {
    asOf: new Date().toISOString(), lookback: look,
    indexes: INDEXES.map(row).filter(Boolean), sectors: SECTORS.map(row).filter(Boolean),
    vix, tnx, regime, errors,
  };
}));

server.registerTool("show_chart", {
  title: "Show chart",
  description: "Return the invest terminal URL for a ticker (and optionally open it in the Mac browser when open=true). Display only: changes no data, account or file state.",
  inputSchema: { symbol: Sym, open: z.boolean().optional().describe("default false; true launches the URL with macOS `open`") },
  outputSchema: { symbol: z.string(), url: z.string(), opened: z.boolean() },
  annotations: { ...READ_ONLY, openWorldHint: false },
}, guarded(async ({ symbol, open = false }) => {
  const sym = normalizeSymbol(symbol);
  const url = `${TERMINAL_URL}/?s=${encodeURIComponent(sym)}`;
  if (open) execFile("open", [url]);
  return { symbol: sym, url, opened: !!open };
}));

server.registerTool("glossary", {
  title: "Glossary",
  description: "Plain-English definitions of the terms these tools return (bar, lookback, regression, channel, sigma, z, r2, slope, composite, atr, stop, target, rr, bps, volume, pe, backtest, support). Omit term to list them all. Use when teaching.",
  inputSchema: { term: z.string().optional() },
  outputSchema: { terms: z.array(z.object({ key: z.string(), name: z.string(), definition: z.string() })) },
  annotations: { ...READ_ONLY, openWorldHint: false },
}, guarded(async ({ term }) => {
  const q = (term || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const all = Object.entries(GLOSSARY).map(([key, [name, definition]]) => ({ key, name, definition }));
  const hits = q ? all.filter((t) => t.key === q || t.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q)) : all;
  if (!hits.length) throw new Error(`no glossary entry for "${term}"; have: ${Object.keys(GLOSSARY).join(", ")}`);
  return { terms: hits };
}));

// Teacher mode for any MCP host: same persona as the web Coach's Ask Claude.
server.registerPrompt("teach_chart", {
  title: "Teach me this chart",
  description: "Coach mode: read a ticker's chart with the student, define every term, ask what they think before giving a lean, then quiz them.",
  argsSchema: { symbol: z.string() },
}, ({ symbol }) => ({
  messages: [{
    role: "user",
    content: {
      type: "text",
      text: `Be my trading teacher for ${symbol.toUpperCase()}. Call analyze_stock (and glossary for any term I might not know), then:
1. Tell me the single most important thing on the chart in plain words, defining jargon (bar, lookback, σ, z, R², ATR, bps) the first time.
2. Walk the 20/60/120/250-bar timeframes and say where they agree or disagree.
3. Ask me what I think it does over the next 20 bars and WHY — wait for my answer.
4. After I answer, give the bull case, the bear case, your lean, and what would prove it wrong. Mention setup.edge (the backtest found no proven edge).
5. Finish with one multiple-choice pop-quiz question on this chart and wait for my answer.
Use only numbers from the tools. Education, not financial advice.`,
    },
  }],
}));

await server.connect(new StdioServerTransport());
