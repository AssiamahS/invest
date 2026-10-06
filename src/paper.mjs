// invest — paper trading book. Node only (the Mac terminal server + the MCP);
// the hosted Worker has no disk. One JSON file is the whole ledger.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const BOOK_PATH = process.env.INVEST_BOOK || join(homedir(), ".invest", "paper.json");

export function loadBook() {
  if (!existsSync(BOOK_PATH)) return { trades: [] };
  return JSON.parse(readFileSync(BOOK_PATH, "utf8"));
}

function saveBook(book) {
  mkdirSync(dirname(BOOK_PATH), { recursive: true });
  writeFileSync(BOOK_PATH, JSON.stringify(book, null, 2));
}

// Walk daily bars after the open and close the trade at the first stop or
// target touch. If one bar spans both we can't know the order, so assume the
// stop (the conservative fill). Otherwise mark to the last close.
export function resolveTrade(t, bars) {
  const dir = t.side === "short" ? -1 : 1;
  const pnlAt = (px) => Math.round(dir * (px - t.entry) * t.qty * 100) / 100;
  for (const b of bars) {
    if (b.time <= t.openedAt) continue;
    if (b.low == null || b.high == null) continue; // null <= stop is true in JS: phantom fill
    const hitStop = dir > 0 ? b.low <= t.stop : b.high >= t.stop;
    const hitTarget = t.target != null && (dir > 0 ? b.high >= t.target : b.low <= t.target);
    if (hitStop || hitTarget) {
      // A gap through the stop fills at the open, not at the stop price.
      const gapped = hitStop && b.open != null && (dir > 0 ? b.open < t.stop : b.open > t.stop);
      const exit = hitStop ? (gapped ? b.open : t.stop) : t.target;
      return { ...t, status: "closed", reason: hitStop ? "stop" : "target", exit, closedAt: b.time, pnl: pnlAt(exit) };
    }
  }
  const after = bars.filter((b) => b.time > t.openedAt);
  const mark = after.length ? after[after.length - 1].close : t.entry;
  return { ...t, status: "open", mark, pnl: pnlAt(mark) };
}

export function openTrade({ symbol, side = "long", entry, stop, target, qty, setup = "", note = "" }) {
  side = String(side).toLowerCase();
  if (side !== "long" && side !== "short") throw new Error("side must be long or short");
  [entry, stop] = [Number(entry), Number(stop)];
  target = target == null ? null : Number(target);
  if (!symbol || !(entry > 0) || !(stop > 0)) throw new Error("symbol, entry and stop are required");
  if (side === "long" ? stop >= entry : stop <= entry) throw new Error("stop is on the wrong side of entry");
  if (target != null && (side === "long" ? target <= entry : target >= entry)) throw new Error("target is on the wrong side of entry");
  const book = loadBook();
  // Default size: risk 1% of a $10k paper account per trade.
  const size = qty > 0 ? qty : Math.max(1, Math.floor(100 / Math.abs(entry - stop)));
  const trade = {
    id: Math.random().toString(36).slice(2, 8), symbol: symbol.toUpperCase(), side,
    entry, stop, target: target ?? null, qty: size, setup, note,
    openedAt: Math.floor(Date.now() / 1000), status: "open",
  };
  book.trades.push(trade);
  saveBook(book);
  return trade;
}

export function closeTrade(id, price, reason = "manual") {
  price = Number(price);
  if (!(price > 0)) throw new Error("close price must be a positive number");
  const book = loadBook();
  const t = book.trades.find((x) => x.id === id && x.status === "open");
  if (!t) throw new Error(`no open trade ${id}`);
  const dir = t.side === "short" ? -1 : 1;
  Object.assign(t, {
    status: "closed", reason, exit: price, closedAt: Math.floor(Date.now() / 1000),
    pnl: Math.round(dir * (price - t.entry) * t.qty * 100) / 100,
  });
  saveBook(book);
  return t;
}

// Re-check every open trade against fresh bars and persist any that closed.
export async function markBook(getBars) {
  const book = loadBook();
  const marked = await Promise.all(book.trades.map(async (t) => {
    if (t.status !== "open") return t;
    try { return resolveTrade(t, (await getBars(t.symbol, "6mo")).bars); }
    catch { return t; }
  }));
  book.trades = marked.map(({ mark, ...t }) => (t.status === "open" ? { ...t, pnl: undefined } : t));
  saveBook(book);
  const closed = marked.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.pnl > 0).length;
  return {
    trades: marked,
    summary: {
      open: marked.length - closed.length, closed: closed.length,
      winRate: closed.length ? wins / closed.length : null,
      realized: closed.reduce((a, t) => a + t.pnl, 0),
      unrealized: marked.filter((t) => t.status === "open").reduce((a, t) => a + (t.pnl || 0), 0),
    },
  };
}
