// Shared watchlist for the Mac side (MCP + local terminal server).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const PATH = process.env.INVEST_WATCHLIST || join(homedir(), ".invest", "watchlist.json");
const DEFAULT = ["TTMI", "MELI", "AMZN", "NFLX", "UBER", "MA", "SOFI", "META", "AMD", "NVDA", "SPY"];

export function getWatchlist() {
  try {
    if (existsSync(PATH)) return JSON.parse(readFileSync(PATH, "utf8"));
  } catch {}
  return DEFAULT;
}

export function setWatchlist(list) {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify(list.slice(0, 40)));
}
