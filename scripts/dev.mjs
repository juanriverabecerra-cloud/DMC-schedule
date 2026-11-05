// Local server that mimics Netlify: serves public/ and routes /api, /cal and /bg to the functions.
// Data goes to .localdata/. Passcode "dev", admin key "devadmin" unless set in the environment.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.DMC_LOCAL_STORE ||= path.join(root, ".localdata");
process.env.APP_PASSCODE ||= "dev";
process.env.ADMIN_KEY ||= "devadmin";

const { default: api } = await import("../netlify/functions/api.mjs");
const backgrounds = {
  "/bg/parse-photo": (await import("../netlify/functions/parse-photo-background.mjs")).default,
  "/bg/parse-didactics": (await import("../netlify/functions/parse-didactics-background.mjs")).default,
};

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

const port = Number(process.env.PORT || 8888);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (/^\/(api|cal|bg)\//.test(url.pathname)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      if (url.pathname.startsWith("/bg/")) {
        const background = backgrounds[url.pathname];
        res.writeHead(background ? 202 : 404).end();
        background?.(request).catch((e) => console.error("background:", e));
        return;
      }
      const response = await api(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.join(root, "public", decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, "public"))) { res.writeHead(403).end(); return; }
    if ((await fs.stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  } catch (err) {
    if (err.code === "ENOENT") { res.writeHead(404).end("Not found"); return; }
    console.error(err);
    res.writeHead(500).end(String(err));
  }
}).listen(port, () => {
  console.log(`DMC Schedule dev server: http://localhost:${port}  (passcode "${process.env.APP_PASSCODE}", admin key "${process.env.ADMIN_KEY}")`);
});
