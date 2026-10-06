// invest — local terminal server for the Mac. Serves public/ and routes /api/*
// through the same handler the Cloudflare Worker uses, so the page behaves
// identically here and on workers.dev. Bound to 127.0.0.1 only.
//   node server.mjs            → http://127.0.0.1:8811

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { handleApi, analyze, getBars } from "./src/worker.js";
import { channelSetup } from "./public/lib/analysis.js";

const PORT = +(process.env.INVEST_PORT || 8811);
const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const MODEL = process.env.INVEST_CLAUDE_MODEL || "sonnet";

const TEACHER = `You are the coach inside "invest", a stock-chart terminal. The student is learning technical analysis.
You get the engine's analysis of the chart they're looking at as JSON. Bars = trading days (weekly on 10Y/Max).
Regression channel = least-squares line through the last N closes with ±2σ bands; z = distance from the midline in σ;
r2 = how much of the movement the line explains; composite = vote of the 20/60/120/250-bar lines in [-1, 1];
atr = average daily range; plan = long-only mechanical plan (2×ATR stop, channel targets) or null.
Teach like a patient teacher:
- Plain words. Define any jargon the first time (bar, σ, R², ATR, basis points, P/E...).
- Use ONLY numbers from the JSON. Never invent prices, news or fundamentals.
- When asked what the stock will do, never predict with certainty: give the bull case and the bear case from the numbers,
  ask what the student thinks and why, then give your lean and what would prove it wrong.
- Mention the backtest note (setup.edge) when someone treats a setup as a sure thing.
- When quizzing, ask ONE question, give options if useful, and wait for their answer before revealing it.
- Keep replies under ~170 words. End most replies with one short question back to the student.
This is education, not financial advice.`;

// Claude Code itself, headless: no tools, no MCP, no saved session. The engine
// numbers go in the prompt so the answer is grounded in what's on screen.
function claudeTeach({ messages = [], symbol, lookback }) {
  return new Promise(async (resolve, reject) => {
    let context = "";
    if (/^[A-Z0-9.^=\-]{1,12}$/.test(symbol || "")) {
      try {
        const a = await analyze(symbol, Math.min(500, Math.max(20, +lookback || 120)));
        // The student can flip between lookbacks, so give the coach every channel.
        const { bars } = await getBars(symbol, "1y");
        a.channels = [20, 60, 120, 250].filter((n) => n <= bars.length).map((n) => {
          const c = channelSetup(bars, { lookback: n });
          return { lookback: n, mid: c.fit, z: c.z, sigma: c.sigma, r2: c.r2, slopePctYr: c.trendPct, setup: c.setup, bias: c.bias };
        });
        context = JSON.stringify(a);
      } catch {}
    }
    const transcript = messages.slice(-12).map((m) => `${m.role === "assistant" ? "COACH" : "STUDENT"}: ${String(m.content).slice(0, 3000)}`).join("\n\n");
    const prompt = `Chart on screen (${symbol || "none"}):\n${context || "(no data)"}\n\nConversation so far:\n${transcript}\n\nReply as COACH to the last STUDENT message.`;
    const child = spawn("claude", ["-p", "--system-prompt", TEACHER, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json", "--model", MODEL], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("claude timed out")); }, 120000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(d.result || "claude error"));
        resolve(d.result);
      } catch { reject(new Error((err || out).slice(0, 300) || "no output from claude")); }
    });
    child.stdin.end(prompt);
  });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/api/claude" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { body = null; }
      res.writeHead(body ? 200 : 400, { "Content-Type": "application/json" });
      if (!body) return res.end(JSON.stringify({ error: "body must be JSON" }));
      try { res.end(JSON.stringify({ text: await claudeTeach(body), brain: `claude ${MODEL} (local)` })); }
      catch (e) { res.end(JSON.stringify({ error: e.message })); }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await handleApi(new Request(url, { method: req.method, headers: req.headers, body }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
    if (rel.includes("..")) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
    const data = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain" });
    res.end(e.code === "ENOENT" ? "not found" : String(e.message));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`invest terminal → http://127.0.0.1:${PORT}`));
