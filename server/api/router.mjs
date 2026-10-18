import { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { adminSalt, adminHash, adminSessions, sessionCookie, sessionLifetimeMs, json, parseCookies, cookieOptions, sameOrigin, currentAdmin, createAdminSession, bodyBuffer } from "../utils.mjs";
import { extractPdfText, isUsablePdfText, recognizePdf, analyze, streamPdfOcr } from "./pdfHandler.mjs";
import { db } from "../adminFirebase.mjs";

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

  // --- Secure Admin Import Endpoint ---
  if (pathname === "/api/admin/questions/import" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
    
    try {
      const questions = JSON.parse((await bodyBuffer(req, 5 * 1024 * 1024)).toString("utf8")); // 5MB limit
      if (!Array.isArray(questions) || questions.length === 0 || questions.length > 500) {
        return json(res, 400, { error: "Invalid batch size." }), true;
      }

      const batch = db.batch();
      questions.forEach((q) => {
        const docRef = db.collection("examQuestions").doc(q.id);
        batch.set(docRef, { ...q, importedAt: new Date().toISOString(), status: "published" });
      });
      await batch.commit();
      return json(res, 200, { success: true, count: questions.length }), true;
    } catch (e) {
      return json(res, 500, { error: "Failed to persist questions." }), true;
    }
  }
  // ------------------------------------

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
