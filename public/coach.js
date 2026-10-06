// invest — Coach panel: explains the chart in plain words, quizzes you on the
// numbers in front of you, lets you call the next 20 bars on a hidden past
// chart, and puts Claude (claude -p via server.mjs) one click away.
// Every number comes from /api/analyze or analysis.js — the same engine the
// MCP uses — so the lesson and the chart can never disagree.

import { channelSetup } from "./lib/analysis.js";
import { GLOSSARY } from "./lib/glossary.js";

const $ = (s) => document.querySelector(s);
const H = window.investHooks; // { state, render } from the page script
const fmt = (v, d = 2) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${fmt(v, d)}%`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------------------------------------------------------------- glossary
const term = (key, label) => `<span class="term" data-t="${key}">${esc(label ?? GLOSSARY[key][0])}</span>`;

function showTerm(key, anchor) {
  const g = GLOSSARY[key];
  if (!g) return;
  const box = $("#coachDef");
  box.innerHTML = `<b>${esc(g[0])}</b><p>${esc(g[1])}</p><button class="btn" data-ask="Explain ${esc(g[0])} using this chart's numbers">Ask Claude about it</button>`;
  box.style.display = "block";
  anchor?.scrollIntoView?.({ block: "nearest" });
}

// ---------------------------------------------------------------- data
let A = null;          // /api/analyze for the current symbol
let replay = null;     // active Predict round
async function refresh() {
  if (replay) return;
  const { symbol, lookback } = H.state;
  try {
    const r = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbol)}&lookback=${lookback || 120}`);
    A = await r.json();
    if (A.error) throw new Error(A.error);
  } catch (e) { A = null; $("#coachExplain").innerHTML = `<p class="muted">Couldn't analyze ${esc(symbol)}: ${esc(e.message)}</p>`; return; }
  renderExplain();
  newQuestion();
  gradeCalls();
}

// ---------------------------------------------------------------- Explain
function tfLine(r) {
  const days = { 20: "~1 month", 60: "~3 months", 120: "~6 months", 250: "~1 year" }[r.w];
  const strength = r.r2 > 0.6 ? "a clean" : r.r2 > 0.3 ? "a rough" : "no real";
  return `<li><b>${r.w} bars</b> (${days}): ${strength} ${r.isUp ? "up" : "down"}trend — ${pct(r.pct, 0)}/yr, ${term("r2", "R²")} ${fmt(r.r2)}</li>`;
}

function renderExplain() {
  const s = A.setup, f = A.fundamentals || {};
  const where = Math.abs(s.z) < 0.5 ? "right on the middle line" : s.z < 0 ? `${fmt(-s.z)}σ <b>below</b> the middle line` : `${fmt(s.z)}σ <b>above</b> the middle line`;
  const fit = s.r2 > 0.6 ? "a strong trend — the line means something" : s.r2 > 0.3 ? "a loose trend" : "basically no trend — price is going sideways, so the channel is a range, not a ramp";
  const tfs = A.timeframes;
  const ups = tfs.filter((r) => r.isUp && r.r2 > 0.3).length, downs = tfs.filter((r) => !r.isUp && r.r2 > 0.3).length;
  const conflict = ups && downs ? `<p>⚖️ The timeframes <b>disagree</b>: some clean uptrends, some clean downtrends. That's why the ${term("composite", "verdict")} is <b>${esc(s.verdict)}</b>. Usually it means a short-term move against a longer trend — the question is which one wins.</p>` : "";
  const val = f.trailingPE ? `<p>💵 Valuation: ${term("pe", "P/E")} ${fmt(f.trailingPE, 1)} trailing / ${fmt(f.forwardPE, 1)} forward.${f.analystTarget ? ` Analysts' average target ${fmt(f.analystTarget)} (${pct((f.analystTarget / A.price - 1) * 100)} from here, ${esc(f.analystRating || "")}).` : ""}</p>` : "";
  const plan = s.plan
    ? `<p>📐 Mechanical plan: entry ${fmt(s.plan.entry)}, ${term("stop")} ${fmt(s.plan.stop)} (2×${term("atr", "ATR")} = ${fmt(2 * s.atr)} below), ${term("target", "T2")} ${fmt(s.plan.target2)}, ${term("rr", "R:R")} ${fmt(s.plan.rr, 1)}.</p>`
    : `<p>📐 No trade plan: the setup is <b>${esc(s.bias)}</b>. The engine only drafts plans for long setups (pullbacks in uptrends, range lows).</p>`;

  $("#coachExplain").innerHTML = `
    <p>Each candle is one ${term("bar", "bar")} (one trading day). The blue lines are a ${term("regression", "regression line")} through the last <b>${s.lookback}</b> bars and its ${term("channel", "±2σ channel")}.</p>
    <p>📍 Price ${fmt(A.price)} is ${where} (${term("z", "z")} = ${fmt(s.z)}). The middle line is ${fmt(s.fit)}, and one ${term("sigma", "σ")} is ${fmt(s.sigma)}.</p>
    <p>📏 ${term("r2", "R²")} = ${fmt(s.r2, 3)}: ${fit}. Slope ${pct(s.trendPct)}/yr.</p>
    <p>🧭 Every ${term("lookback")} tells a different story:</p>
    <ul>${tfs.map(tfLine).join("")}</ul>
    ${conflict}
    <p>🏷️ Setup: <b>${esc(s.label || s.setup)}</b> → <b>${esc(s.bias)}</b>. Daily wiggle (${term("atr", "ATR")}) ≈ ${fmt(s.atr)}.</p>
    ${plan}${val}
    <p class="muted">⚠️ ${esc(s.edge)} ${term("backtest", "What's a backtest?")}</p>
    <div class="row"><b>Your call — next 20 bars?</b>
      <button class="btn" data-call="up">▲ Higher</button><button class="btn" data-call="down">▼ Lower</button>
      <button class="btn" data-ask="What do you think ${esc(A.symbol)} does over the next 20 bars? Walk me through the bull and bear case, then quiz me.">Ask Claude</button></div>`;
}

// ---------------------------------------------------------------- your calls (graded later)
const CALLS = "invest.calls";
function lockCall(dir) {
  const calls = store.get(CALLS, []);
  const last = H.state.bars[H.state.bars.length - 1];
  calls.push({ symbol: A.symbol, dir, price: A.price, time: last.time, setup: A.setup.setup, made: Date.now() });
  store.set(CALLS, calls.slice(-100));
  toast(`Locked: ${A.symbol} ${dir === "up" ? "higher" : "lower"} than ${fmt(A.price)} in 20 bars. It gets graded automatically when you open ${A.symbol} after that.`);
  renderCalls();
}
function gradeCalls() {
  const bars = H.state.bars, calls = store.get(CALLS, []);
  let changed = false;
  for (const c of calls) {
    if (c.result || c.symbol !== H.state.symbol) continue;
    const i = bars.findIndex((b) => b.time > c.time);
    if (i < 0 || bars.length - i < 20) continue;
    const later = bars[i + 19].close;
    c.result = (later > c.price) === (c.dir === "up") ? "right" : "wrong";
    c.later = later; changed = true;
  }
  if (changed) store.set(CALLS, calls);
  renderCalls();
}
function renderCalls() {
  const calls = store.get(CALLS, []).slice(-6).reverse();
  $("#coachCalls").innerHTML = calls.length ? calls.map((c) =>
    `<div>${esc(c.symbol)} ${c.dir === "up" ? "▲" : "▼"} from ${fmt(c.price)} · ${c.result ? `<b class="${c.result === "right" ? "up" : "down"}">${c.result}</b> (${fmt(c.later)})` : "pending"}</div>`).join("")
    : `<span class="muted">No calls yet.</span>`;
}

// ---------------------------------------------------------------- Quiz
const QUIZ = "invest.quiz";
function choicesNum(right, spread, d = 2) {
  const opts = new Set([fmt(right, d)]);
  for (const k of [-2, -1, 1, 2]) { if (opts.size >= 4) break; opts.add(fmt(right + k * spread, d)); }
  return { right: fmt(right, d), opts: shuffle([...opts]) };
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function makeQuestions() {
  const s = A.setup, tfs = A.timeframes, qs = [];
  qs.push({ q: `Price is at z = ${fmt(s.z)}. Where is it?`, opts: ["Above the middle line", "Below the middle line", "Basically on the middle line"],
    right: Math.abs(s.z) < 0.25 ? 2 : s.z > 0 ? 0 : 1, why: `z is distance from the middle line in σ. ${fmt(s.z)} is ${Math.abs(s.z) < 0.25 ? "within a quarter σ — on the line" : s.z > 0 ? "positive — above" : "negative — below"}.`, t: "z" });
  qs.push({ q: `R² for the ${s.lookback}-bar line is ${fmt(s.r2, 3)}. How much should you trust its slope?`, opts: ["A lot — strong trend", "Somewhat — loose trend", "Barely — price is going sideways"],
    right: s.r2 > 0.6 ? 0 : s.r2 > 0.3 ? 1 : 2, why: "R² above 0.6 = real trend, 0.3–0.6 = loose, below 0.3 = the straight line explains little.", t: "r2" });
  qs.push({ q: "On this chart, what is one 'bar'?", opts: ["One trading day", "One hour", "One week", "One month"], right: H.state.barsPerYear === 52 ? 2 : 0,
    why: H.state.barsPerYear === 52 ? "10Y/Max charts use weekly bars." : "1Y/2Y/5Y charts use daily bars — 252 a year.", t: "bar" });
  qs.push({ q: "Roughly how long is a 120-bar lookback on a daily chart?", opts: ["~1 month", "~3 months", "~6 months", "~1 year"], right: 2, why: "~21 trading days a month → 120 bars ≈ 6 months. 60 ≈ 3 months, 250 ≈ 1 year.", t: "lookback" });
  const n = choicesNum(A.price - 2 * s.atr, s.atr / 2);
  qs.push({ q: `ATR is ${fmt(s.atr)}. Where does a 2×ATR stop go for a long from ${fmt(A.price)}?`, opts: n.opts, right: n.opts.indexOf(n.right), why: `${fmt(A.price)} − 2 × ${fmt(s.atr)} = ${n.right}.`, t: "atr" });
  const bp = Math.round(Math.abs((A.price / A.previousClose - 1) * 10000));
  const b = { right: `${bp} bps`, opts: shuffle([`${bp} bps`, `${bp * 10} bps`, `${Math.max(1, Math.round(bp / 10))} bps`, `${bp + 100} bps`].filter((v, i, a) => a.indexOf(v) === i)) };
  qs.push({ q: `Today's move is ${pct((A.price / A.previousClose - 1) * 100, 2)}. How many basis points is that?`, opts: b.opts, right: b.opts.indexOf(b.right), why: `1 bp = 0.01%, so ${pct((A.price / A.previousClose - 1) * 100, 2)} ≈ ${bp} bps.`, t: "bps" });
  const short = tfs.find((r) => r.w === 20), mid = tfs.find((r) => r.w === 60);
  if (short && mid && short.isUp !== mid.isUp) {
    qs.push({ q: `The 60-bar line points ${mid.isUp ? "up" : "down"} but the 20-bar line points ${short.isUp ? "up" : "down"}. What's the best read?`,
      opts: [`A short-term ${short.isUp ? "bounce" : "pullback"} inside a ${mid.isUp ? "rising" : "falling"} 3-month trend`, "The trend has definitely reversed", "The data is wrong"], right: 0,
      why: "Short lookbacks flip first. One month against three months is a pullback/bounce until the longer line turns too.", t: "lookback" });
  }
  if (s.plan) qs.push({ q: `Reward to T2 is ${fmt(s.plan.target2 - A.price)} and risk to the stop is ${fmt(A.price - s.plan.stop)}. Is R:R ${fmt(s.plan.rr, 1)} worth taking?`,
    opts: ["Yes, above ~1.5", "No, below ~1.5"], right: s.plan.rr >= 1.5 ? 0 : 1, why: "Rule of thumb: you want at least ~1.5–2× reward per unit of risk, because you'll be wrong a lot.", t: "rr" });
  return qs;
}

let currentQ = null;
function newQuestion() {
  if (!A) return;
  const qs = makeQuestions();
  currentQ = qs[Math.floor(Math.random() * qs.length)];
  const score = store.get(QUIZ, { right: 0, total: 0 });
  $("#coachQuiz").innerHTML = `
    <div class="muted" id="quizScore">Score ${score.right}/${score.total}</div>
    <p class="q">${esc(currentQ.q)}</p>
    ${currentQ.opts.map((o, i) => `<button class="btn opt" data-opt="${i}">${esc(o)}</button>`).join("")}
    <div id="quizWhy"></div>
    <div class="row"><button class="btn" id="quizNext">Next question</button>
    <button class="btn" data-ask="Give me one harder multiple-choice question about this ${esc(A.symbol)} chart. Don't reveal the answer until I reply.">Claude, quiz me harder</button></div>`;
}
function answer(i) {
  if (!currentQ || currentQ.done) return;
  currentQ.done = true;
  const ok = i === currentQ.right, score = store.get(QUIZ, { right: 0, total: 0 });
  store.set(QUIZ, { right: score.right + (ok ? 1 : 0), total: score.total + 1 });
  $("#quizScore").textContent = `Score ${score.right + (ok ? 1 : 0)}/${score.total + 1}`;
  document.querySelectorAll("#coachQuiz .opt").forEach((b, j) => b.classList.add(j === currentQ.right ? "good" : j === i ? "bad" : "dim"));
  $("#quizWhy").innerHTML = `<p><b class="${ok ? "up" : "down"}">${ok ? "Right." : "Not quite."}</b> ${esc(currentQ.why)} ${term(currentQ.t, "Learn the term")}</p>`;
}

// ---------------------------------------------------------------- Predict (hidden past)
const GAME = "invest.predict";
function startRound() {
  const full = H.state.bars;
  if (full.length < 300 || H.state.barsPerYear !== 252) { $("#coachPredict").innerHTML = `<p class="muted">Switch the range to 2Y or 5Y — the game needs a year of history before the hidden point.</p>`; return; }
  const cut = 250 + Math.floor(Math.random() * (full.length - 250 - 21));
  const visible = full.slice(0, cut + 1);
  const s = channelSetup(visible, { lookback: H.state.lookback || 120 });
  replay = { full, cut, s };
  H.state.bars = visible; H.render();
  const date = new Date(visible[cut].time * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  $("#coachPredict").innerHTML = `
    <p>The chart is now frozen on <b>${date}</b> — everything after is hidden.</p>
    <p>Engine read then: <b>${esc(s.setup)}</b> (${esc(s.bias)}), z ${fmt(s.z)}, R² ${fmt(s.r2)}, verdict ${esc(s.verdict)}.</p>
    <p><b>Will price be higher or lower 20 bars later?</b></p>
    <button class="btn" data-guess="up">▲ Higher</button><button class="btn" data-guess="down">▼ Lower</button>`;
}
function guess(dir) {
  const { full, cut, s } = replay;
  const now = full[cut].close, later = full[cut + 20].close;
  const ok = (later > now) === (dir === "up");
  const engineCall = s.bias === "long" ? "up" : null;
  const g = store.get(GAME, { right: 0, total: 0 });
  store.set(GAME, { right: g.right + (ok ? 1 : 0), total: g.total + 1 });
  H.state.bars = full; replay = null; H.render();
  const g2 = store.get(GAME, { right: 0, total: 0 });
  $("#coachPredict").innerHTML = `
    <p><b class="${ok ? "up" : "down"}">${ok ? "Right!" : "Wrong."}</b> ${fmt(now)} → ${fmt(later)} (${pct((later / now - 1) * 100)}) over the next 20 bars.</p>
    <p>${engineCall ? `The engine said <b>long</b> here — it was ${(later > now) ? "right" : "wrong"}.` : `The engine had no trade (${esc(s.bias)}).`}</p>
    <p class="muted">Your record: ${g2.right}/${g2.total} (${g2.total ? Math.round((g2.right / g2.total) * 100) : 0}%). A coin flip gets ~50%; stocks drift up, so "always higher" gets ~55%.</p>
    <button class="btn" id="predictStart">Play again</button>`;
}

// ---------------------------------------------------------------- Ask Claude
const history = [];
async function ask(text) {
  if (!text.trim()) return;
  setTab("ask");
  history.push({ role: "user", content: text });
  drawChat(true);
  try {
    const r = await fetch("/api/claude", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, symbol: H.state.symbol, lookback: H.state.lookback || 120, mode: "teacher" }),
    });
    const d = await r.json();
    history.push({ role: "assistant", content: d.text || `(${d.error || "no answer"})`, brain: d.brain });
  } catch (e) {
    history.push({ role: "assistant", content: `(couldn't reach Claude: ${e.message})` });
  }
  drawChat(false);
}
function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/\n/g, "<br>"); }
function drawChat(thinking) {
  $("#coachChat").innerHTML = history.map((m) => `<div class="msg ${m.role}">${md(m.content)}${m.brain ? `<small>${esc(m.brain)}</small>` : ""}</div>`).join("")
    + (thinking ? `<div class="msg assistant muted">thinking…</div>` : "");
  $("#coachChat").scrollTop = 1e9;
}

// ---------------------------------------------------------------- toast / tabs / wiring
function toast(t) { const el = $("#coachToast"); el.textContent = t; el.style.display = "block"; setTimeout(() => (el.style.display = "none"), 5000); }
function setTab(name) {
  document.querySelectorAll(".ctab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".cpane").forEach((p) => (p.style.display = p.dataset.pane === name ? "block" : "none"));
  store.set("invest.coachTab", name);
}

$("#coach").addEventListener("click", (e) => {
  const t = e.target.closest("[data-t]"); if (t) return showTerm(t.dataset.t, t);
  const tab = e.target.closest(".ctab"); if (tab) return setTab(tab.dataset.tab);
  const a = e.target.closest("[data-ask]"); if (a) return ask(a.dataset.ask);
  const c = e.target.closest("[data-call]"); if (c) return lockCall(c.dataset.call);
  const o = e.target.closest("[data-opt]"); if (o) return answer(+o.dataset.opt);
  const g = e.target.closest("[data-guess]"); if (g) return guess(g.dataset.guess);
  if (e.target.id === "quizNext") return newQuestion();
  if (e.target.id === "predictStart") return startRound();
});
$("#coachForm").addEventListener("submit", (e) => { e.preventDefault(); const i = $("#coachInput"); ask(i.value); i.value = ""; });
$("#coachGlossary").innerHTML = Object.keys(GLOSSARY).map((k) => term(k)).join(" ");

window.addEventListener("invest:loaded", refresh);
setTab(store.get("invest.coachTab", "explain"));
if (H.state.bars.length) refresh();
