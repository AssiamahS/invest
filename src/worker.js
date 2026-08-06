// invest — API proxy for Yahoo Finance (chart + symbol search).
// Static UI is served from /public via Workers Assets; only /api/* reaches this worker.

const YF_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]);

async function yfetch(path, cacheSeconds) {
  let body = "", status = 502;
  for (const host of YF_HOSTS) {
    const res = await fetch(host + path, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cf: { cacheTtl: cacheSeconds, cacheEverything: true },
    });
    body = await res.text();
    status = res.status;
    if (res.ok && body.startsWith("{")) break; // Cloudflare "error code: 1042" comes back as plain text
  }
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chart") {
      const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
      const range = url.searchParams.get("range") || "1y";
      if (!/^[A-Z0-9.^=\-]{1,12}$/.test(symbol)) {
        return json({ error: "bad symbol" }, 400);
      }
      if (!ALLOWED_RANGES.has(range)) return json({ error: "bad range" }, 400);
      const interval = range === "1mo" ? "1d" : range === "10y" || range === "max" ? "1wk" : "1d";
      return yfetch(
        `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&events=div%2Csplit`,
        120
      );
    }

    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q || q.length > 40) return json({ quotes: [] });
      return yfetch(
        `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`,
        600
      );
    }

    return json({ error: "not found" }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
