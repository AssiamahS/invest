import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTrade } from "../src/paper.mjs";

const T0 = 1_790_000_000;
const day = (i, low, high, close) => ({ time: T0 + i * 86400, low, high, close });
const long = { side: "long", entry: 100, stop: 95, target: 110, qty: 10, openedAt: T0 };

test("long trade hits its target", () => {
  const r = resolveTrade(long, [day(1, 99, 104, 103), day(2, 102, 111, 109)]);
  assert.equal(r.status, "closed");
  assert.equal(r.reason, "target");
  assert.equal(r.exit, 110);
  assert.equal(r.pnl, 100);
});

test("stop wins when one bar spans stop and target (conservative)", () => {
  const r = resolveTrade(long, [day(1, 94, 111, 100)]);
  assert.equal(r.reason, "stop");
  assert.equal(r.pnl, -50);
});

test("bars before the open are ignored and open trades mark to market", () => {
  const r = resolveTrade(long, [day(-1, 50, 200, 100), day(1, 98, 103, 102)]);
  assert.equal(r.status, "open");
  assert.equal(r.mark, 102);
  assert.equal(r.pnl, 20);
});

test("short trade mirrors the long logic", () => {
  const short = { side: "short", entry: 100, stop: 105, target: 90, qty: 5, openedAt: T0 };
  const r = resolveTrade(short, [day(1, 89, 101, 91)]);
  assert.equal(r.reason, "target");
  assert.equal(r.pnl, 50);
});
