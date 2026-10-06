// invest — local terminal server for the Mac. Serves public/ and routes /api/*
// through the same handler the Cloudflare Worker uses, so the page behaves
// identically here and on workers.dev. Bound to 127.0.0.1 only.
//   node server.mjs            → http://127.0.0.1:8811

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./src/worker.js";

const PORT = +(process.env.INVEST_PORT || 8811);
const PUBLIC = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
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
