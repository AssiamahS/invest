# Backtest tables — channelSetup() setups (auto-generated; verdict in REPORT.md)

Generated 2026-10-06T07:03:33.562Z by `node backtest/run.mjs`. Data 2021-10-06 → 2026-10-05, 72 symbols (none skipped).
In-sample signals 2022-10-04 → 2024-10-05; **out-of-sample 2024-10-05 → 2026-10-05**. Costs 5 bps/side. `*` = fewer than 30 trades, not significant.

## 1. Shipped defaults (lookback 120, pullback z ≤ -1, stop 2×ATR)

### T1, hold20

**IS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  599 | 48% | 0.137 | 1.28 | 2.65 | 13.0 | 50.0 |
| Rally into downtrend resistance | short  257 | 31% | -0.391 | 0.46 | -5.84 | 11.0 | 110.7 |
| Range high | short  249 | 37% | -0.199 | 0.69 | -2.59 | 11.3 | 60.8 |
| Range low | long  130 | 63% | 0.586 | 2.97 | 5.28 | 13.5 | 7.6 |
| **all long** | long  729 | 50% | 0.217 | 1.48 | 4.59 | 13.1 | 51.3 |
| **all short** | short  506 | 34% | -0.296 | 0.56 | -5.82 | 11.2 | 165.9 |

**OOS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  717 | 48% | 0.155 | 1.32 | 3.14 | 12.7 | 107.3 |
| Range high | short  238 | 34% | -0.255 | 0.62 | -3.25 | 10.9 | 67.2 |
| Rally into downtrend resistance | short  230 | 33% | -0.229 | 0.67 | -2.55 | 12.3 | 62.0 |
| Range low | long  166 | 60% | 0.304 | 1.80 | 3.26 | 12.5 | 24.9 |
| **all long** | long  883 | 50% | 0.183 | 1.39 | 4.18 | 12.6 | 131.2 |
| **all short** | short  468 | 34% | -0.242 | 0.64 | -4.08 | 11.6 | 123.9 |

OOS by list (long / short avg R, n):

| list | long n | long avg R | long t | short n | short avg R | short t |
|---|---|---|---|---|---|---|
| megacaps | 258 | 0.195 | 2.34 | 120 | -0.204 | -1.69 |
| semis | 216 | 0.415 | 4.57 | 131 | -0.193 | -1.76 |
| growth | 233 | 0.141 | 1.69 | 156 | -0.278 | -2.59 |
| etfs | 220 | 0.053 | 0.62 | 75 | -0.369 | -2.70 |

### T1, hold40

**IS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  469 | 47% | 0.246 | 1.45 | 3.58 | 18.4 | 50.4 |
| Rally into downtrend resistance | short  238 | 24% | -0.486 | 0.40 | -6.54 | 14.6 | 125.7 |
| Range high | short  226 | 28% | -0.323 | 0.57 | -3.77 | 14.7 | 82.4 |
| Range low | long  120 | 57% | 0.558 | 2.35 | 4.05 | 18.7 | 13.1 |
| **all long** | long  589 | 49% | 0.309 | 1.60 | 5.02 | 18.5 | 58.3 |
| **all short** | short  464 | 26% | -0.407 | 0.48 | -7.18 | 14.6 | 206.6 |

**OOS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  599 | 44% | 0.185 | 1.34 | 3.12 | 16.5 | 100.8 |
| Range high | short  227 | 32% | -0.218 | 0.71 | -2.33 | 13.5 | 66.2 |
| Rally into downtrend resistance | short  189 | 26% | -0.385 | 0.54 | -3.60 | 16.6 | 85.0 |
| Range low | long  162 | 54% | 0.328 | 1.69 | 2.94 | 15.7 | 29.0 |
| **all long** | long  761 | 46% | 0.215 | 1.40 | 4.11 | 16.4 | 128.2 |
| **all short** | short  416 | 29% | -0.294 | 0.63 | -4.17 | 14.9 | 142.0 |

OOS by list (long / short avg R, n):

| list | long n | long avg R | long t | short n | short avg R | short t |
|---|---|---|---|---|---|---|
| megacaps | 227 | 0.177 | 1.85 | 109 | -0.160 | -1.11 |
| semis | 178 | 0.580 | 5.20 | 125 | -0.255 | -2.02 |
| growth | 200 | 0.165 | 1.63 | 131 | -0.375 | -2.96 |
| etfs | 189 | 0.036 | 0.35 | 64 | -0.466 | -2.73 |

### T2, hold20

**IS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  595 | 47% | 0.202 | 1.41 | 3.41 | 14.6 | 51.7 |
| Rally into downtrend resistance | short  251 | 29% | -0.442 | 0.39 | -6.84 | 11.8 | 115.7 |
| Range high | short  239 | 34% | -0.252 | 0.62 | -3.19 | 12.6 | 68.4 |
| Range low | long  124 | 58% | 0.671 | 3.06 | 4.83 | 16.1 | 8.6 |
| **all long** | long  719 | 49% | 0.283 | 1.61 | 5.15 | 14.8 | 56.7 |
| **all short** | short  490 | 31% | -0.349 | 0.50 | -6.86 | 12.2 | 180.8 |

**OOS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  686 | 46% | 0.123 | 1.24 | 2.29 | 14.4 | 104.3 |
| Rally into downtrend resistance | short  229 | 33% | -0.224 | 0.68 | -2.41 | 12.9 | 59.2 |
| Range high | short  227 | 30% | -0.265 | 0.63 | -2.99 | 12.6 | 64.9 |
| Range low | long  157 | 54% | 0.357 | 1.89 | 3.31 | 15.6 | 22.5 |
| **all long** | long  843 | 47% | 0.167 | 1.34 | 3.46 | 14.6 | 124.6 |
| **all short** | short  456 | 32% | -0.244 | 0.65 | -3.81 | 12.8 | 122.4 |

OOS by list (long / short avg R, n):

| list | long n | long avg R | long t | short n | short avg R | short t |
|---|---|---|---|---|---|---|
| megacaps | 250 | 0.198 | 2.15 | 118 | -0.174 | -1.32 |
| semis | 201 | 0.424 | 4.02 | 128 | -0.226 | -2.02 |
| growth | 222 | 0.058 | 0.65 | 151 | -0.297 | -2.56 |
| etfs | 212 | 0.074 | 0.79 | 73 | -0.344 | -2.23 |

### T2, hold40

**IS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  435 | 43% | 0.412 | 1.71 | 4.50 | 23.6 | 48.7 |
| Rally into downtrend resistance | short  220 | 19% | -0.646 | 0.24 | -10.08 | 17.1 | 144.2 |
| Range high | short  192 | 23% | -0.423 | 0.47 | -4.53 | 19.3 | 84.0 |
| Range low | long  105 | 53% | 0.791 | 2.72 | 4.11 | 26.3 | 14.8 |
| **all long** | long  540 | 45% | 0.486 | 1.87 | 5.86 | 24.1 | 59.1 |
| **all short** | short  412 | 21% | -0.542 | 0.34 | -9.76 | 18.1 | 226.3 |

**OOS** by setup

| setup | bias  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| Pullback in uptrend | long  515 | 38% | 0.223 | 1.37 | 2.88 | 21.9 | 97.8 |
| Range high | short  200 | 28% | -0.199 | 0.75 | -1.77 | 17.7 | 71.5 |
| Rally into downtrend resistance | short  176 | 23% | -0.458 | 0.47 | -4.22 | 18.9 | 89.6 |
| Range low | long  141 | 50% | 0.572 | 2.14 | 3.50 | 24.1 | 25.7 |
| **all long** | long  656 | 41% | 0.298 | 1.51 | 4.23 | 22.4 | 123.5 |
| **all short** | short  376 | 26% | -0.320 | 0.61 | -4.07 | 18.2 | 143.3 |

OOS by list (long / short avg R, n):

| list | long n | long avg R | long t | short n | short avg R | short t |
|---|---|---|---|---|---|---|
| megacaps | 197 | 0.187 | 1.53 | 98 | -0.290 | -1.95 |
| semis | 149 | 0.932 | 5.47 | 112 | -0.277 | -1.98 |
| growth | 172 | 0.131 | 1.03 | 121 | -0.430 | -3.21 |
| etfs | 164 | 0.129 | 0.96 | 56 | -0.320 | -1.40 |

## 2. Parameter sweep (144 configs; selected on in-sample t-stat, min 100 IS trades)

Rank stability (Spearman of IS vs OOS avg R across configs with ≥30 trades in both): long 0.521, pullback 0.128, short 0.605, all 0.239.

### Top 10 long configs by in-sample t-stat, with their out-of-sample result

| lookback | zPull | ATR× | target | hold | IS n | IS avg R | IS t | **OOS n** | **OOS avg R** | OOS PF | OOS t |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 | -0.5 | 3 | T2 | 20 | 918 | 0.266 | 8.01 | **1004** | **0.150** | 1.44 | 4.71 |
| 250 | -0.5 | 2 | T2 | 40 | 444 | 0.779 | 7.58 | **574** | **0.293** | 1.50 | 3.81 |
| 60 | -0.5 | 3 | T2 | 40 | 637 | 0.386 | 7.53 | **731** | **0.214** | 1.50 | 4.67 |
| 60 | -0.5 | 2 | T2 | 20 | 1047 | 0.324 | 7.42 | **1178** | **0.171** | 1.34 | 4.12 |
| 250 | -0.5 | 3 | T2 | 40 | 383 | 0.579 | 7.36 | **473** | **0.233** | 1.52 | 3.76 |
| 250 | -0.5 | 3 | T2 | 20 | 538 | 0.369 | 7.35 | **662** | **0.114** | 1.32 | 2.85 |
| 60 | -0.5 | 2 | T2 | 40 | 769 | 0.467 | 7.28 | **931** | **0.281** | 1.50 | 5.01 |
| 250 | -0.5 | 2 | T1 | 40 | 527 | 0.482 | 7.28 | **670** | **0.190** | 1.36 | 3.41 |
| 60 | -1 | 2 | T2 | 20 | 895 | 0.348 | 7.20 | **1031** | **0.181** | 1.36 | 4.03 |
| 250 | -0.5 | 2 | T2 | 20 | 609 | 0.464 | 7.16 | **778** | **0.162** | 1.32 | 3.10 |

### Top 10 short configs by in-sample t-stat, with their out-of-sample result

| lookback | zPull | ATR× | target | hold | IS n | IS avg R | IS t | **OOS n** | **OOS avg R** | OOS PF | OOS t |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 120 | -1 | 2 | T1 | 20 | 506 | -0.296 | -5.82 | **468** | **-0.242** | 0.64 | -4.08 |
| 120 | -0.5 | 2 | T1 | 20 | 506 | -0.296 | -5.82 | **468** | **-0.242** | 0.64 | -4.08 |
| 120 | -1.5 | 2 | T1 | 20 | 506 | -0.296 | -5.82 | **468** | **-0.242** | 0.64 | -4.08 |
| 120 | -2 | 2 | T1 | 20 | 506 | -0.296 | -5.82 | **468** | **-0.244** | 0.64 | -4.10 |
| 120 | -0.5 | 3 | T1 | 20 | 424 | -0.252 | -5.84 | **407** | **-0.220** | 0.59 | -4.55 |
| 120 | -1.5 | 3 | T1 | 20 | 424 | -0.252 | -5.84 | **407** | **-0.220** | 0.59 | -4.57 |
| 120 | -2 | 3 | T1 | 20 | 424 | -0.252 | -5.84 | **407** | **-0.221** | 0.59 | -4.58 |
| 120 | -1 | 3 | T1 | 20 | 424 | -0.252 | -5.84 | **406** | **-0.223** | 0.58 | -4.61 |
| 60 | -0.5 | 3 | T1 | 40 | 489 | -0.264 | -6.01 | **410** | **-0.216** | 0.63 | -4.13 |
| 60 | -1 | 3 | T1 | 40 | 491 | -0.267 | -6.11 | **408** | **-0.214** | 0.63 | -4.10 |

- long: 144/144 configs with ≥30 OOS trades have positive OOS avg R; OOS avg R range 0.056 .. 0.455 (best-OOS config, hindsight only: {"lookback":250,"zPull":-2,"atrMult":1.5,"target":"T2","maxHold":40}).
- short: 0/144 configs with ≥30 OOS trades have positive OOS avg R; OOS avg R range -0.425 .. -0.115 (best-OOS config, hindsight only: {"lookback":60,"zPull":-1,"atrMult":3,"target":"T1","maxHold":20}).
- pullback: 144/144 configs with ≥30 OOS trades have positive OOS avg R; OOS avg R range 0.010 .. 0.356 (best-OOS config, hindsight only: {"lookback":60,"zPull":-2,"atrMult":2,"target":"T2","maxHold":40}).

## 3a. Chosen long config (in-sample pick): {"lookback":60,"zPull":-0.5,"atrMult":3,"target":"T2","maxHold":20}

| period | book  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| IS | long  918 | 60% | 0.266 | 1.89 | 8.01 | 15.9 | 60.5 |
| OOS | long  1004 | 53% | 0.150 | 1.44 | 4.71 | 15.8 | 82.8 |

OOS by setup:

| setup  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|
| Pullback in uptrend  838 | 53% | 0.142 | 1.41 | 4.05 | 15.7 | 68.4 |
| Rally into downtrend resistance  223 | 41% | -0.197 | 0.60 | -3.14 | 15.4 | 51.6 |
| Range low  166 | 54% | 0.188 | 1.62 | 2.52 | 15.9 | 14.5 |
| Range high  221 | 41% | -0.169 | 0.67 | -2.56 | 14.5 | 40.7 |

OOS by list (long side):

| list  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|
| megacaps  301 | 53% | 0.136 | 1.39 | 2.29 | 15.6 | 31.9 |
| semis  256 | 56% | 0.228 | 1.76 | 3.69 | 16.2 | 15.1 |
| growth  254 | 50% | 0.153 | 1.46 | 2.34 | 15.8 | 22.0 |
| etfs  241 | 53% | 0.087 | 1.24 | 1.44 | 15.5 | 19.6 |

Long book at 1% equity risk per trade: IS {"trades":918,"totalReturnAt1pctRisk":9.9558,"cagrAt1pctRisk":2.3045,"maxDrawdownPct":0.4591,"avgOpenPositions":28.9306}; OOS {"trades":1004,"totalReturnAt1pctRisk":3.2804,"cagrAt1pctRisk":1.0689,"maxDrawdownPct":0.5652,"avgOpenPositions":31.381}.

## 3b. Chosen short config (in-sample pick): {"lookback":120,"zPull":-1,"atrMult":2,"target":"T1","maxHold":20}

| period | book  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|---|
| IS | short  506 | 34% | -0.296 | 0.56 | -5.82 | 11.2 | 165.9 |
| OOS | short  468 | 34% | -0.242 | 0.64 | -4.08 | 11.6 | 123.9 |

OOS by setup:

| setup  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|
| Pullback in uptrend  717 | 48% | 0.155 | 1.32 | 3.14 | 12.7 | 107.3 |
| Range low  166 | 60% | 0.304 | 1.80 | 3.26 | 12.5 | 24.9 |
| Rally into downtrend resistance  230 | 33% | -0.229 | 0.67 | -2.55 | 12.3 | 62.0 |
| Range high  238 | 34% | -0.255 | 0.62 | -3.25 | 10.9 | 67.2 |

OOS by list (short side):

| list  n | win | avg R | PF | t | hold | maxDD R |
|---|---|---|---|---|---|---|
| megacaps  120 | 33% | -0.204 | 0.70 | -1.69 | 11.6 | 34.6 |
| semis  131 | 35% | -0.193 | 0.70 | -1.76 | 11.5 | 52.6 |
| growth  156 | 37% | -0.278 | 0.60 | -2.59 | 11.4 | 48.0 |
| etfs  75 | 24% | -0.369 | 0.49 | -2.70 | 12.0 | 28.8 |

## 4. Baselines — does the setup beat a random entry with the same rules?

Random entries matched to each strategy subset: same side, same symbols, same entry rate, same stop and time exit; `sameRR` puts the target at the subset's median reward:risk, `timeOnly` has no target. 50 seeds. **excess** = strategy avg R − random mean avg R; **pct** = share of random seeds the strategy beat (0.50 = no better than random, ≥0.95 = beats random at ~5% level).

### Defaults (lookback 120, z ≤ -1, 2×ATR, T1, hold 20) — OOS

| subset | side | OOS n | strategy avg R | random avg R ± sd (sameRR) | excess | pct | random timeOnly avg R | excess vs timeOnly |
|---|---|---|---|---|---|---|---|---|
| all long | long | 883 | 0.183 | 0.206 ± 0.127 | -0.023 | 0.48 | 0.292 ± 0.171 | -0.109 |
| all short | short | 468 | -0.242 | -0.228 ± 0.142 | -0.015 | 0.42 | -0.247 ± 0.142 | +0.005 |
| Range low | long | 166 | 0.304 | 0.180 ± 0.266 | +0.124 | 0.68 | 0.270 ± 0.353 | +0.034 |
| Rally into downtrend resistance | short | 230 | -0.229 | -0.266 ± 0.212 | +0.037 | 0.60 | -0.280 ± 0.213 | +0.051 |
| Range high | short | 238 | -0.255 | -0.259 ± 0.210 | +0.004 | 0.48 | -0.280 ± 0.213 | +0.024 |
| Pullback in uptrend | long | 717 | 0.155 | 0.203 ± 0.142 | -0.048 | 0.38 | 0.289 ± 0.189 | -0.135 |
| megacaps (long) | long | 258 | 0.195 | 0.076 ± 0.123 | +0.119 | 0.84 | 0.109 ± 0.151 | +0.086 |
| semis (long) | long | 216 | 0.415 | 0.289 ± 0.166 | +0.126 | 0.74 | 0.456 ± 0.258 | -0.041 |
| growth (long) | long | 233 | 0.141 | 0.256 ± 0.203 | -0.115 | 0.28 | 0.336 ± 0.269 | -0.194 |
| etfs (long) | long | 220 | 0.053 | 0.161 ± 0.163 | -0.108 | 0.28 | 0.229 ± 0.193 | -0.175 |
| all long, T2 hold 20 | long | 843 | 0.167 | 0.274 ± 0.149 | -0.107 | 0.30 | 0.292 ± 0.164 | -0.126 |
| chosen long {"lookback":60,"zPull":-0.5,"atrMult":3,"target":"T2","maxHold":20} | long | 1004 | 0.150 | 0.210 ± 0.092 | -0.060 | 0.22 | 0.235 ± 0.107 | -0.085 |

Same comparison in-sample (for reference):

| subset | IS strategy avg R | IS random sameRR avg R ± sd | excess | pct |
|---|---|---|---|---|
| all long | 0.217 (n=729) | 0.245 ± 0.172 | -0.028 | 0.40 |
| all short | -0.296 (n=506) | -0.305 ± 0.163 | +0.009 | 0.50 |
| Range low | 0.586 (n=130) | 0.326 ± 0.300 | +0.260 | 0.82 |
| Rally into downtrend resistance | -0.391 (n=257) | -0.325 ± 0.203 | -0.066 | 0.38 |
| Range high | -0.199 (n=249) | -0.311 ± 0.207 | +0.113 | 0.68 |
| Pullback in uptrend | 0.137 (n=599) | 0.245 ± 0.188 | -0.108 | 0.26 |

### Buy & hold

Equal-weight per symbol: universe mean IS 107.5%, **OOS 236.4%** (median 57.1%, 88% of symbols up).

| list | n | B&H IS mean | B&H OOS mean | B&H OOS median |
|---|---|---|---|---|
| megacaps | 20 | 164.0% | 66.1% | 33.9% |
| semis | 20 | 143.3% | 499.6% | 167.8% |
| growth | 20 | 115.6% | 268.9% | 95.3% |
| etfs | 15 | 38.0% | 52.8% | 36.5% |

Capital terms (one unit of capital per trade, % returns summed per symbol, then averaged across symbols):

| book | period | mean Σ trade % / symbol | median | time in market | B&H mean % | B&H × exposure |
|---|---|---|---|---|---|---|
| defaults_T1_hold20_long | IS | 15.1% | 13.9% | 26% | 107.5% | 28.3% |
| defaults_T1_hold20_long | OOS | 20.8% | 14.0% | 31% | 236.4% | 73.4% |
| defaults_T1_hold20_short | IS | -13.4% | -8.8% | 16% | 107.5% | 16.7% |
| defaults_T1_hold20_short | OOS | -10.7% | -7.1% | 15% | 236.4% | 35.6% |
| chosenLong_long | IS | 30.6% | 27.9% | 40% | 107.5% | 43.3% |
| chosenLong_long | OOS | 24.8% | 16.8% | 44% | 236.4% | 104.0% |

Default long book (T1, hold 20) compounded at 1% equity risk per trade (unrealistic: ~22 positions open at once): IS {"trades":729,"totalReturnAt1pctRisk":3.5827,"cagrAt1pctRisk":1.1385,"maxDrawdownPct":0.4096,"avgOpenPositions":18.8968}, OOS {"trades":883,"totalReturnAt1pctRisk":3.6642,"cagrAt1pctRisk":1.1597,"maxDrawdownPct":0.7328,"avgOpenPositions":22.1587}.

Elapsed 10.1s.
