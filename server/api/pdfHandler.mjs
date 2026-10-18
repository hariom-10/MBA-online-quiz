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
          questionNumber: { type: ["number", "null"] },
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI service is not configured. Please contact the system administrator.");
  let model = process.env.GEMINI_MODEL || "gemini-2.5-flash ";
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

