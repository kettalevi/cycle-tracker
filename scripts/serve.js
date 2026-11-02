// Tiny static server for local development: `npm start` then open http://localhost:8080
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const port = process.env.PORT || 8080;

http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
