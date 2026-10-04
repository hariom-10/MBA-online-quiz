import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { recognizePdf } from "./server/pdfOcr.mjs";
import { extractPdfText, isUsablePdfText } from "./server/pdfText.mjs";

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
const adminSalt = "mba-prep-initial-admin-v1";
const adminHash = "ceaf104b4d5088774e289a46d9f99f4f9014d82602cc50d55d3d1dd0e24cd050";
const adminSessions = new Map();
const sessionCookie = "mba_admin_session";
const sessionLifetimeMs = 8 * 60 * 60 * 1000;

function loadEnvFile(path, { preferLocalGeminiKey = false } = {}) {
  return readFile(path, "utf8").then((contents) => {
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
      if (match && (process.env[match[1]] === undefined || process.env[match[1]] === "" || (preferLocalGeminiKey && match[1] === "GEMINI_API_KEY"))) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
        if (match[1] === "GEMINI_API_KEY") geminiApiKeySource = path;
      }
    }
  }).catch(() => {});
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s, 2)).filter(([key, value]) => key && value !== undefined));
}

function cookieOptions(req, maxAge) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function currentAdmin(req) {
  const value = parseCookies(req.headers.cookie)[sessionCookie];
  const session = value && adminSessions.get(value);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { adminSessions.delete(value); return null; }
  session.expiresAt = Date.now() + sessionLifetimeMs;
  return session.profile;
}

function createAdminSession(req, res) {
  const key = randomBytes(32).toString("base64url");
  const profile = { uid: "local-admin", name: "Administrator", email: "", studentId: "admin", role: "admin", status: "active", createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
  adminSessions.set(key, { profile, expiresAt: Date.now() + sessionLifetimeMs });
  res.setHeader("Set-Cookie", `${sessionCookie}=${key}; ${cookieOptions(req, sessionLifetimeMs / 1000)}`);
  return profile;
}

async function bodyBuffer(req, max = 18 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("The upload exceeds the 18 MB limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function streamPdfOcr(req, res) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event) => res.write(`${JSON.stringify(event)}\n`);
  try {
    const buffer = await bodyBuffer(req);
    const result = await recognizePdf(buffer, send);
    send({ type: "complete", ...result });
  } catch (error) {
    console.error("[pdf-import] Unable to extract PDF text with OCR:", error);
    send({ type: "error", message: "Unable to extract text from this PDF. Please try another PDF." });
  } finally {
    res.end();
  }
}

const questionSchema = {
  type: "object", additionalProperties: false,
  properties: { questions: { type: "array", items: { type: "object", additionalProperties: false, properties: {
    questionNumber: { type: ["integer", "null"] }, question: { type: "string" }, type: { type: "string", enum: ["MCQ", "Multiple Correct", "True/False", "Numerical", "Fill in the Blank", "Short Answer", "Long Answer", "Assertion & Reason", "Match the Following", "Other"] },
    options: { type: "array", items: { type: "string" } }, correctAnswer: { type: "string" }, explanation: { type: "string" }, examId: { type: "string" }, subject: { type: "string" }, section: { type: "string" }, chapter: { type: "string" }, topic: { type: "string" }, difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] }, tags: { type: "array", items: { type: "string" } }, confidence: { type: "string", enum: ["High", "Medium", "Low"] }, confidenceReason: { type: "string" },
  }, required: ["questionNumber", "question", "type", "options", "correctAnswer", "explanation", "examId", "subject", "section", "chapter", "topic", "difficulty", "tags", "confidence", "confidenceReason"] } } }, required: ["questions"],
};

async function analyze(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI service is not configured. Please contact the system administrator.");
  let model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!model || model.includes("3.6") || model.includes("3.8") || model.includes("flash-medium")) {
    model = "gemini-2.5-flash";
  }
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: JSON.stringify({ catalog: body.catalog, text: body.text, batchNumber: body.batchNumber }),
      config: {
        systemInstruction: "Extract every complete question in the provided text. Return only questions present in the text. Use the provided exam, subject/section and chapter catalog; choose exact existing IDs/names where suitable. If a chapter does not match, put a concise suggested chapter name. Never invent a subject or section. Use examId from the catalog. Preserve source answer key if present; otherwise solve carefully. Generate concise, instructional explanations. For uncertainty use Low/Medium confidence and explain why. Keep each question self-contained and include options exactly. OCR may confuse characters (for example 1O/10, O/0, x/?) or break mathematical expressions: normalize only when the intended meaning is clear from context. Do not guess missing or ambiguous wording; preserve it and set Low confidence with a short review reason. Text marked as low-confidence OCR requires extra scrutiny.",
        responseMimeType: "application/json",
        responseJsonSchema: questionSchema,
      },
    });
    if (!response.text) throw new Error("Empty Gemini response.");
    const parsed = JSON.parse(response.text);
    if (!Array.isArray(parsed.questions)) throw new Error("Gemini response did not contain a question list.");
    return parsed;
  } catch (error) {
    const rawStatus = error && typeof error === "object" ? error.status : undefined;
    const status = Number.isInteger(rawStatus) ? rawStatus : undefined;
    const providerMessage = error instanceof Error ? error.message : String(error);
    const safeProviderMessage = providerMessage
      .split(apiKey).join("[REDACTED]")
      .split(encodeURIComponent(apiKey)).join("[REDACTED]");
    console.error("[ai-import] Gemini request failed.", { status, message: safeProviderMessage });
    throw new Error(`Gemini API error: ${safeProviderMessage}`);
  }
}

export async function handleApi(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!pathname.startsWith("/api/")) return false;
  if (req.method === "GET" && pathname === "/api/auth/session") {
    const profile = currentAdmin(req);
    return json(res, profile ? 200 : 401, profile ? { profile } : { error: "Sign in as an administrator to continue." }), true;
  }
  if (pathname === "/api/auth/admin/login" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Sign in request was rejected." }), true;
    try {
      const input = JSON.parse((await bodyBuffer(req, 4096)).toString("utf8"));
      const id = typeof input.studentId === "string" ? input.studentId.trim().toLowerCase() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (id !== "admin" || !password || password.length > 128) return json(res, 401, { error: "Admin ID or password is incorrect." }), true;
      const envPass = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD;
      const isEnvMatch = Boolean(envPass && password === envPass);
      const candidate = pbkdf2Sync(password, adminSalt, 210_000, 32, "sha256");
      const expected = Buffer.from(adminHash, "hex");
      if (!isEnvMatch && !timingSafeEqual(candidate, expected)) return json(res, 401, { error: "Admin ID or password is incorrect." }), true;
      return json(res, 200, { profile: createAdminSession(req, res) }), true;
    } catch {
      return json(res, 400, { error: "Sign in request was invalid." }), true;
    }
  }
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Sign out request was rejected." }), true;
    const value = parseCookies(req.headers.cookie)[sessionCookie];
    if (value) adminSessions.delete(value);
    res.setHeader("Set-Cookie", `${sessionCookie}=; ${cookieOptions(req, 0)}`);
    return json(res, 200, { ok: true }), true;
  }
  if (req.method !== "POST" || !["/api/pdf/text", "/api/pdf/ocr", "/api/pdf/analyze"].includes(pathname)) return json(res, 404, { error: "Unknown API endpoint." }), true;
  if (!sameOrigin(req)) return json(res, 403, { error: "Request was rejected." }), true;
  if (!currentAdmin(req)) return json(res, 401, { error: "Your admin session expired. Sign in again." }), true;
  if (!process.env.GEMINI_API_KEY) return json(res, 503, { error: "AI service is not configured. Please contact the system administrator." }), true;
  if (pathname === "/api/pdf/ocr") { await streamPdfOcr(req, res); return true; }
  try {
    if (pathname === "/api/pdf/text") {
      const buffer = await bodyBuffer(req);
      const text = extractPdfText(buffer);
      return json(res, 200, { text, ocrRequired: !isUsablePdfText(text) }), true;
    }
    const payload = JSON.parse((await bodyBuffer(req, 2 * 1024 * 1024)).toString("utf8"));
    if (typeof payload.text !== "string" || payload.text.length > 18000) return json(res, 400, { error: "Invalid or oversized question batch." }), true;
    return json(res, 200, await analyze(payload)), true;
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Question processing failed." }), true;
  }
}

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
