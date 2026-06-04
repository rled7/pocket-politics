/** Minimal static server for the web/ viewer (no deps). `npm run serve` → http://localhost:5174 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const TYPES: Record<string, string> = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };
const PORT = 5174;

createServer(async (req, res) => {
  const path = req.url === "/" || !req.url ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(webDir, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}).listen(PORT, () => console.log(`Pocket Politics viewer → http://localhost:${PORT}`));
