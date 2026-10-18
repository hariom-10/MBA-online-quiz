import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createServer as createViteServer } from "vite";
import { handleApi } from "./server/api/router.mjs";
import { loadEnvFile } from "./server/utils.mjs";

const root = process.cwd();
// In development, prefer the project's .env.local AI key over stale shell values.
// Production keeps the standard process-environment-first precedence.

let geminiApiKeySource = process.env.GEMINI_API_KEY ? "process environment" : "not configured";
await loadEnvFile(resolve(root, ".env.local"), { preferLocalGeminiKey: !process.argv.includes("--preview") });
await loadEnvFile(resolve(root, ".env"));
console.info("[ai-import] GEMINI_API_KEY configuration:", {
  detected: Boolean(process.env.GEMINI_API_KEY),
  length: process.env.GEMINI_API_KEY?.length ?? 0,
  source: geminiApiKeySource === resolve(root, ".env.local") ? ".env.local" : geminiApiKeySource,
});







const preview = process.argv.includes("--preview");
let vite;
if (!preview) vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
const port = Number(process.env.PORT || 5173);
const server = createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  if (vite) return vite.middlewares(req, res, (error) => { if (error) { res.statusCode = 500; res.end(error.message); } });
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const safePath = resolve(root, "dist", `.${pathname === "/" ? "/index.html" : pathname}`);
    const filePath = safePath.startsWith(resolve(root, "dist")) ? safePath : resolve(root, "dist/index.html");
    let body;
    try { body = await readFile(filePath); } catch { body = await readFile(resolve(root, "dist/index.html")); }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
    res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
});
server.listen(port, "0.0.0.0", () => console.log(`MBA Prep ${preview ? "preview" : "dev"} server: http://localhost:${port}`));
