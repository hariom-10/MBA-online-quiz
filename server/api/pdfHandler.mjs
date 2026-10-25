import { extractPdfText, isUsablePdfText } from "../pdfText.mjs";
import { recognizePdf } from "../pdfOcr.mjs";
import { GoogleGenAI } from "@google/genai";

const questionSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "number", nullable: true },
          question: { type: "string" },
          type: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctAnswer: { type: "string" },
          explanation: { type: "string" },
          examId: { type: "string" },
          subject: { type: "string" },
          section: { type: "string" },
          chapter: { type: "string" },
          topic: { type: "string" },
          difficulty: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["High", "Medium", "Low"] },
          confidenceReason: { type: "string" }
        },
        required: ["question", "type", "options", "correctAnswer", "explanation", "examId", "subject", "section", "chapter", "topic", "difficulty", "tags", "confidence", "confidenceReason"]
      }
    }
  },
  required: ["questions"]
};

export async function analyze(body) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI service is not configured. Please contact the system administrator.");
  let targetModel = (process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || "gemini-3.8-flash").trim();
  if (targetModel.includes("1.5") || targetModel.includes("2.0") || targetModel.includes("2.5")) {
    targetModel = "gemini-3.8-flash";
  }

  const candidateModels = Array.from(new Set([
    targetModel,
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3-flash",
  ]));

  const ai = new GoogleGenAI({ apiKey });
  let lastError = null;

  for (const m of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: JSON.stringify({ catalog: body.catalog, text: body.text, batchNumber: body.batchNumber }),
          config: {
            systemInstruction: "Extract every complete question in the provided text. Return only questions present in the text. " +
              "CRITICAL RULE FOR QUESTION STEM: Some questions have long passages, multiple introductory paragraphs, conditions, rules, tables, or scenarios (such as student-switching conditions, stream distributions, or data tables) before the question sentence. You MUST preserve and include the ENTIRE question stem—including all introductory paragraphs, conditions, background info, tables, and the actual question sentence—in the 'question' field. NEVER omit the passage or conditions. NEVER extract only the final sentence. Preserve readable paragraph breaks with double newlines (\\n\\n). " +
              "CRITICAL RULE FOR OPTIONS: Support questions with any number of options (4 options, 5 options, etc.). If the original question has five options (Option 1 to Option 5, or A to E, including 'None of the remaining options is correct'), you MUST extract all 5 options in the 'options' array. Never drop or omit the 5th option. For questions with options A, B, C, D, E, set 'correctAnswer' to the corresponding option letter (A, B, C, D, or E). " +
              "Use the provided exam, subject/section and chapter catalog; choose exact existing IDs/names where suitable. If a chapter does not match, put a concise suggested chapter name. Never invent a subject or section. Use examId from the catalog. Preserve source answer key if present; otherwise solve carefully. Generate concise, instructional explanations. For uncertainty use Low/Medium confidence and explain why. OCR may confuse characters (for example 1O/10, O/0, x/?) or break mathematical expressions: normalize only when the intended meaning is clear from context. Do not guess missing or ambiguous wording; preserve it and set Low confidence with a short review reason. Text marked as low-confidence OCR requires extra scrutiny.",
            responseMimeType: "application/json",
            responseJsonSchema: questionSchema,
          },
        });
        if (!response.text) throw new Error("Empty Gemini response.");
        const parsed = JSON.parse(response.text);
        if (!Array.isArray(parsed.questions)) throw new Error("Gemini response did not contain a question list.");
        return parsed;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        lastError = error;
        const isTemporary = /503|high demand|unavailable|capacity|429|exhausted|quota|timeout/i.test(msg);
        if (isTemporary && attempt === 1) {
          console.warn(`[ai-import] Model ${m} busy (attempt ${attempt}), retrying in 1200ms...`);
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        if (isTemporary || /404|not found|not supported/i.test(msg)) {
          console.warn(`[ai-import] Model ${m} unavailable (${msg}), attempting next candidate model...`);
          break;
        }
        throw error;
      }
    }
  }

  const rawStatus = lastError && typeof lastError === "object" ? lastError.status : undefined;
  const status = Number.isInteger(rawStatus) ? rawStatus : undefined;
  const providerMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const safeProviderMessage = providerMessage
    .split(apiKey).join("[REDACTED]")
    .split(encodeURIComponent(apiKey)).join("[REDACTED]");
  console.error("[ai-import] Gemini request failed.", { status, message: safeProviderMessage });
  throw new Error(`Gemini API error: ${safeProviderMessage}`);
}

export { extractPdfText, isUsablePdfText, recognizePdf };

export async function streamPdfOcr(req, res) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
  });
  const send = (event) => res.write(`${JSON.stringify(event)}\n`);
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const result = await recognizePdf(buffer, send);
    send({ type: "complete", ...result });
  } catch (error) {
    console.error("[ocr] Stream failed:", error);
    send({ type: "error", message: error instanceof Error ? error.message : "OCR failed." });
  } finally {
    res.end();
  }
}

