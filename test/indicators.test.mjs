import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, rsi, pctChange } from "../public/lib/indicators.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("sma averages the trailing window and refuses short series", () => {
  near(sma([1, 2, 3, 4, 5], 5), 3, 1e-12);
  near(sma([10, 20, 30, 40], 2), 35, 1e-12);
  assert.equal(sma([1, 2, 3], 5), null);
  assert.equal(sma([], 1), null);
});

test("rsi hits the rails on one-way moves and sits at 50 when flat", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  const flat = Array(30).fill(100);
  assert.equal(rsi(up, 14), 100);
  near(rsi(down, 14), 0, 1e-9);
  assert.equal(rsi(flat, 14), 50);
  assert.equal(rsi(up.slice(0, 14), 14), null); // needs period+1 closes
});

test("rsi matches a hand-computed Wilder value", () => {
  // Seed window: 14 moves of +1 / -1 alternating starting with +1 -> 7 gains, 7 losses -> avgGain = avgLoss = 0.5 -> RSI 50.
  // Then one +2 bar: avgGain = (0.5*13 + 2)/14, avgLoss = (0.5*13)/14 -> RS = 8.5/6.5.
  const closes = [100];
  for (let i = 0; i < 14; i++) closes.push(closes[closes.length - 1] + (i % 2 ? -1 : 1));
  near(rsi(closes, 14), 50, 1e-12);
  closes.push(closes[closes.length - 1] + 2);
  near(rsi(closes, 14), 100 - 100 / (1 + 8.5 / 6.5), 1e-12);
});

test("pctChange compares the last close to N bars back", () => {
  near(pctChange([100, 110, 121], 2), 0.21, 1e-12);
  near(pctChange([100, 90], 1), -0.1, 1e-12);
  assert.equal(pctChange([100], 1), null);
});
