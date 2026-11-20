// Loopback-only static preview server for the built site (dist/).
// Binds 127.0.0.1 only — never a public interface.
//
//   node scripts/serve-dist.ts [port]

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = Number(process.argv[2] ?? 4173);
const DIST = path.resolve(import.meta.dirname, "..", "dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (urlPath.endsWith("/")) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-ish fallback: try directory index, then 404.
      const idx = path.join(file, "index.html");
      if (fs.existsSync(idx)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fs.readFileSync(idx));
        return;
      }
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Preview server on http://127.0.0.1:${PORT} (loopback only)`);
});
