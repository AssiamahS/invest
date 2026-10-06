// invest — plain price indicators (SMA, RSI). Pure functions over an array of
// closes, oldest first. Kept apart from analysis.js so the regression-channel
// math there stays untouched; the MCP layer reports these alongside it.

// Simple moving average of the last `period` values. null when there is not
// enough history, so callers never mistake a short-window average for the real one.
export function sma(closes, period) {
  if (!Array.isArray(closes) || period < 1 || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

// Wilder RSI: first average is a simple mean of the seed window, then the
// standard (prev * (period-1) + current) / period smoothing. Needs period+1
// closes; returns null below that. All-flat input returns 50 (no direction).
export function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || period < 1 || closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Percent change between the last close and the close `bars` ago (e.g. 21 for
// one trading month). null when the series is too short.
export function pctChange(closes, bars) {
  if (!Array.isArray(closes) || bars < 1 || closes.length <= bars) return null;
  const then = closes[closes.length - 1 - bars];
  return then ? (closes[closes.length - 1] - then) / then : null;
}
