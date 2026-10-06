// Plain-English definitions shared by the Coach panel and the invest MCP.
// Each entry: [display name, explanation].
export const GLOSSARY = {
  bar: ["Bar", "One candle = one period of trading. On 3M–5Y daily charts a bar is one trading day (about 21 a month, 252 a year). On 10Y/Max charts a bar is one week."],
  lookback: ["Lookback (20 / 60 / 120 / 250)", "How many recent bars the straight line is fitted to. 20 ≈ 1 month, 60 ≈ 3 months, 120 ≈ 6 months, 250 ≈ 1 year. Short lookbacks react fast and flip often; long ones show the bigger trend."],
  regression: ["Regression line", "The single straight line that sits as close as possible to every closing price in the lookback (least squares). It's the trend with the noise averaged out — the stock's 'fair path' if the trend continued."],
  channel: ["Regression channel", "The regression line plus two parallel lines 2σ above and below it. If prices were normally scattered around the trend, ~95% of closes would land inside."],
  sigma: ["σ (sigma, standard deviation)", "The typical distance between price and the regression line. Bigger σ = wilder stock. The outer channel lines are ±2σ."],
  z: ["Position in channel (z)", "How many σ price is from the middle line. 0 = on the line, −1 = one σ below, +2 = at the upper edge. Beyond ±2 is unusual and often snaps back — or it's the start of a breakout."],
  r2: ["R² (fit strength)", "0 to 1: how much of the price movement the straight line explains. Above 0.6 = the stock really is trending; under 0.2 = a straight line is the wrong tool, price is going sideways or whipsawing."],
  slope: ["Slope / annualized trend", "How steep the regression line is. 'Annualized' converts it to % per year if the line kept going. A steep line with a low R² means little."],
  composite: ["Trend verdict (composite)", "A vote of the 20, 60, 120 and 250-bar lines: each votes up or down, weighted by its R² and length. −1 = every timeframe cleanly down, +1 = every timeframe cleanly up, near 0 = they disagree."],
  atr: ["ATR (average true range)", "The average size of one day's move over the last 14 bars, gaps included. It's the stock's normal daily wiggle — a stop closer than ~1 ATR gets hit by noise."],
  stop: ["Stop", "The price where you admit the idea was wrong and exit. Here it's 2×ATR below entry, so normal daily wiggle doesn't knock you out."],
  target: ["Targets T1 / T2", "T1 = where the middle line will be in 20 bars (back to 'fair'). T2 = where the upper channel line will be. Both move with the slope."],
  rr: ["R:R (reward-to-risk)", "Distance to target ÷ distance to stop. 2.0 means you stand to make $2 for every $1 you risk. Below ~1.5 the trade usually isn't worth it."],
  bps: ["Basis point (bp)", "One hundredth of a percent: 1 bp = 0.01%, 100 bps = 1%. Used for small moves — '5 bps per side' in the backtest means 0.05% trading cost each way."],
  volume: ["Volume", "How many shares traded in that bar (the bars along the bottom). Big moves on big volume are more believable than big moves on thin volume."],
  pe: ["P/E (price-to-earnings)", "Price ÷ yearly earnings per share. 'How many years of today's profit you pay for one share.' 8 is cheap, 30+ means the market expects growth."],
  backtest: ["Backtest / out-of-sample", "Replaying the rules on past data to see if they'd have made money. 'Out-of-sample' = tested on years the rules were never tuned on — the only result that counts. Ours: no setup beat random entry."],
  support: ["Support / resistance", "Prices where buyers (support) or sellers (resistance) showed up before. The lower channel line often acts like moving support, the upper like moving resistance."],
};
