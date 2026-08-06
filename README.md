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
