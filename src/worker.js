// invest — API for the terminal. Static UI is served from /public via Workers
// Assets; only /api/* reaches this worker. The same handler also runs inside
// server.mjs on the Mac, which adds a real Claude (claude -p) on /api/claude.

import { channelSetup, compositeScore, projectionDefaults, project, EDGE_NOTE } from "../public/lib/analysis.js";

const YF_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]);
export const SYMBOL_RE = /^[A-Z0-9.^=\-]{1,12}$/;
export const SCAN_MAX = 40;

async function yfetchText(path, cacheSeconds, headers = {}) {
  let body = "", status = 502;
  for (const host of YF_HOSTS) {
    const res = await fetch(host + path, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      cf: { cacheTtl: cacheSeconds, cacheEverything: true },
    });
    body = await res.text();
    status = res.status;
    if (res.ok && body.startsWith("{")) break; // Cloudflare "error code: 1042" comes back as plain text
  }
  return { body, status };
}

async function yfetch(path, cacheSeconds) {
  const { body, status } = await yfetchText(path, cacheSeconds);
  if (!body.startsWith("{")) return json({ error: `upstream returned non-JSON (${status})` }, 502);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function chartPath(symbol, range) {
  const interval = range === "1mo" ? "1d" : range === "10y" || range === "max" ? "1wk" : "1d";
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&events=div%2Csplit`;
}

export async function getBars(symbol, range = "1y") {
  const { body } = await yfetchText(chartPath(symbol, range), 120);
  const data = JSON.parse(body);
  const result = data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error((data.chart && data.chart.error && data.chart.error.description) || "no data");
  const q = result.indicators.quote[0];
  const bars = [];
  (result.timestamp || []).forEach((t, i) => {
    if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) return;
    bars.push({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], vol: q.volume ? q.volume[i] : 0 });
  });
  return { bars, meta: result.meta };
}

// quoteSummary needs a cookie + crumb pair. fc.yahoo.com hands out the A3
// cookie (on a 404), getcrumb trades it for a crumb. Both live ~a day.
let crumbCache = null;
async function yahooCrumb() {
  if (crumbCache && Date.now() - crumbCache.at < 6 * 3600e3) return crumbCache;
  const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
  const setCookie = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie().join("; ") : r.headers.get("set-cookie") || "";
  const cookie = (setCookie.match(/A3=[^;]+/) || [])[0];
  if (!cookie) throw new Error("no yahoo cookie");
  const c = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const crumb = (await c.text()).trim();
  if (!c.ok || !crumb || crumb.includes("<")) throw new Error("no yahoo crumb");
  crumbCache = { cookie, crumb, at: Date.now() };
  return crumbCache;
}

const raw = (o) => (o && typeof o === "object" ? o.raw : o) ?? null;

export async function getFundamentals(symbol) {
  const { cookie, crumb } = await yahooCrumb();
  const mods = "financialData,defaultKeyStatistics,summaryDetail,earningsTrend,price,assetProfile";
  const { body } = await yfetchText(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}&crumb=${encodeURIComponent(crumb)}`, 3600, { Cookie: cookie });
  // An HTML/plain-text body means the cookie or crumb went stale: drop it so
  // the next call re-handshakes. An empty result is just an unknown symbol.
  let parsed;
  try { parsed = JSON.parse(body); } catch { crumbCache = null; throw new Error("yahoo rejected the crumb"); }
  const r = parsed.quoteSummary?.result?.[0];
  if (!r) {
    if (/crumb|unauthorized/i.test(JSON.stringify(parsed.quoteSummary?.error || parsed.finance?.error || ""))) crumbCache = null;
    throw new Error("no fundamentals");
  }
  const fd = r.financialData || {}, ks = r.defaultKeyStatistics || {}, sd = r.summaryDetail || {}, pr = r.price || {};
  const nextYear = (r.earningsTrend?.trend || []).find((t) => t.period === "+1y");
  return {
    symbol, name: pr.longName || pr.shortName || symbol,
    sector: r.assetProfile?.sector || null, industry: r.assetProfile?.industry || null,
    price: raw(pr.regularMarketPrice), marketCap: raw(pr.marketCap),
    revenue: raw(fd.totalRevenue), revenueGrowth: raw(fd.revenueGrowth),
    revenueGrowthNextYear: raw(nextYear?.revenueEstimate?.growth),
    epsGrowthNextYear: raw(nextYear?.growth),
    grossMargins: raw(fd.grossMargins), operatingMargins: raw(fd.operatingMargins), profitMargins: raw(fd.profitMargins),
    netIncome: raw(ks.netIncomeToCommon), shares: raw(ks.sharesOutstanding),
    trailingEps: raw(ks.trailingEps), forwardEps: raw(ks.forwardEps),
    trailingPE: raw(sd.trailingPE), forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE), pegRatio: raw(ks.pegRatio),
    freeCashflow: raw(fd.freeCashflow), totalCash: raw(fd.totalCash), totalDebt: raw(fd.totalDebt),
    beta: raw(sd.beta), fiftyTwoWeekHigh: raw(sd.fiftyTwoWeekHigh), fiftyTwoWeekLow: raw(sd.fiftyTwoWeekLow),
    analystTarget: raw(fd.targetMeanPrice), analystRating: fd.recommendationKey || null, analystCount: raw(fd.numberOfAnalystOpinions),
  };
}

export function scenarios(f) {
  if (!f.revenue || !f.shares || !f.price) return null;
  const d = projectionDefaults(f);
  const out = {};
  for (const [k, s] of Object.entries(d)) {
    out[k] = { ...s, ...project({ revenue: f.revenue, years: 5, shares: f.shares, price: f.price, ...s }) };
  }
  return out;
}

// One symbol, everything: channel setup + trade plan, multi-timeframe trend,
// fundamentals and 5-year scenarios. This is the tool Claude calls.
export async function analyze(symbol, lookback) {
  const [{ bars, meta }, fundamentals] = await Promise.all([
    getBars(symbol, "1y"),
    getFundamentals(symbol).catch((e) => ({ error: e.message })),
  ]);
  const setup = channelSetup(bars, { lookback });
  const { rows } = compositeScore(bars);
  const closes = bars.map((b) => b.close);
  return {
    // The 1y chart leaves regularMarketPreviousClose empty; fall back to the prior bar.
    symbol: meta.symbol, price: meta.regularMarketPrice ?? closes[closes.length - 1],
    previousClose: meta.regularMarketPreviousClose ?? closes[closes.length - 2] ?? null,
    asOf: new Date((meta.regularMarketTime ?? bars[bars.length - 1].time) * 1000).toISOString(),
    yearHigh: Math.max(...closes), yearLow: Math.min(...closes),
    setup, timeframes: rows, fundamentals,
    scenarios: fundamentals.error ? null : scenarios(fundamentals),
  };
}

export async function scan(symbols, lookback) {
  const results = await Promise.all(symbols.map(async (s) => {
    try {
      const { bars, meta } = await getBars(s, "1y");
      const px = meta.regularMarketPrice || bars[bars.length - 1].close;
      const prev = meta.regularMarketPreviousClose || bars[bars.length - 2].close;
      return { symbol: s, price: px, chgPct: ((px - prev) / prev) * 100, ...channelSetup(bars, { lookback }) };
    } catch (e) {
      return { symbol: s, error: e.message };
    }
  }));
  return results.sort((a, b) => (b.score || 0) - (a.score || 0));
}

const CLAUDE_SYSTEM = `You are the analyst inside "invest", a thinkorswim-style stock terminal.
You get the terminal's computed analysis as JSON. Regression channels are OLS fits of closing price with ±2σ bands;
z = distance from the midline in σ; composite = multi-timeframe trend score in [-1,1]; plan = mechanical entry/stop/targets.
Answer like a sharp trader: lead with the call (setup + what you'd do), cite the actual numbers, name the risk that kills the trade.
Be brief. Never invent prices or fundamentals that are not in the data. This is analysis, not financial advice.
${EDGE_NOTE} Never call a setup a proven edge.`;

// Hosted fallback brain: Workers AI with the analysis inlined. The Mac
// terminal (server.mjs) replaces this route with Claude Code itself.
async function hostedClaude(request, env) {
  if (!env.AI) return json({ error: "no AI binding" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  const { messages = [], symbol } = body || {};
  let context = "";
  if (symbol && SYMBOL_RE.test(symbol)) {
    try { context = JSON.stringify(await analyze(symbol, 120)); } catch {}
  }
  const res = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      { role: "system", content: CLAUDE_SYSTEM + (context ? `\n\nCurrent symbol analysis:\n${context}` : "") },
      ...messages.slice(-10).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 4000) })),
    ],
    max_tokens: 900,
  });
  return json({ text: res.response || "", brain: "workers-ai" });
}

export async function handleApi(request, env = {}) {
  const url = new URL(request.url);
  const sym = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  const lookback = Math.min(500, Math.max(20, +(url.searchParams.get("lookback") || 120) || 120));

  try {
    switch (url.pathname) {
      case "/api/chart": {
        const range = url.searchParams.get("range") || "1y";
        if (!SYMBOL_RE.test(sym)) return json({ error: "bad symbol" }, 400);
        if (!ALLOWED_RANGES.has(range)) return json({ error: "bad range" }, 400);
        return yfetch(chartPath(sym, range), 120);
      }
      case "/api/search": {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q || q.length > 40) return json({ quotes: [] });
        return yfetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`, 600);
      }
      case "/api/fundamentals": {
        if (!SYMBOL_RE.test(sym)) return json({ error: "bad symbol" }, 400);
        const f = await getFundamentals(sym);
        return json({ ...f, scenarios: scenarios(f) }, 200, 3600);
      }
      case "/api/analyze": {
        if (!SYMBOL_RE.test(sym)) return json({ error: "bad symbol" }, 400);
        return json(await analyze(sym, lookback), 200, 120);
      }
      case "/api/scan": {
        const symbols = [...new Set((url.searchParams.get("symbols") || "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => SYMBOL_RE.test(s)))].slice(0, SCAN_MAX);
        if (!symbols.length) return json({ error: "no symbols" }, 400);
        return json({ results: await scan(symbols, lookback) }, 200, 120);
      }
      case "/api/claude":
        if (request.method !== "POST") return json({ error: "POST only" }, 405);
        return await hostedClaude(request, env);
    }
  } catch (e) {
    return json({ error: e.message }, 502);
  }
  return json({ error: "not found" }, 404);
}

export default { fetch: (request, env) => handleApi(request, env) };

function json(obj, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...(cacheSeconds ? { "Cache-Control": `public, max-age=${cacheSeconds}` } : {}),
    },
  });
}
