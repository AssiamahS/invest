// End-to-end: spawn mcp/server.mjs over stdio with the SDK client and check the
// read-only contract. Network tests hit Yahoo for real, hence the long timeouts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { project } from "../public/lib/analysis.js";
import { getFundamentals } from "../src/worker.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = { timeout: 120_000 };
const EXPECTED_TOOLS = ["analyze_stock", "compare_stocks", "get_market_context", "get_watchlist", "project_stock", "scan_market", "show_chart"];
const MUTATING = /order|trade|buy|sell|close|add|remove/i;

let client;
before(async () => {
  client = new Client({ name: "invest-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [join(ROOT, "mcp", "server.mjs")], cwd: ROOT,
    env: { ...process.env, INVEST_URL: "http://127.0.0.1:8811" }, stderr: "pipe",
  }));
});
after(async () => { await client?.close(); });

const call = (name, args = {}) => client.callTool({ name, arguments: args });
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const ordered = (rows) => {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const sa = a.setup.score ?? 0, sb = b.setup.score ?? 0;
    assert.ok(sa > sb || (sa === sb && a.symbol < b.symbol), `order broken at ${a.symbol}(${sa}) -> ${b.symbol}(${sb})`);
  }
};

test("tool list is exactly the read-only set, every tool annotated read-only with an output schema", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
  for (const t of tools) {
    assert.ok(!MUTATING.test(t.name), `${t.name} looks mutating`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} missing readOnlyHint`);
    assert.equal(t.annotations?.destructiveHint, false, `${t.name} destructiveHint`);
    assert.equal(t.outputSchema?.type, "object", `${t.name} has no outputSchema`);
  }
});

test("analyze_stock returns schema-valid structured data for a live symbol", LIVE, async () => {
  const r = await call("analyze_stock", { symbol: "aapl" }); // lower-case on purpose: server normalizes
  assert.ok(!r.isError, r.content?.[0]?.text);
  const d = r.structuredContent; // client already validated this against outputSchema
  assert.equal(d.symbol, "AAPL");
  assert.ok(d.price > 0 && d.bars >= 200, `price ${d.price} bars ${d.bars}`);
  assert.equal(d.regression.lookback, 120);
  assert.ok(d.regression.lower < d.regression.mid && d.regression.mid < d.regression.upper);
  near(d.regression.upper - d.regression.mid, 2 * d.regression.sigma, 1e-3);
  assert.ok(d.atr14 > 0);
  assert.ok(d.indicators.sma20 > 0 && d.indicators.sma50 > 0 && d.indicators.sma200 > 0);
  assert.ok(d.indicators.rsi14 >= 0 && d.indicators.rsi14 <= 100);
  assert.ok(Math.abs(d.trend.composite) <= 1);
  assert.equal(d.trend.timeframes.length, 4);
  assert.ok(["long", "short", "hold", "wait", "avoid"].includes(d.setup.bias));
  const p = d.tradePlan;
  assert.equal(p === null, d.setup.bias !== "long" || p === null); // plans exist only for longs
  if (p) {
    near(p.risk, p.entry - p.stop, 1e-3);
    near(p.risk, 2 * d.atr14, 1e-3); // 2×ATR stop
    near(p.rr, p.reward / p.risk, 1e-3);
    assert.ok(p.target2 > p.entry && (p.target1 === null || p.target1 > p.entry));
  }
  assert.match(d.setup.edge, /no setup beat random entry/);
  assert.ok(d.fundamentals === null || typeof d.fundamentals.marketCap === "number");
  assert.ok(d.valuation === null || (d.valuation.bear.priceEnd < d.valuation.bull.priceEnd));
  // text block carries the same JSON for clients without structuredContent support
  assert.deepEqual(JSON.parse(r.content[0].text), d);
  assert.equal(d.chartUrl, "http://127.0.0.1:8811/?s=AAPL");
});

test("scan_market ranks deterministically: score desc then symbol asc, same order twice", LIVE, async () => {
  const symbols = ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLE", "GLD", "TLT"];
  const [a, b] = await Promise.all([call("scan_market", { symbols }), call("scan_market", { symbols })]);
  assert.ok(!a.isError && !b.isError, a.content?.[0]?.text);
  const ra = a.structuredContent.results, rb = b.structuredContent.results;
  assert.ok(ra.length + a.structuredContent.errors.length === symbols.length);
  assert.deepEqual(ra.map((r) => r.symbol), rb.map((r) => r.symbol));
  ordered(ra);
  assert.deepEqual(ra.map((r) => r.rank), ra.map((_, i) => i + 1));
  assert.equal(a.structuredContent.ordering, "setup.score desc, symbol asc");
  for (const r of ra) {
    assert.ok(typeof r.regression.z === "number" && typeof r.regression.r2 === "number" && typeof r.trend.composite === "number");
    assert.ok(["long", "short", "hold", "wait", "avoid"].includes(r.setup.bias));
  }
  // every non-long/short row scores exactly 0 by construction, so ties among them must be alphabetical
  const zeros = ra.filter((r) => r.setup.score === 0).map((r) => r.symbol);
  assert.deepEqual(zeros, [...zeros].sort());
});

test("scan_market honors a preset list and a bias filter", LIVE, async () => {
  const r = await call("scan_market", { list: "etfs", bias: "long" });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const d = r.structuredContent;
  assert.equal(d.universe.list, "etfs");
  assert.equal(d.biasFilter, "long");
  assert.ok(d.results.every((x) => x.setup.bias === "long"));
  ordered(d.results);
});

test("project_stock MELI 28%/8.5%/25x/5y agrees with project() on the live inputs", LIVE, async () => {
  const r = await call("project_stock", { symbol: "MELI", revenueGrowth: 0.28, margin: 0.085, exitPE: 25, years: 5 });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const d = r.structuredContent;
  assert.deepEqual(d.inputs.source, { revenueGrowth: "user", margin: "user", exitPE: "user" });
  const f = await getFundamentals("MELI");
  const expect = project({ revenue: f.revenue, shares: f.shares, price: f.price, years: 5, revCagr: 0.28, margin: 0.085, exitPE: 25, shareChange: 0 });
  near(d.projection.revenueEnd, expect.revenueEnd, 1);
  near(d.projection.epsEnd, expect.epsEnd, 0.01);
  near(d.projection.priceEnd, expect.priceEnd, 0.01);
  near(d.projection.cagr, expect.cagr, 1e-4);
  // the October 2026 video case (35.18B revenue, 50.7M shares) -> ~$120.8B revenue, ~$5,067 target.
  // Only enforce while Yahoo still reports that revenue/share base (a new quarter will move it).
  if (Math.abs(f.revenue - 35.18e9) < 0.3e9) near(d.projection.revenueEnd / 1e9, 120.8, 1.1);
  if (Math.abs(f.revenue - 35.18e9) < 0.3e9 && Math.abs(f.shares - 50.7e6) < 0.3e6) near(d.projection.priceEnd, 5067, 60);
  assert.ok(d.scenarios.bear.priceEnd < d.scenarios.base.priceEnd && d.scenarios.base.priceEnd < d.scenarios.bull.priceEnd);
});

test("malformed symbols are rejected with a clear error, no network", async () => {
  for (const bad of ["$$$", "TOOLONGSYMBOL123", "", "AA PL"]) {
    for (const tool of ["analyze_stock", "project_stock", "show_chart"]) {
      const r = await call(tool, { symbol: bad });
      assert.equal(r.isError, true, `${tool}(${JSON.stringify(bad)}) should error`);
      const msg = r.content[0].text;
      assert.match(msg, /bad symbol|too_small|String must contain/i, msg);
    }
  }
  const scan = await call("scan_market", { symbols: ["SPY", "$$$"] });
  assert.equal(scan.isError, true);
  assert.match(scan.content[0].text, /bad symbol.*\$\$\$/);
});

test("compare_stocks returns ranked side-by-side rows for 2-8 symbols and rejects 1", LIVE, async () => {
  const r = await call("compare_stocks", { symbols: ["NVDA", "AMD", "SPY"] });
  assert.ok(!r.isError, r.content?.[0]?.text);
  const d = r.structuredContent;
  assert.equal(d.rows.length + d.errors.length, 3);
  ordered(d.rows);
  for (const row of d.rows) {
    assert.ok(row.price > 0 && typeof row.regression.z === "number" && (row.tradePlan === null || typeof row.tradePlan.rr === "number"));
    // ETFs (SPY) report marketCap null; stocks report a number. Both are valid, undefined is not.
    assert.ok(row.fundamentals === null || row.fundamentals.marketCap === null || typeof row.fundamentals.marketCap === "number");
  }
  const one = await call("compare_stocks", { symbols: ["NVDA"] });
  assert.equal(one.isError, true);
});

test("get_watchlist reports symbols and where they came from", async () => {
  const r = await call("get_watchlist", {});
  assert.ok(!r.isError);
  const d = r.structuredContent;
  assert.ok(Array.isArray(d.symbols) && d.symbols.length > 0 && d.count === d.symbols.length);
  assert.ok(["file", "default"].includes(d.source));
  assert.ok(d.path.endsWith("watchlist.json"));
});

test("get_market_context returns indexes, sectors, VIX, TNX and a disclosed regime vote", LIVE, async () => {
  const r = await call("get_market_context", {});
  assert.ok(!r.isError, r.content?.[0]?.text);
  const d = r.structuredContent;
  assert.deepEqual(d.indexes.map((x) => x.symbol), ["SPY", "QQQ", "IWM"]);
  assert.deepEqual(d.sectors.map((x) => x.symbol), ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU"]);
  assert.ok(d.vix && d.vix.level > 0 && ["calm", "normal", "elevated", "stressed"].includes(d.vix.zone));
  assert.ok(d.tnx && d.tnx.yieldPct > 0);
  assert.ok(["risk-on", "risk-off", "mixed"].includes(d.regime.label));
  const sum = Object.values(d.regime.votes).reduce((a, b) => a + b, 0);
  assert.equal(d.regime.score, sum);
  assert.equal(d.regime.maxScore, Object.keys(d.regime.votes).length);
  assert.equal(d.regime.label, sum >= 2 ? "risk-on" : sum <= -2 ? "risk-off" : "mixed");
  assert.equal(d.regime.inputs.vixLevel, d.vix.level);
  assert.equal(d.errors.length, 0, JSON.stringify(d.errors));
});

test("show_chart only returns a URL unless asked to open", async () => {
  const r = await call("show_chart", { symbol: "meli" });
  assert.ok(!r.isError);
  assert.deepEqual(r.structuredContent, { symbol: "MELI", url: "http://127.0.0.1:8811/?s=MELI", opened: false });
});
