# backtest/ — does `channelSetup()` have an edge?

Walk-forward test of the regression-channel setups in `public/lib/analysis.js`
over the scanner universe in `public/lib/lists.js`. Nothing in `public/` or
`src/` is modified; thresholds are parameters of the harness.

```
node backtest/run.mjs            # offline from backtest/cache, ~10 s
node backtest/run.mjs --refresh  # re-download 5y daily bars first
node backtest/data.mjs           # fetch/cache only
```

Outputs: `results.json` (everything), `TABLES.md` (auto-generated tables),
`REPORT.md` (hand-written verdict).

## Data

- `src/worker.js` `getBars(symbol, "5y")` → Yahoo chart API, daily OHLC, cached
  raw in `backtest/cache/<SYMBOL>.json`. Delete a file to refresh one symbol.
- 72 unique symbols (megacaps ∪ semis ∪ growth ∪ etfs; NVDA/AMD/AVGO are in two
  lists and count once in universe totals, once per list in list breakdowns).
- 2021-10-06 → 2026-10-05. A live partial bar for "today" is dropped.
- ARM (767 bars), IBIT (685), SNDK (412) have shorter histories and fewer trades.

## Signal generation (no lookahead)

At every bar `t ≥ 250` the classifier sees only `bars[0..t]`. It is a
re-implementation of `channelSetup()` built from the same exported primitives
(`regress`, `compositeScore`, `atr`) so the pullback z threshold can vary.
`run.mjs` asserts parity against the real `channelSetup()` on 400 random
(symbol, bar, lookback) samples before anything is reported — setup label, bias,
z, composite, stop distance, target1, target2 all identical.

Decision tree (defaults): composite > 0.2 → z ≤ −3 avoid, z ≤ **zPull** "Pullback
in uptrend" long, z ≥ 1.8 wait, else hold; composite < −0.2 → z ≥ 1 "Rally into
downtrend resistance" short, else avoid; otherwise z ≤ −1.5 "Range low" long,
z ≥ 1.5 "Range high" short, else wait. Only long/short biases trade.

## Trade simulation

- Entry at the **next bar's open**. One open trade per symbol; new signals while
  a trade is open are skipped.
- Stop = fill ∓ `atrMult` × ATR14 (ATR as of the signal bar; the plan's 2×ATR
  stop re-anchored to the real fill). Initial risk = that distance.
- T1 = channel midline projected 20 bars ahead; T2 = midline ± 2σ (exactly
  `plan.target1/target2`). If the fill is already past the target the trade is
  skipped (counted as degenerate; 0–2 per run).
- Exit priority inside a bar: gap through stop at the open → gap through target
  at the open → stop touched (if both stop and target are touched in the same
  bar, stop is assumed) → target touched → time exit at the close after
  `maxHold` bars (20 or 40). Open trades at end of data exit at the last close.
- Costs: 5 bps on entry and 5 bps on exit.
- R = net P&L / initial risk. Expectancy = mean R. Profit factor = gross wins /
  gross losses. Max drawdown is on the cumulative-R curve ordered by exit date,
  across all symbols (so correlated stop-outs in a market drop compound).

## In-sample / out-of-sample

Split by **signal date** at `last bar − 2 years`: in-sample 2022-10-04 →
2024-10-05 (first signal is at bar 250), out-of-sample 2024-10-05 → 2026-10-05.
The sweep (lookback {60,120,250} × zPull {−0.5,−1,−1.5,−2} × ATR× {1.5,2,3} ×
target {T1,T2} × hold {20,40} = 144 configs) is ranked **in-sample only** by
t-stat of mean R (≥100 IS trades required); the pick's OOS numbers are then
reported. Spearman rank correlation of IS vs OOS avg R across the grid is
reported as a robustness check.

## Baselines

- **Random entry**: for each strategy subset (side, setup, list), random signal
  bars at the same entry rate on the same symbols, same stop and time rules,
  target at the subset's median reward:risk (`sameRR`) or none (`timeOnly`).
  50 seeds; the strategy's avg R is placed as a percentile of the seed
  distribution. The seed-to-seed sd is also the honest noise level for the
  strategy's own avg R — trade-level t-stats assume independence and are
  inflated roughly 3× because the symbols move together.
- **Buy & hold**: per-symbol return over the same IS/OOS windows, equal-weight
  per list and universe; plus "capital terms" (one unit per trade, % returns
  summed per symbol, time in market, B&H scaled by that exposure).

## Known limitations

- Survivorship: the universe is today's winners (semis +500% mean OOS).
- 5 years, one regime (2022 bear → 2023–26 bull); 2 years of IS signals.
- Daily bars; intrabar path assumed worst-case for stop vs target.
- No slippage beyond 5 bps, no borrow cost on shorts, no position sizing or
  portfolio-level cap on concurrent trades.
