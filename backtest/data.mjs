// Bar loader for the backtest. Pulls 5y daily bars through the same getBars()
// the terminal uses and caches the raw response under backtest/cache/ so every
// rerun is offline and reproducible. Delete a cache file to refresh a symbol.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getBars } from "../src/worker.js";
import { LISTS } from "../public/lib/lists.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(HERE, "cache");
export const RANGE = "5y";

export const UNIVERSE = [...new Set(Object.values(LISTS).flat())];

export function listsOf(symbol) {
  return Object.keys(LISTS).filter((k) => LISTS[k].includes(symbol));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadBars(symbol, { refresh = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${symbol}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { bars, meta } = await getBars(symbol, RANGE);
      const out = { symbol, range: RANGE, fetchedAt: new Date().toISOString(), meta: { symbol: meta.symbol, currency: meta.currency, exchangeName: meta.exchangeName }, bars };
      await writeFile(file, JSON.stringify(out));
      return out;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error(`${symbol}: ${lastErr && lastErr.message}`);
}

// Drops a live partial bar for today so the last bar is always a completed session.
export function completedBars(bars, nowSec = Date.now() / 1000) {
  const today = new Date(nowSec * 1000).toISOString().slice(0, 10);
  return bars.filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) !== today);
}

export async function loadUniverse({ refresh = false, delayMs = 250, log = () => {} } = {}) {
  const out = {};
  const failed = [];
  for (const sym of UNIVERSE) {
    try {
      const cached = existsSync(join(CACHE_DIR, `${sym}.json`)) && !refresh;
      const d = await loadBars(sym, { refresh });
      out[sym] = completedBars(d.bars);
      log(`${sym}: ${out[sym].length} bars${cached ? " (cache)" : ""}`);
      if (!cached) await sleep(delayMs);
    } catch (e) {
      failed.push({ symbol: sym, error: e.message });
      log(`${sym}: FAILED ${e.message}`);
    }
  }
  return { bars: out, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const refresh = process.argv.includes("--refresh");
  const { bars, failed } = await loadUniverse({ refresh, log: console.log });
  console.log(`loaded ${Object.keys(bars).length}/${UNIVERSE.length} symbols; failed: ${failed.map((f) => f.symbol).join(",") || "none"}`);
}
