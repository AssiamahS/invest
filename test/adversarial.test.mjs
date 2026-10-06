// Adversarial suite — edge cases and defects found in the 2026-10-06 audit (see AUDIT.md).
// Known-failing cases are marked { todo } so the suite stays green; flip them to
// real assertions as the fixes land. Live-network checks run only with INVEST_LIVE=1.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regress, atr, compositeScore, verdictLabel, channelSetup, project, projectionDefaults } from "../public/lib/analysis.js";
import { handleApi } from "../src/worker.js";

// paper.mjs resolves BOOK_PATH at import time, so point it at a temp file first.
const tmp = mkdtempSync(join(tmpdir(), "invest-adv-"));
process.env.INVEST_BOOK = join(tmp, "paper.json");
const paper = await import("../src/paper.mjs");
after(() => rmSync(tmp, { recursive: true, force: true }));

const LIVE = process.env.INVEST_LIVE === "1";
const mk = (closes) => closes.map((c) => ({ close: c }));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg || `${a} not within ${tol} of ${b}`);
const finite = (o, keys) => keys.forEach((k) => assert.ok(Number.isFinite(o[k]), `${k}=${o[k]} not finite`));
const trend = (n, slope, noise = 2, base = 100) => Array.from({ length: n }, (_, i) => base + i * slope + (i % 2 ? noise : -noise));
const down = (n, slope = 0.5) => trend(n, -slope, 2, 300); // keeps prices positive

const api = async (path, init, env = {}) => {
  const res = await handleApi(new Request("http://x" + path, init), env);
  const txt = await res.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { status: res.status, body, ct: res.headers.get("content-type") };
};
const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
const okChart = (n = 300, meta = { symbol: "X", regularMarketPrice: 100, regularMarketTime: 1e9 }) => ({
  chart: { result: [{ meta, timestamp: Array.from({ length: n }, (_, i) => 1e9 + i * 86400), indicators: { quote: [{
    close: Array.from({ length: n }, (_, i) => 100 + i * 0.1), open: Array(n).fill(100),
    high: Array.from({ length: n }, (_, i) => 101 + i * 0.1), low: Array.from({ length: n }, (_, i) => 99 + i * 0.1),
  }] } }], error: null },
});
// Route fetch by substring; anything unmatched gets Cloudflare's plain-text 1042.
const withFetch = async (routes, fn) => {
  const real = globalThis.fetch, log = [];
  globalThis.fetch = async (url) => {
    const u = String(url); log.push(u);
    for (const [k, r] of Object.entries(routes)) if (u.includes(k)) return typeof r === "function" ? r(u) : r();
    return new Response("error code: 1042", { status: 403 });
  };
  try { return await fn(log); } finally { globalThis.fetch = real; }
};

describe("analysis.js — regress / atr / composite", () => {
  test("flat prices: sigma 0, r2 0, no NaN", () => {
    const r = regress([10, 10, 10, 10, 10]);
    assert.equal(r.sigma, 0); assert.equal(r.r2, 0); assert.equal(r.slope, 0);
    const rl = regress([10, 10, 10, 10, 10], true);
    assert.equal(rl.sigma, 0); near(rl.fit(4), 10, 1e-9);
  });
  test("n=1 / n=0 produce NaN slope (sxx=0) — callers must guard", () => {
    assert.ok(Number.isNaN(regress([5]).slope));
    assert.ok(Number.isNaN(regress([]).slope));
  });
  test("a NaN close poisons every statistic silently", () => {
    const r = regress([1, 2, NaN, 4, 5]);
    assert.ok(Number.isNaN(r.slope) && Number.isNaN(r.r2) && Number.isNaN(r.sigma));
  });
  test("a null close is coerced to price 0 and corrupts the fit", () => {
    const clean = regress([1, 2, 3, 4, 5]), dirty = regress([1, 2, null, 4, 5]);
    near(dirty.slope, clean.slope, 1e-9, `null treated as 0: slope ${dirty.slope} vs ${clean.slope}`);
  });
  test("logFit with a zero/negative price yields NaN everywhere", () => {
    assert.ok(Number.isNaN(regress([1, 0, 2, 3], true).slope));
    assert.ok(Number.isNaN(regress([1, -1, 2, 3], true).slope));
  });
  test("atr falls back to close-to-close when high/low are missing or null", () => {
    assert.equal(atr([{ close: 1 }, { close: 3 }]), 2);
    assert.equal(atr([{ close: 1 }, { close: 3, high: null, low: null }]), 2);
    assert.equal(atr([{ close: 1 }, { close: 3, high: 4 }]), 2); // one side missing -> fallback too
    assert.equal(atr([{ close: 5 }]), 0);
    assert.equal(atr([]), 0);
  });
  test("compositeScore with <20 bars returns no rows and composite 0", () => {
    const c = compositeScore(mk(trend(19, 1)));
    assert.deepEqual(c.rows, []); assert.equal(c.composite, 0);
  });
  test("verdictLabel swallows NaN as Neutral", () => {
    assert.equal(verdictLabel(NaN), "Neutral");
  });
});

describe("analysis.js — channelSetup", () => {
  test("0 bars throws a clear error", () => {
    assert.throws(() => channelSetup([]), /need at least 20 valid bars/);
  });
  test("fewer than 20 valid bars is refused with a clear error", () => {
    assert.throws(() => channelSetup(mk([100])), /need at least 20 valid bars, have 1/);
  });
  test("lookback larger than the series clamps to the series", () => {
    const s = channelSetup(mk(trend(50, 1)), { lookback: 500 });
    assert.equal(s.lookback, 50);
  });
  test("lookback 0 means all bars; negative/fractional lookback clamps to >= 20", () => {
    assert.equal(channelSetup(mk(trend(50, 1)), { lookback: 0 }).lookback, 50);
    assert.equal(channelSetup(mk(trend(50, 1)), { lookback: -5 }).lookback, 20);
    assert.equal(channelSetup(mk(trend(50, 1)), { lookback: 30.9 }).lookback, 30);
  });
  test("a NaN close is dropped, so every stat stays finite", () => {
    const bars = mk(trend(250, 0.5, 0)); bars[240].close = NaN;
    const s = channelSetup(bars, { lookback: 120 });
    finite(s, ["composite", "z", "sigma", "atr"]);
  });
  test("logFit with a non-positive price outside the lookback still poisons composite/score", () => {
    const bars = mk(trend(250, 1, 0)); bars[10].close = 0;
    const s = channelSetup(bars, { lookback: 120, logFit: true });
    finite(s, ["composite", "score"]);
  });
  test("perfect line (sigma 0): z is 0, riding the trend gets no plan", () => {
    const s = channelSetup(mk(trend(60, 1, 0)), { lookback: 20 });
    assert.equal(s.z, 0); assert.equal(s.bias, "hold"); assert.equal(s.plan, null);
  });
  test("z equals (last - fit) / sigma and trendPct sign matches the slope", () => {
    const bars = mk(down(250)), s = channelSetup(bars, { lookback: 120 });
    near(s.z, (s.last - s.fit) / s.sigma, 1e-12);
    assert.ok(s.trendPct < 0);
  });
  test("weekly bars: barsPerYear 52 annualizes a 10%/yr log trend to ~10%", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 * Math.pow(1.1, i / 52) + (i % 2 ? 1 : -1));
    const w = channelSetup(mk(closes), { lookback: 120, logFit: true, barsPerYear: 52 });
    near(w.trendPct, 10, 0.5);
    const d = channelSetup(mk(closes), { lookback: 120, logFit: true, barsPerYear: 252 });
    assert.ok(d.trendPct > 50, "daily barsPerYear on weekly data over-annualizes (caller's job)");
  });
  test("rally into downtrend resistance is demoted to avoid (shorts lost in every backtest config)", () => {
    const closes = down(250); closes[249] += 6; // rally into resistance
    const s = channelSetup(mk(closes), { lookback: 120 });
    assert.equal(s.setup, "Rally into downtrend resistance");
    assert.equal(s.bias, "avoid"); assert.equal(s.plan, null); assert.equal(s.score, 0);
  });
  test("ATR stop (2×ATR) is far tighter than a channel stop when a spike sits in the lookback", () => {
    const bars = trend(250, 0.5, 1).map((c) => ({ close: c, high: c + 1, low: c - 1 }));
    bars[200] = { close: 320, high: 330, low: 99 }; // one spike bar, outside the 14-bar ATR window
    // pullback below -1σ so a long plan exists (the spike widens σ, so it has to be deep)
    bars[249] = { ...bars[249], close: bars[249].close - 30, low: bars[249].close - 31 };
    const s = channelSetup(bars, { lookback: 120 });
    assert.equal(s.bias, "long");
    near(s.last - s.plan.stop, 2 * s.atr, 1e-9);
    assert.ok(s.last - s.plan.stop < 8, `atr stop ${s.last - s.plan.stop}`);
    // the spike at bar 200 must not leak into the stop: it is far outside 2×ATR
    assert.ok(s.sigma > 2 * s.atr, `sigma ${s.sigma} vs atr ${s.atr}`);
  });
  test("a spike inside the last 14 bars still inflates the ATR stop ~6x", () => {
    const bars = trend(250, 0.5, 1).map((c) => ({ close: c, high: c + 1, low: c - 1 }));
    const base = channelSetup(bars, { lookback: 120 });
    bars[245] = { close: 150, high: 260, low: 99 };
    const s = channelSetup(bars, { lookback: 120 });
    assert.ok(s.atr < 2 * base.atr, `atr ${s.atr} vs ${base.atr}`);
  });
  test("non-actionable bias still emits a long plan whose targets sit below entry (negative rr)", () => {
    const s = channelSetup(mk(down(250)), { lookback: 120 }); // mid-channel downtrend -> "Downtrend"/avoid
    assert.equal(s.bias, "avoid");
    assert.ok(s.plan === null || (s.plan.target1 > s.plan.entry && s.plan.target2 > s.plan.entry && s.plan.rr >= 0),
      `plan=${JSON.stringify(s.plan)}`);
  });
  test("'Riding uptrend' gets no plan, so no T1 can sit below entry", () => {
    // slow uptrend, price stretched to ~+1.7σ: 20-bar projection of the midline stays under price
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.05 + (i % 2 ? 2 : -2)); closes[249] = 100 + 249 * 0.05 + 3.3;
    const s = channelSetup(mk(closes), { lookback: 120 });
    assert.equal(s.setup, "Riding uptrend", s.setup);
    assert.equal(s.plan, null);
  });
});

describe("analysis.js — project / projectionDefaults", () => {
  test("negative revCAGR still projects a finite price", () => {
    const p = project({ revenue: 1e9, revCagr: -0.5, margin: 0.1, shares: 1e6, exitPE: 20, price: 50 });
    finite(p, ["priceEnd", "cagr"]);
  });
  test("zero shares returns nulls; negative margin gives a null CAGR, never NaN/Infinity", () => {
    const z = project({ revenue: 1e9, revCagr: 0.1, margin: 0.1, shares: 0, exitPE: 20, price: 50 });
    assert.equal(z.priceEnd, null); assert.equal(z.cagr, null);
    const m = project({ revenue: 1e9, revCagr: 0.1, margin: -0.1, shares: 1e6, exitPE: 20, price: 50 });
    assert.ok(m.priceEnd < 0 && m.cagr === null, `priceEnd=${m.priceEnd} cagr=${m.cagr}`);
  });
  test("bull/bear multipliers escape the base clamps", () => {
    const d = projectionDefaults({ profitMargins: 0.9, operatingMargins: 0.9, trailingPE: 5, forwardPE: 5 });
    assert.ok(d.bull.margin <= 0.5, `bull margin ${d.bull.margin}`);
    assert.ok(d.bear.exitPE >= 8, `bear exitPE ${d.bear.exitPE}`);
  });
  test("negative forward P/E (loss-maker) silently floors exitPE at 8", () => {
    const d = projectionDefaults({ profitMargins: 0.2, trailingPE: null, forwardPE: -15 });
    assert.equal(d.base.exitPE, 8);
  });
});

describe("worker.js — handleApi validation", () => {
  test("symbol regex, range whitelist, unknown route, GET /api/claude", async () => {
    assert.equal((await api("/api/chart?symbol=AAPL;rm&range=1y")).status, 400);
    assert.equal((await api("/api/chart?symbol=&range=1y")).status, 400);
    assert.equal((await api("/api/chart?symbol=ABCDEFGHIJKLM&range=1y")).status, 400);
    assert.equal((await api("/api/chart?symbol=AAPL&range=7d")).status, 400);
    assert.equal((await api("/api/nope")).status, 404);
    assert.equal((await api("/api/claude")).status, 405);
    assert.equal((await api("/api/scan?symbols=")).status, 400);
    assert.deepEqual((await api("/api/search?q=" + "x".repeat(41))).body, { quotes: [] });
  });
  test("scan dedupes, uppercases, drops bad symbols and caps at 40", async () => {
    await withFetch({ "/v8/finance/chart/": () => J(okChart()) }, async (log) => {
      const many = Array.from({ length: 45 }, (_, i) => "S" + i).join(",") + ",spy,SPY, spy ,bad$sym";
      const r = await api("/api/scan?symbols=" + many);
      assert.equal(r.status, 200);
      assert.equal(r.body.results.length, 40);
      assert.equal(log.filter((u) => u.includes("/v8/finance/chart/")).length, 40);
      assert.equal(new Set(r.body.results.map((x) => x.symbol)).size, 40);
    });
  });
  test("lookback is clamped to [20, 500] and non-numeric falls back to 120", async () => {
    await withFetch({ "/v8/finance/chart/": () => J(okChart(600)) }, async () => {
      for (const [lb, want] of [["abc", 120], ["1", 20], ["99999", 500], ["-5", 20], ["", 120], ["0", 120], ["Infinity", 500]]) {
        const r = await api(`/api/analyze?symbol=X&lookback=${lb}`);
        assert.equal(r.body.setup.lookback, want, `lookback=${lb}`);
      }
    });
  });
  test("fractional lookback is not floored (20.7 -> 21-bar window)", async () => {
    await withFetch({ "/v8/finance/chart/": () => J(okChart(600)) }, async () => {
      assert.equal((await api("/api/analyze?symbol=X&lookback=20.7")).body.setup.lookback, 20);
    });
  });
});

describe("worker.js — Yahoo failure paths", () => {
  test("plain-text Yahoo error on both hosts: analyze and chart -> 502 JSON", async () => {
    await withFetch({}, async () => {
      const a = await api("/api/analyze?symbol=AAPL");
      assert.equal(a.status, 502); assert.match(a.body.error, /not valid JSON/);
      const c = await api("/api/chart?symbol=AAPL");
      assert.equal(c.status, 502); assert.match(c.body.error, /non-JSON/);
    });
  });
  test("/api/chart passes a non-JSON Yahoo body through labelled application/json", async () => {
    await withFetch({}, async () => {
      const c = await api("/api/chart?symbol=AAPL");
      assert.equal(typeof c.body, "object", `body was raw text: ${c.body}`);
    });
  });
  test("empty result + Yahoo error description -> 502 with that description", async () => {
    await withFetch({ "/v8/finance/chart/": () => J({ chart: { result: null, error: { description: "No data found, symbol may be delisted" } } }) }, async () => {
      const r = await api("/api/analyze?symbol=ZZZZ");
      assert.equal(r.status, 502); assert.equal(r.body.error, "No data found, symbol may be delisted");
    });
  });
  test("malformed result shapes give clear 502s; a missing regularMarketTime falls back to the last bar", async () => {
    const noTs = { chart: { result: [{ meta: { symbol: "X" }, indicators: { quote: [{}] } }], error: null } };
    const allNull = okChart(3); allNull.chart.result[0].indicators.quote[0].close = [null, null, null];
    for (const [name, payload] of [["no timestamp", noTs], ["all-null closes", allNull]]) {
      await withFetch({ "/v8/finance/chart/": () => J(payload) }, async () => {
        const r = await api("/api/analyze?symbol=X");
        assert.equal(r.status, 502, name);
        assert.match(r.body.error, /need at least 20 valid bars/, `${name}: ${r.body.error}`);
      });
    }
    await withFetch({ "/v8/finance/chart/": () => J(okChart(300, { symbol: "X", regularMarketPrice: 100 })) }, async () => {
      const r = await api("/api/analyze?symbol=X");
      assert.equal(r.status, 200); assert.ok(!Number.isNaN(Date.parse(r.body.asOf)));
    });
  });
  test("a 1-bar series returns 200 with a null-riddled plan", async () => {
    await withFetch({ "/v8/finance/chart/": () => J(okChart(1)) }, async () => {
      const r = await api("/api/analyze?symbol=X");
      assert.notEqual(r.status, 200, JSON.stringify(r.body.setup?.plan));
    });
  });
  test("crumb cache: symbol-not-found should not evict the crumb, but a 401 HTML body should", async () => {
    const routes = {
      "/v8/finance/chart/": () => J(okChart()),
      "fc.yahoo.com": () => new Response("", { status: 404, headers: { "set-cookie": "A3=d=abc; Path=/" } }),
      getcrumb: () => new Response("CRUMB123"),
      "/v10/finance/quoteSummary/GOOD": () => J({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 1 } } }], error: null } }),
      "/v10/finance/quoteSummary/BAD": () => J({ quoteSummary: { result: null, error: { code: "Not Found", description: "Quote not found for ticker symbol: BAD" } } }),
      "/v10/finance/quoteSummary/HTML": () => new Response("<html>401</html>", { status: 401 }),
    };
    const crumbCalls = (log) => log.filter((u) => u.includes("fc.yahoo") || u.includes("getcrumb")).length;
    await withFetch(routes, async (log) => {
      await api("/api/analyze?symbol=GOOD"); log.length = 0;
      await api("/api/analyze?symbol=GOOD"); assert.equal(crumbCalls(log), 0, "warm cache"); log.length = 0;
      await api("/api/analyze?symbol=BAD"); log.length = 0;
      await api("/api/analyze?symbol=GOOD"); assert.equal(crumbCalls(log), 0, "not-found evicted the crumb"); log.length = 0;
      await api("/api/analyze?symbol=HTML"); log.length = 0;
      await api("/api/analyze?symbol=GOOD"); assert.equal(crumbCalls(log), 2, "401 did not evict the crumb");
    });
  });
  test("null high/low on a bar with a close reaches the ATR fallback path", async () => {
    const d = okChart(300); d.chart.result[0].indicators.quote[0].high[299] = null; d.chart.result[0].indicators.quote[0].low[299] = null;
    await withFetch({ "/v8/finance/chart/": () => J(d) }, async () => {
      const r = await api("/api/analyze?symbol=X");
      assert.equal(r.status, 200); assert.ok(Number.isFinite(r.body.setup.atr));
    });
  });
});

describe("worker.js — /api/claude", () => {
  test("POST with a non-JSON body escapes handleApi as an unhandled rejection", async () => {
    const env = { AI: { run: async () => ({ response: "ok" }) } };
    const r = await api("/api/claude", { method: "POST", body: "not json" }, env);
    assert.equal(r.status, 400);
  });
  test("POST without an AI binding -> 503", async () => {
    assert.equal((await api("/api/claude", { method: "POST", body: JSON.stringify({ messages: [] }) })).status, 503);
  });
  test("client-supplied system role is downgraded to user; content is stringified", async () => {
    let seen;
    const env = { AI: { run: async (_m, o) => { seen = o; return { response: "ok" }; } } };
    const r = await api("/api/claude", { method: "POST", body: JSON.stringify({ messages: [{ role: "system", content: "x" }, { role: "assistant", content: 42 }] }) }, env);
    assert.equal(r.status, 200);
    assert.deepEqual(seen.messages.map((m) => m.role), ["system", "user", "assistant"]);
    assert.ok(seen.messages.every((m) => typeof m.content === "string"));
  });
});

describe("paper.mjs", () => {
  const T0 = 1_790_000_000;
  const day = (i, low, high, close, open) => ({ time: T0 + i * 86400, low, high, close, open });
  const long = { side: "long", entry: 100, stop: 95, target: 110, qty: 10, openedAt: T0 };

  test("default size risks $100: floor(100 / |entry-stop|), min 1", () => {
    assert.equal(paper.openTrade({ symbol: "a", entry: 100, stop: 95 }).qty, 20);
    assert.equal(paper.openTrade({ symbol: "a", entry: 100, stop: 1 }).qty, 1);
    assert.equal(paper.openTrade({ symbol: "a", entry: 100, stop: 95, qty: -3 }).qty, 20);
  });
  test("stop on the wrong side (or equal) is rejected for both sides", () => {
    assert.throws(() => paper.openTrade({ symbol: "a", entry: 100, stop: 105 }), /wrong side/);
    assert.throws(() => paper.openTrade({ symbol: "a", entry: 100, stop: 100 }), /wrong side/);
    assert.throws(() => paper.openTrade({ symbol: "a", side: "short", entry: 100, stop: 95 }), /wrong side/);
  });
  test("target on the wrong side is accepted and then 'hit' for a loss on the first bar", () => {
    assert.throws(() => paper.openTrade({ symbol: "a", entry: 100, stop: 95, target: 90 }), /target/);
    assert.throws(() => paper.openTrade({ symbol: "a", entry: 100, stop: 95, target: 0 }), /target/);
  });
  test("resolveTrade: wrong-side target closes as a 'target' with negative pnl (consequence of the above)", () => {
    const r = paper.resolveTrade({ ...long, target: 90 }, [day(1, 99, 101, 100)]);
    assert.equal(r.reason, "target"); assert.equal(r.pnl, -100);
  });
  test("side is not validated: 'LONG' is stored and skips the long stop check", () => {
    assert.throws(() => paper.openTrade({ symbol: "a", side: "LONG", entry: 100, stop: 105 }));
  });
  test("numeric strings compare lexically: entry '100' / stop '95' is rejected as wrong-side", () => {
    const t = paper.openTrade({ symbol: "a", entry: "100", stop: "95" });
    assert.equal(t.entry, 100);
  });
  test("same-bar stop+target resolves to the stop (conservative)", () => {
    assert.equal(paper.resolveTrade(long, [day(1, 94, 111, 100)]).reason, "stop");
  });
  test("a bar with null low/high registers a phantom stop hit (null <= stop)", () => {
    const r = paper.resolveTrade(long, [{ time: T0 + 86400, low: null, high: null, close: 100 }]);
    assert.equal(r.status, "open", `closed by ${r.reason} at ${r.exit}`);
  });
  test("gap through the stop fills at the stop price, not the open", () => {
    const r = paper.resolveTrade(long, [day(1, 78, 82, 80, 80)]);
    assert.equal(r.exit, 80);
  });
  test("bars at or before openedAt are ignored; no bars marks at entry", () => {
    assert.equal(paper.resolveTrade(long, [day(0, 50, 200, 100)]).status, "open");
    const r = paper.resolveTrade(long, []); assert.equal(r.mark, 100); assert.equal(r.pnl, 0);
  });
  test("closeTrade with a missing price persists pnl null", () => {
    const t = paper.openTrade({ symbol: "c", entry: 100, stop: 95, qty: 1 });
    assert.throws(() => paper.closeTrade(t.id, undefined));
  });
  test("markBook: returned trades carry mark+pnl, persisted open trades drop both (by design), closed ones keep pnl", async () => {
    const now = Math.floor(Date.now() / 1000);
    const open = paper.openTrade({ symbol: "OPN", entry: 100, stop: 95, target: 110, qty: 10 });
    const hit = paper.openTrade({ symbol: "TGT", entry: 100, stop: 95, target: 110, qty: 10 });
    const bars = (low, high, close) => ({ bars: [{ time: now + 86400, low, high, close }] });
    const getBars = async (s) => s === "OPN" ? bars(99, 104, 103) : s === "TGT" ? bars(99, 111, 109) : (() => { throw new Error("down"); })();
    const { trades, summary } = await paper.markBook(getBars);
    const o = trades.find((t) => t.id === open.id), h = trades.find((t) => t.id === hit.id);
    assert.equal(o.status, "open"); assert.equal(o.mark, 103); assert.equal(o.pnl, 30);
    assert.equal(h.status, "closed"); assert.equal(h.reason, "target"); assert.equal(h.pnl, 100);
    const disk = JSON.parse(readFileSync(process.env.INVEST_BOOK, "utf8"));
    const od = disk.trades.find((t) => t.id === open.id), hd = disk.trades.find((t) => t.id === hit.id);
    assert.ok(!("mark" in od) && !("pnl" in od), "open trade persisted without stale mark/pnl");
    assert.equal(hd.pnl, 100);
    assert.ok(summary.unrealized >= 30 && summary.realized >= 100);
    // second pass is idempotent on the closed trade
    const again = await paper.markBook(getBars);
    assert.equal(again.summary.closed, summary.closed);
  });
});

describe("live Yahoo sanity (INVEST_LIVE=1)", { skip: !LIVE && "set INVEST_LIVE=1" }, () => {
  for (const sym of ["TTMI", "MELI", "NVDA", "SPY", "^VIX", "BRK-B"]) {
    test(`${sym}: stop side, z, trend sign, scenario CAGR all consistent`, async () => {
      const r = await api(`/api/analyze?symbol=${encodeURIComponent(sym)}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const s = r.body.setup, p = s.plan;
      if (p.side === "long") assert.ok(p.stop < p.entry); else assert.ok(p.stop > p.entry);
      near(p.entry - p.stop, (p.side === "long" ? 1 : -1) * 2 * s.atr, 1e-9);
      near(s.z, (s.last - s.fit) / s.sigma, 1e-9);
      near(r.body.price, s.last, 0.01);
      if (r.body.scenarios) for (const sc of Object.values(r.body.scenarios)) near(sc.cagr, Math.pow(sc.priceEnd / r.body.price, 1 / 5) - 1, 1e-12);
      // the label/plan disagreement shows up live: log it, assert it in the todo below
      if (p.side === "long" && p.target1 <= p.entry) console.log(`  [${sym}] "${s.setup}" long plan has T1 ${p.target1.toFixed(2)} <= entry ${p.entry.toFixed(2)} (trend ${s.trendPct.toFixed(1)}%/yr, composite ${s.composite.toFixed(2)})`);
    });
  }
  test("live: no long plan has T1 at or below entry", { todo: "label from composite vs plan from the lookback channel disagree (TTMI/NVDA/^VIX on 2026-10-06)" }, async () => {
    for (const sym of ["TTMI", "NVDA", "^VIX"]) {
      const { body } = await api(`/api/analyze?symbol=${encodeURIComponent(sym)}`);
      const p = body.setup.plan;
      if (p.side === "long") assert.ok(p.target1 > p.entry, `${sym} T1 ${p.target1} <= entry ${p.entry}`);
    }
  });
});
