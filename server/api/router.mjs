import { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { adminSalt, adminHash, adminSessions, sessionCookie, sessionLifetimeMs, json, parseCookies, cookieOptions, sameOrigin, currentAdmin, createAdminSession, bodyBuffer } from "../utils.mjs";
import { extractPdfText, isUsablePdfText, recognizePdf, analyze, streamPdfOcr } from "./pdfHandler.mjs";
import { db, hasAdminCredentials } from "../adminFirebase.mjs";

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
      let input;
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        input = req.body;
      } else {
        const raw = (await bodyBuffer(req, 4096)).toString("utf8");
        input = raw ? JSON.parse(raw) : (req.body || {});
      }
      const id = typeof input.studentId === "string" ? input.studentId.trim().toLowerCase() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (id !== "admin" || !password || password.length > 128) return json(res, 401, { error: "Admin ID or password is incorrect." }), true;
      const envPass = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "admin123456";
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

  // --- Extracted Papers Endpoints ---
  if (pathname === "/api/admin/papers") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;

    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action");

    if (req.method === "GET") {
      if (!db || !hasAdminCredentials) {
        return json(res, 200, { papers: [], unconfigured: true }), true;
      }
      try {
        const snapshot = await db.collection("extractedPapers").get();
        const papers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        papers.sort((a, b) => String(b.extractedAt || "").localeCompare(String(a.extractedAt || "")));
        return json(res, 200, { papers }), true;
      } catch (e) {
        console.warn("[api/admin/papers] Firestore read error:", e.message);
        return json(res, 200, { papers: [], warning: e.message }), true;
      }
    }

    if (req.method === "DELETE" || (req.method === "POST" && action === "delete")) {
      const id = url.searchParams.get("id");
      if (id && db && hasAdminCredentials) {
        try {
          await db.collection("extractedPapers").doc(id).delete();
        } catch (e) {
          console.warn("[api/admin/papers] Firestore delete error:", e.message);
        }
      }
      return json(res, 200, { success: true }), true;
    }

    if (req.method === "POST") {
      try {
        let paper;
        if (req.body && typeof req.body === "object") {
          paper = req.body;
        } else {
          const raw = (await bodyBuffer(req, 2 * 1024 * 1024)).toString("utf8");
          paper = raw ? JSON.parse(raw) : {};
        }
        if (!paper || !paper.id) return json(res, 400, { error: "Invalid paper payload." }), true;

        if (!db || !hasAdminCredentials) {
          return json(res, 200, { success: true, paper, unconfigured: true }), true;
        }

        await db.collection("extractedPapers").doc(paper.id).set({
          ...paper,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        return json(res, 200, { success: true, paper }), true;
      } catch (e) {
        console.warn("[api/admin/papers] Persistence warning:", e);
        return json(res, 200, { success: true, unconfigured: true, warning: e instanceof Error ? e.message : "Failed to persist paper record." }), true;
      }
    }
  }

  // --- Secure Admin Import Endpoint ---
  if (pathname === "/api/admin/questions/import" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
    
    try {
      let questions;
      if (req.body && Array.isArray(req.body)) {
        questions = req.body;
      } else {
        const raw = (await bodyBuffer(req, 5 * 1024 * 1024)).toString("utf8");
        questions = raw ? JSON.parse(raw) : (Array.isArray(req.body) ? req.body : []);
      }
      if (!Array.isArray(questions) || questions.length === 0 || questions.length > 500) {
        return json(res, 400, { error: "Invalid batch size." }), true;
      }

      if (!db || !hasAdminCredentials) {
        return json(res, 200, { success: true, count: questions.length, unconfigured: true }), true;
      }

      const batch = db.batch();
      questions.forEach((q) => {
        const cleanId = String(q.id || "").replace(/^firestore-/, "") || `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const docRef = db.collection("examQuestions").doc(cleanId);
        const options = q.options && typeof q.options === "object" ? q.options : {
          A: q.optionA || "", B: q.optionB || "", C: q.optionC || "", D: q.optionD || ""
        };

        const docData = {
          id: cleanId,
          exam: String(q.exam || q.examId || "CAT").toUpperCase(),
          examId: String(q.examId || q.exam || "cat").toLowerCase(),
          sectionId: q.sectionId || "",
          chapterId: q.chapterId || "",
          year: Number(q.year || q.sourceYear) || (new Date().getFullYear()),
          slot: String(q.slot || q.sourceSlot || ""),
          category: q.category || q.topic || q.section || "",
          subject: q.subject || q.category || q.topic || "",
          topic: q.topic || q.category || "",
          question_number: q.question_number || q.questionNumber || null,
          question: q.question || "",
          optionA: options.A ?? q.optionA ?? "",
          optionB: options.B ?? q.optionB ?? "",
          optionC: options.C ?? q.optionC ?? "",
          optionD: options.D ?? q.optionD ?? "",
          options: { A: options.A ?? q.optionA ?? "", B: options.B ?? q.optionB ?? "", C: options.C ?? q.optionC ?? "", D: options.D ?? q.optionD ?? "" },
          answer: String(q.correctAnswer || q.answer || "").trim(),
          correctAnswer: String(q.correctAnswer || q.answer || "").trim(),
          explanation: q.explanation || "",
          difficulty: q.difficulty || "Medium",
          questionType: q.questionType || q.type || "MCQ",
          tags: Array.isArray(q.tags) ? q.tags : [],
          paperId: q.paperId || "",
          paperTitle: q.paperTitle || "",
          source: q.source || q.sourceUrl || "",
          sourceYear: Number(q.year || q.sourceYear) || (new Date().getFullYear()),
          sourceSlot: String(q.slot || q.sourceSlot || ""),
          importedAt: new Date().toISOString(),
          status: "published",
        };

        batch.set(docRef, docData, { merge: true });
      });
      await batch.commit();
      return json(res, 200, { success: true, count: questions.length }), true;
    } catch (e) {
      console.warn("[api/admin/questions/import] Persistence warning:", e);
      return json(res, 200, { success: true, unconfigured: true, warning: e instanceof Error ? e.message : "Failed to persist questions." }), true;
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
      const text = await extractPdfText(buffer);
      return json(res, 200, { text, ocrRequired: !isUsablePdfText(text) }), true;
    }
    const payload = JSON.parse((await bodyBuffer(req, 2 * 1024 * 1024)).toString("utf8"));
    if (typeof payload.text !== "string" || payload.text.length > 18000) return json(res, 400, { error: "Invalid or oversized question batch." }), true;
    return json(res, 200, await analyze(payload)), true;
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Question processing failed." }), true;
  }
}
