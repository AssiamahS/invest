# Backtest verdict — `channelSetup()` setups (2022-10 → 2026-10, 72 symbols)

Command: `node backtest/run.mjs` (offline from `backtest/cache/`; full tables in
`TABLES.md`, everything in `results.json`). Method in `README.md`.

## Bottom line

**No setup shows an edge over a random entry with the same stop/target/time
rules.** The long setups are positive out-of-sample (OOS avg R +0.18) only
because the universe went up (equal-weight buy-and-hold +236% OOS); a random
long entry on the same symbols with the same rules earns the same (+0.21 ±
0.13). Both short setups lose money in every one of 144 parameter
configurations, in-sample and out-of-sample. The parameter sweep has no
predictive power (IS→OOS rank correlation for the pullback threshold: 0.13); the
in-sample "best" config did *worse* OOS than the shipped defaults.

## Out-of-sample results at the shipped defaults (lookback 120, z ≤ −1, 2×ATR, T1, hold 20)

OOS window 2024-10-05 → 2026-10-05. `random` = matched random entries, 50 seeds;
`pct` = share of random seeds the setup beat (0.50 = coin flip).

| setup | bias | n | win | avg R | PF | random avg R | excess | pct |
|---|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long | 717 | 48% | +0.155 | 1.32 | +0.203 ± 0.142 | **−0.048** | 0.38 |
| Range low | long | 166 | 60% | +0.304 | 1.80 | +0.180 ± 0.266 | +0.124 | 0.68 |
| Rally into downtrend resistance | short | 230 | 33% | **−0.229** | 0.67 | −0.266 ± 0.212 | +0.037 | 0.60 |
| Range high | short | 238 | 34% | **−0.255** | 0.62 | −0.259 ± 0.210 | +0.004 | 0.48 |
| all long | long | 883 | 50% | +0.183 | 1.39 | +0.206 ± 0.127 | −0.023 | 0.48 |
| all short | short | 468 | 34% | −0.242 | 0.64 | −0.228 ± 0.142 | −0.015 | 0.42 |

All trade counts are above 30; nothing here is a small-sample artefact. The
same picture holds in-sample (pullback excess −0.108, pct 0.26; range low
+0.260, pct 0.82; shorts ≈ random shorts) and for the hold-40 and T2 variants
(see `TABLES.md` §1). T2 is reached in only 36 of 843 OOS long trades, so the
"T2" plan is in practice a time exit.

Trade-level t-stats in `TABLES.md` (e.g. 4.18 for the long book) assume
independent trades; the random-seed spread shows the honest standard error is
~3× larger because 72 symbols stop out together on the same days. Judge by the
`pct` column, not the t-stats.

### By list (long side, OOS, defaults)

| list | n | avg R | random avg R | excess | pct | B&H mean OOS |
|---|---|---|---|---|---|---|
| megacaps | 258 | +0.195 | +0.076 | +0.119 | 0.84 | +66% |
| semis | 216 | +0.415 | +0.289 | +0.126 | 0.74 | +500% |
| growth | 233 | +0.141 | +0.256 | −0.115 | 0.28 | +269% |
| etfs | 220 | +0.053 | +0.161 | −0.108 | 0.28 | +53% |

Megacaps/semis beat random, growth/etfs lose to it; none reaches the 0.95 level
and the signs are not consistent across lists. Shorts are negative in every list
(−0.19 to −0.37).

## Versus buy-and-hold

One unit of capital per trade, % returns summed per symbol (OOS): the default
long book made **+20.8% per symbol (median +14%) while in the market 31% of the
time**; buy-and-hold of the same symbols made +236% (median +57%), or +73% after
scaling by that 31% exposure. The chosen-config long book: +24.8% at 44%
exposure vs +104% exposure-scaled B&H. The setups capture a fraction of the
drift they are riding, and the stop/target mechanics cost expectancy even for
random entries (random time-only exit +0.29 R vs random with the plan's
stop/target +0.21 R).

## Parameter sweep (in-sample pick, out-of-sample result)

144 configs ranked on in-sample t-stat of avg R (≥100 IS trades). Long pick:
`lookback 60, zPull −0.5, 3×ATR, T2, hold 20` — IS avg R 0.266 (n 918) →
**OOS 0.150 (n 1004), pct 0.22 vs random**, i.e. worse than the defaults'
0.183 and worse than random. All 144 configs are positive OOS for longs and
negative for shorts: this is the market, not the parameters. IS→OOS Spearman:
long 0.52, pullback 0.13, short 0.61 (shorts rank stably because they all lose).
The hindsight-best OOS config (`lookback 250, zPull −2, 1.5×ATR, T2, hold 40`,
avg R 0.455) is not selectable in advance and is reported only to bound the
range.

## Recommendations for `public/lib/analysis.js` (not applied — report only)

1. **Demote both short setups.** Every configuration loses 0.11–0.43 R per
   trade OOS; n = 230 and 238 at defaults.
   - line 102: `if (z >= 1) { setup = "Rally into downtrend resistance"; bias = "short"; }` → `bias = "avoid"`
   - line 107: `else if (z >= 1.5) { setup = "Range high"; bias = "short"; }` → `bias = "wait"`
   The `score` formula already returns 0 for non-long/short biases, so the
   scanner stops ranking them with no other change.
2. **Keep lookback 120, z ≤ −1, 2×ATR, horizon 20.** No grid point beat random
   OOS and the in-sample optimum degraded OOS; changing thresholds on this
   evidence would be fitting noise. Specifically do not loosen the pullback
   threshold to −0.5 (what in-sample would suggest).
3. **Stop presenting "Pullback in uptrend" as a trade with edge.** It is a
   trend-following filter that underperforms a random long on the same stocks
   in both periods (pct 0.26 IS, 0.38 OOS). Keep the label and bias if the UI
   wants a direction, but the `plan` (entry/stop/targets) should carry a
   "no demonstrated edge; captured ~1/3 of buy-and-hold" note, and the
   `CLAUDE_SYSTEM` prompt in `src/worker.js` should say the setups are
   descriptive, not backtested alpha.
4. **"Range low" is the only candidate worth revisiting** (+0.12 R over random
   OOS, +0.26 IS, n = 166/130, pct 0.68/0.82 — not significant). If anything
   gets promoted it is this one, and only after a longer / broader test.

## Caveats

- **Survivorship**: the universe is today's winners (semis +500% mean OOS);
  longs look good and shorts look terrible partly for that reason. A short
  setup might behave differently on a delisted-inclusive universe — but there is
  no evidence here that it works.
- **Window / regime**: 5 years of daily bars, 2 years of in-sample signals
  (2022 bear → 2023–24 bull) and 2 years OOS (2024–26 bull with the April 2025
  drop). One regime, one cycle.
- **Correlation**: entries cluster across symbols; the R-drawdowns (up to 131 R
  on the long book) reflect 20–30 simultaneous positions all stopping out
  together. Trade-level t-stats overstate significance ~3×.
- **Simulation**: next-open fills, stop-before-target when both are touched in a
  bar (never actually happened at 2×ATR), 5 bps/side, no borrow cost on shorts,
  no cap on concurrent positions.
