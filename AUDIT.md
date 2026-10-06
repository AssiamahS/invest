# Adversarial audit — 2026-10-06

Scope: `public/lib/analysis.js`, `src/worker.js` (`handleApi`), `src/paper.mjs`. Node 20.20.0, run locally with real Yahoo reachable.
Every CONFIRMED item was reproduced; the repro lives in `test/adversarial.test.mjs` (known-failing cases are `{ todo }` so the suite stays green). Nothing below was applied — diffs are suggestions.

Run: `node --test test/adversarial.test.mjs` → 52 tests, 30 pass, 22 todo, 0 fail. With `INVEST_LIVE=1` → 59 tests, 36 pass, 23 todo, 0 fail.

---

## CONFIRMED

### H1 — `/api/claude` POST with a non-JSON body escapes `handleApi` as an unhandled rejection
`src/worker.js:203` — `return hostedClaude(request, env);` sits inside `try { ... }` but is not awaited, so the promise's rejection is never seen by the `catch` at :205. `hostedClaude` then does `await request.json()` (:153) *before* checking `env.AI`.

Repro: `handleApi(new Request("http://x/api/claude", { method: "POST", body: "not json" }), {})` → the call itself rejects with `SyntaxError: Unexpected token 'o', "not json" is not valid JSON` (my probe script crashed on it). In the Worker this is a thrown exception from `fetch()` (error 1101 / generic 500), not the 502 JSON every other path returns. Same for `{ "messages": "hi" }` once an AI binding exists (`"hi".slice(-10).map` is not a function).

```diff
-      case "/api/claude":
-        if (request.method !== "POST") return json({ error: "POST only" }, 405);
-        return hostedClaude(request, env);
+      case "/api/claude": {
+        if (request.method !== "POST") return json({ error: "POST only" }, 405);
+        return await hostedClaude(request, env);
+      }
```
and in `hostedClaude`:
```diff
-  const { messages = [], symbol } = await request.json();
-  if (!env.AI) return json({ error: "no AI binding" }, 503);
+  if (!env.AI) return json({ error: "no AI binding" }, 503);
+  let body; try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
+  const { messages = [], symbol } = body;
+  if (!Array.isArray(messages)) return json({ error: "messages must be an array" }, 400);
```

### H2 — Setup label and trade plan disagree: long plans with T1 *below* entry, and negative R:R
`public/lib/analysis.js:96-109` picks the label from `composite` (multi-timeframe vote) while `:114-125` builds the plan from the `lookback` channel. When the 120-bar slope and the composite disagree, the "long" plan projects the midline *down*. `sign` is +1 for every bias except `short`, so `hold` / `wait` / `avoid` still emit a long plan.

Live, 2026-10-06 (`/api/analyze`):
- **TTMI**: `"Riding uptrend"` / `hold`, composite **0.2016**, `trendPct` **-93.7 %/yr**. Plan: long, entry 133.14, stop 119.31, **T1 111.43 (below entry)**, T2 160.91, rr 2.01 (only positive because T2 = T1 + 2σ with σ = 24.74).
- **NVDA**: `"Riding uptrend"`, z 1.78, long plan **T1 224.54 < entry 238.90**, rr 0.47.
- **^VIX**: `"Mid-range chop"` / `wait`, long plan **T1 14.75 < entry 15.52**.
- **MELI**: `"Downtrend"` / `avoid`, composite -0.20, but the 120-bar channel is **+19.7 %/yr** — label and channel contradict.

Synthetic: a clean mid-channel downtrend (`300 - 0.5·i ± 2`) → `"Downtrend"` / `avoid`, plan `{side:"long", entry:177.5, stop:169.5, target1:165.57, target2:169.60, rr:-0.99}`. A negative rr is emitted as a number the MCP then prints.

Minimal fix: only emit a plan for actionable biases and refuse targets on the wrong side.
```diff
-  const sign = bias === "short" ? -1 : 1;
+  const actionable = bias === "long" || bias === "short";
+  const sign = bias === "short" ? -1 : 1;
   const range = atr(bars);
   const sigmaFwd = reg.logFit ? reg.fit(fwd) * reg.sigma : reg.sigma;
   const stop = last - sign * 2 * range;
   const target1 = reg.fit(fwd);
   const target2 = reg.fit(fwd) + sign * 2 * sigmaFwd;
   const risk = Math.abs(last - stop);
-  const plan = {
+  const sane = actionable && sign * (target1 - last) > 0 && sign * (target2 - last) > 0 && risk > 0;
+  const plan = !sane ? null : {
     side: sign > 0 ? "long" : "short",
     entry: last, stop, target1, target2,
-    rr: risk ? (sign * (target2 - last)) / risk : 0,
+    rr: (sign * (target2 - last)) / risk,
   };
```
(`mcp/server.mjs` `PlanOut` would need `.nullable()`; `scan` already sorts on `score`, not `plan`.) Also consider widening the dead band: TTMI's composite of 0.2016 flips the label at 0.2 with no hysteresis.

### H3 — `openTrade` accepts a target on the wrong side (or 0); `resolveTrade` then "hits" it on the first bar for a loss
`src/paper.mjs:40-42` validates the stop side but never the target. `:29` `hitTarget = t.target != null && b.high >= t.target` is immediately true.

Repro: `openTrade({symbol:"x", entry:100, stop:95, target:90})` → accepted. `resolveTrade({...long, target:90}, [{low:99,high:101,close:100}])` → `{status:"closed", reason:"target", exit:90, pnl:-100}`. `target: 0` → `exit: 0, pnl: -1000`. The MCP `open_paper_trade` tool takes `target: z.number().optional()` with no side check, so a mistyped target silently books a loss.
```diff
   if (side === "long" ? stop >= entry : stop <= entry) throw new Error("stop is on the wrong side of entry");
+  if (target != null && (!(target > 0) || (side === "long" ? target <= entry : target >= entry)))
+    throw new Error("target is on the wrong side of entry");
```

### M1 — Phantom stop fill on a bar whose high/low are `null`
`src/paper.mjs:28` — `b.low <= t.stop` with `b.low === null` is `null <= 95` → `true`. `getBars` (`src/worker.js:52`) drops bars with null `close`/`open` but passes null `high`/`low` straight through.

Repro: `resolveTrade(long, [{time, low:null, high:null, close:100}])` → `{status:"closed", reason:"stop", exit:95, pnl:-50}`.
```diff
   for (const b of bars) {
     if (b.time <= t.openedAt) continue;
+    if (!Number.isFinite(b.low) || !Number.isFinite(b.high)) continue;
```
or in `getBars`: `if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) return;`.

### M2 — Crumb cache evicted on "symbol not found", kept on a real 401
`src/worker.js:80-81` — `JSON.parse(body).quoteSummary?.result?.[0]` is falsy for *any* missing result, including `"Quote not found for ticker symbol: BAD"`, so one unknown ticker forces a fresh `fc.yahoo.com` + `getcrumb` round trip (2 extra fetches) on the next call. Conversely, when Yahoo answers with an HTML 401 (expired crumb), `JSON.parse` throws on :80 *before* the `crumbCache = null` on :81, so the dead crumb is reused for up to 6 h.

Repro (mocked fetch, counting crumb fetches): warm cache → 0; after `BAD` → next `GOOD` does **2**; after `HTML 401` → next `GOOD` does **0**.
```diff
-  const r = JSON.parse(body).quoteSummary?.result?.[0];
-  if (!r) { crumbCache = null; throw new Error("no fundamentals"); }
+  let data; try { data = JSON.parse(body); } catch { crumbCache = null; throw new Error("fundamentals unavailable"); }
+  if (data.finance?.error?.code === "Unauthorized" || body.includes("Invalid Crumb")) { crumbCache = null; throw new Error("yahoo crumb rejected"); }
+  const r = data.quoteSummary?.result?.[0];
+  if (!r) throw new Error(data.quoteSummary?.error?.description || "no fundamentals");
```

### M3 — Malformed Yahoo payloads surface raw engine errors; a 1-bar series returns 200 with a null plan
`src/worker.js:51` `result.timestamp.forEach` → `"Cannot read properties of undefined (reading 'forEach')"`; `:118` → `channelSetup([])` → `"Cannot read properties of undefined (reading 'close')"` (`analysis.js:89`); `:123` `new Date(undefined * 1000).toISOString()` → `"Invalid time value"` (RangeError) kills the whole analyze even though bars were fine. A single-bar result returns **200** with `trendPct: null, fit: null, sigma: null, target1: null, stop == entry`. `scan` on the same data errors on `bars[bars.length - 2]` (`:135`).
```diff
 export async function getBars(symbol, range = "1y") {
   ...
-  const q = result.indicators.quote[0];
+  const q = result.indicators?.quote?.[0];
+  if (!q || !Array.isArray(result.timestamp)) throw new Error("no price history");
   ...
+  if (bars.length < 20) throw new Error(`only ${bars.length} bars`);
   return { bars, meta: result.meta };
 }
 ...
-    asOf: new Date(meta.regularMarketTime * 1000).toISOString(),
+    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
```

### M4 — `regress`/`channelSetup` silently coerce or propagate bad closes
`analysis.js:8-17` — `null` close is coerced to **0** in arithmetic (not `Math.log`) and corrupts the fit: with one null in a 250-bar uptrend, `atr` 31.9 vs ~1, stop 160.8 under entry 224.5. A `NaN` close makes every statistic NaN, but the label still reads `"Mid-range chop"` / `"Neutral"` (`verdictLabel(NaN)` → Neutral, all comparisons false) with `stop: NaN` → serialised as `null`. `logFit` with a price ≤ 0 anywhere in the 250-bar composite window → `composite: NaN`, `score: NaN`, label falls into the range branch. `lookback ≤ 0` (negative passes `lookback || bars.length`) → empty window → NaN plan; `lookback: 1` → NaN. `getBars` filters null closes so the API is mostly shielded, but this module is imported by the browser and `backtest/` too.
```diff
 export function regress(closes, logFit = false) {
-  const y = logFit ? closes.map(Math.log) : closes;
+  if (closes.some((c) => !(c > 0) && (logFit || !Number.isFinite(c)))) throw new Error("regress: non-finite (or non-positive for logFit) close");
+  const y = logFit ? closes.map(Math.log) : closes;
```
```diff
-  const look = Math.min(lookback || bars.length, bars.length);
+  if (bars.length < 3) throw new Error("channelSetup: need at least 3 bars");
+  const look = Math.max(3, Math.min(Math.floor(lookback) || bars.length, bars.length));
```

### M5 — ATR stop: fixes the TTMI case, but a spike inside the last 14 bars still blows it out ~6×
Confirmed the fix works for TTMI today: largest true range in the 120-bar window = **42.50 on 2026-04-30** (then 27.90 on 2026-07-02). Today ATR14 = 6.91 → stop distance **13.83**, vs. the old channel stop (2σ below midline, σ = 24.74) = **62.23**. Replaying as of 2026-04-30 (spike day): ATR stop 22.8 vs channel 55.1 — still 2.4× tighter, but ATR itself is inflated ~1.8× for 14 bars.
Synthetic: spike at bar 245/250 → `atr` 19.29 vs 3.00 baseline, stop distance 38.6 vs 6.
Suggestion (`analysis.js:61-72`): Wilder-smoothed ATR, or clip each TR at 3× the window median before averaging.

### L1 — `/api/chart` passes non-JSON upstream bodies through as `application/json`
`src/worker.js:27-37` — `yfetchText` only breaks on `ok && body.startsWith("{")`; after both hosts fail, the last body is returned verbatim. Live: `/api/chart?symbol=..` → **404 `"Not Found\r\n"`** with `Content-Type: application/json`; mocked 1042 → **403 `"error code: 1042"`**. The UI's `res.json()` throws on these.
```diff
 async function yfetch(path, cacheSeconds) {
   const { body, status } = await yfetchText(path, cacheSeconds);
+  if (!body.startsWith("{")) return json({ error: `upstream ${status}` }, 502);
```

### L2 — `project()` / `projectionDefaults()` don't validate
`analysis.js:141-149`: `shares: 0` → `epsEnd/priceEnd/cagr = Infinity` (→ `null` in JSON); `margin < 0` → negative `priceEnd`, `cagr: NaN`; `revCagr < -1` → negative revenue. `scenarios()` guards `shares` but the MCP `project_valuation` tool lets the user pass `margin`/`revCagr` directly.
`:161-163`: scenario multipliers bypass the clamps — live **NVDA** base margin 0.50 (cap) → bull **0.60**; base exitPE 8 (floor) → bear **6**. A negative forward P/E (loss-maker) hits `Math.min(..., -15, 30)` → clamped to 8 silently.

### L3 — Linear `annualizedPct` flips sign when the fitted price is ≤ 0
`analysis.js:36` divides by `lastFit`. A collapsing series (`100 - 0.9·i`, 120 bars, or the same clamped at 0.5) fits to **-7.10 / -5.95** at the last bar → `trendPct` **+3194 % / +3750 %/yr** with a negative slope, label `"Rally into downtrend resistance"`, targets **-23.67 / -25.94**. Only reachable for near-zero (penny/delisting) prices with `logFit=false`, which is the API default.
```diff
-  return reg.logFit ? (Math.exp(perYear) - 1) * 100 : (perYear / lastFit) * 100;
+  return reg.logFit ? (Math.exp(perYear) - 1) * 100 : lastFit > 0 ? (perYear / lastFit) * 100 : NaN;
```

### L4 — `openTrade` / `closeTrade` input coercion
`paper.mjs:41-45`: `side: "LONG"` is stored and, being `!== "long"`, is checked as a short (stop 105 above entry 100 accepted). Numeric strings compare lexically: `entry:"100", stop:"95"` → `"95" >= "100"` is **true** → rejected as wrong-side. `qty: "7"` is stored as the string `"7"`. `symbol: 123` → `TypeError: symbol.toUpperCase is not a function`. `closeTrade(id, undefined)` → `pnl: null` persisted; `markBook` then counts it as a loss-free close (`realized += null`). The MCP passes `meta.regularMarketPrice`, which can be undefined for a halted/delisted symbol. The zod schemas in `mcp/server.mjs` shield most of this, but `paper.mjs` is also imported by `server.mjs`.
```diff
-export function openTrade({ symbol, side = "long", entry, stop, target, qty, setup = "", note = "" }) {
-  if (!symbol || !(entry > 0) || !(stop > 0)) throw new Error("symbol, entry and stop are required");
+export function openTrade({ symbol, side = "long", entry, stop, target, qty, setup = "", note = "" }) {
+  entry = Number(entry); stop = Number(stop); qty = Number(qty); target = target == null ? null : Number(target);
+  if (typeof symbol !== "string" || !symbol || !(entry > 0) || !(stop > 0)) throw new Error("symbol, entry and stop are required");
+  if (side !== "long" && side !== "short") throw new Error("side must be long or short");
```
```diff
 export function closeTrade(id, price, reason = "manual") {
+  if (!(price > 0)) throw new Error("close price required");
```

### L5 — Gap fills at the stop price
`paper.mjs:31` exits at `t.stop` even when the bar opened through it (open 80, stop 95 → exit 95, pnl -50 instead of -200). Paper P&L is optimistic on gaps. `exit = dir > 0 ? Math.min(t.stop, b.open ?? t.stop) : Math.max(t.stop, b.open ?? t.stop)` (and `getBars` already carries `open`).

### L6 — `handleApi` lookback parsing nits
`src/worker.js:172` — `20.7` → `slice(bars.length - 20.7)` truncates the *index*, giving a **21**-bar window; `"0x10"` parses as 16 → 20. Harmless; `Math.floor` it.

### L7 — Error bodies leak engine text
All the TypeError/RangeError/`JSON.parse` messages above are returned verbatim in `{ error }` (`src/worker.js:206`). Not a security issue (no secrets, no paths), just noisy for the UI/MCP.

---

## VERIFIED OK (no defect)
- Symbol regex rejects `AAPL;rm`, empty, 13 chars; range whitelist rejects `7d`; unknown `/api/*` → 404; `GET /api/claude` → 405; `/api/scan?symbols=` → 400; search `q` > 40 → `{quotes:[]}`.
- Scan: 47 inputs incl. `spy,SPY, spy ,bad$sym` → exactly **40** unique uppercase symbols, 40 upstream fetches, bad token dropped.
- Lookback clamp: `abc`/empty/`0` → 120, `1`/`-5` → 20, `99999`/`1e3`/`Infinity` → 500 (then 251 live, clamped to bars).
- Live TTMI / MELI / NVDA / SPY / ^VIX / BRK-B: stop on the correct side and exactly 2×ATR from entry; `z == (last − fit)/σ` to 1e-9; `trendPct` sign == 120-bar slope sign; every scenario `cagr == (priceEnd/price)^(1/5) − 1` to 1e-12; `price == setup.last` (float32 noise only); ^VIX fundamentals mostly null → `scenarios: null` without error.
- `atr` falls back to close-to-close when `high`/`low` are missing or null, or when only one side is present; returns 0 for < 2 bars.
- `project()` reproduces the MELI 2031 numbers; negative `revCagr` (> -1) is fine. Weekly data with `barsPerYear: 52` annualizes a 10 %/yr log trend to 10.02 % (vs 58.8 % with 252).
- Short plan math: stop above entry at 2×ATR, T1 < entry, T2 < T1, rr and score positive.
- Same-bar stop+target → stop. Bars with `time <= openedAt` ignored. No bars → mark at entry, pnl 0.
- `markBook` stripping `mark` and dropping `pnl` on persisted *open* trades is **not a bug**: they are derived, recomputed on every mark, the returned `trades` still carry them, and `summary.unrealized` is computed from the in-memory marked list. Closed trades persist `pnl`. Second pass is idempotent.
- `hostedClaude` downgrades client `system` roles to `user`, stringifies content, caps at 10 messages / 4000 chars.

## SUSPECTED (not reproduced)
- `paper.mjs` read-modify-write with no lock: `server.mjs` and the MCP both import it; concurrent `openTrade`/`markBook` can lose a trade. Needs two processes to show.
- `yfetchText` with `cf: { cacheEverything: true }` on the quoteSummary call (`worker.js:79`) caches per URL *including the crumb*; a rotated crumb means a cold cache each 6 h, fine, but a Cookie-bearing response being cached edge-wide is worth a look (`Cache-Control` from Yahoo is private).
- SYMBOL_RE accepts `..` and `^^`; `/v8/finance/chart/..` normalises to `/v8/finance/` (Yahoo 404, passed through per L1). Harmless, but `.` could be restricted to `[A-Z]\.[A-Z]` forms.
- `yearHigh`/`yearLow` (`worker.js:124`) are computed from closes, not highs/lows, while the fundamentals block exposes Yahoo's `fiftyTwoWeekHigh`; the two will disagree in the Claude context.
