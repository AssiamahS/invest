# invest

Regression analysis for stocks — TradingView-style linear regression channels with a trend verdict meter.

Live: https://invest.sylvesterassiamahpm.workers.dev

## What it does

- Search any symbol (stocks, ETFs, indexes, crypto via Yahoo Finance)
- Candlestick chart with an OLS **linear regression channel** (midline ± 2σ) over a selectable lookback (Auto / 60 / 120 / 250 bars)
- Dashed **30-bar projection** of the trend and channel
- Stats: annualized trend %, slope, R² fit strength, channel width, current position in the channel (z-score)
- **Multi-timeframe table** — 20/60/120/250-bar regressions rolled into a composite trend verdict (Strong Uptrend → Strong Downtrend)
- Optional **log-space fit** for long ranges (compounding-correct)

## Stack

- Cloudflare Worker (`src/worker.js`) proxies Yahoo Finance chart + search APIs with edge caching — no keys, no CORS issues
- Static UI (`public/index.html`) served via Workers Assets, charting by [lightweight-charts](https://github.com/tradingview/lightweight-charts) (TradingView's own OSS library)
- Zero build step, zero dependencies to install

## Develop / deploy

```sh
wrangler dev      # local
wrangler deploy   # ship
```

Data is delayed and cached ~2 minutes at the edge. Not financial advice.

## invest MCP (Claude Code)

`mcp/server.mjs` exposes the same engine to Claude as seven read-only tools that
return structured JSON: `analyze_stock`, `scan_market`, `project_stock`,
`compare_stocks`, `get_watchlist`, `get_market_context`, `show_chart`. No tool
can place or simulate an order.

```sh
npm install
claude mcp add invest -- node /path/to/invest/mcp/server.mjs
```

## Backtest — read this before trusting a setup

`node backtest/run.mjs` walks 5 years of daily bars across 72 symbols with no
lookahead. Out-of-sample (2024-10 → 2026-10) **no setup beat a random long on
the same stocks**; long setups only captured market drift and every short setup
lost money, so shorts are demoted and only longs get a trade plan. Details in
`backtest/REPORT.md`; the engine audit is in `AUDIT.md`.

## Tests

`npm test` — 75 tests (math, indicators, paper book, adversarial edge cases, MCP over stdio; some hit live Yahoo).
