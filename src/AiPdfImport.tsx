import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  AlertCircle, Check, Download, FileText, FolderArchive, Key, LoaderCircle,
  RefreshCw, Sparkles, Trash2, Upload, X, Layers, Crop, Image as ImageIcon
} from "lucide-react";
import type { Answer, Chapter, Difficulty, Exam, ExtractedPaper, Question, Section } from "./model";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { runAiWithFailover } from "./aiApiKeyStore";
import { ApiKeyManager } from "./ApiKeyManager";
import { PdfGraphSnipper } from "./PdfGraphSnipper";
import { firestore, isFirebaseConfigured } from "./firebase";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";

// Set the pdf.js worker source for client-side PDF text extraction
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export type AIQuestion = {
  questionNumber: number | null;
  question: string;
  type: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  examId: string;
  subject: string;
  section: string;
  chapter: string;
  topic: string;
  difficulty: Difficulty;
  tags: string[];
  confidence: "High" | "Medium" | "Low";
  confidenceReason: string;
  imageUrl?: string;
  imageAlt?: string;
  hasDiagram?: boolean;
};

export type ReviewItem = {
  id: string;
  value: AIQuestion;
  status: "pending" | "approved" | "rejected" | "failed";
  error?: string;
  batchText?: string;
  duplicate: boolean;
  edited: boolean;
  createChapter: boolean;
};

const PAPERS_STORAGE_KEY = "mba-extracted-papers-record";

// Smart adaptive batching: groups by detected question boundaries or ~3500 chars
function questionChunks(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const starts: number[] = [];
  const qRegex = /^\s*(?:(?:(?:Q(?:uestion|ue)?\.?|Prob(?:lem)?\.?)\s*)?\d{1,3}[.)\]:-]|\(\d{1,3}\)\s*|\bQuestion\s+\d{1,3}\b)/i;

  lines.forEach((line, index) => {
    if (qRegex.test(line)) starts.push(index);
  });

  let parts: string[] = [];
  if (starts.length > 1) {
    const boundaries = [0, ...starts.filter((n) => n > 0), lines.length];
    parts = boundaries.slice(0, -1).map((from, i) => lines.slice(from, boundaries[i + 1]).join("\n").trim()).filter(Boolean);
  }
  if (parts.length < 2) {
    const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    parts = paragraphs.length > 1 ? paragraphs : (text.match(/.{1,3500}(?:\s|$)/gs) ?? [text]);
  }

  const batches: string[] = [];
  let currentBatch: string[] = [];
  let currentLen = 0;

  for (const part of parts) {
    if (currentBatch.length >= 3 || (currentLen + part.length > 3500 && currentBatch.length > 0)) {
      batches.push(currentBatch.join("\n\n"));
      currentBatch = [];
      currentLen = 0;
    }
    currentBatch.push(part);
    currentLen += part.length;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch.join("\n\n"));
  }
  return batches.length ? batches : [text];
}

function normalize(text: string) {
  return text.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function questionToModel(
  item: AIQuestion,
  section: Section,
  chapter: Chapter | undefined,
  id: string,
  paperInfo: { paperId?: string; paperTitle?: string; year?: number; slot?: string; fileName?: string }
): Question {
  const options = item.options.slice(0, 4);
  const optionMap = { A: options[0] ?? "", B: options[1] ?? "", C: options[2] ?? "", D: options[3] ?? "" };
  const optionBased = item.type === "MCQ" && options.length >= 2 && /^[A-D]$/.test(item.correctAnswer.trim());
  return {
    id,
    examId: section.examId,
    sectionId: section.id,
    chapterId: chapter?.id ?? "",
    topic: chapter?.name ?? item.chapter,
    subTopic: item.topic || undefined,
    question: item.question,
    options: optionMap,
    answerMode: optionBased ? "choice" : "text",
    correctAnswer: item.correctAnswer.trim() || undefined,
    hasAnswerKey: Boolean(item.correctAnswer.trim()),
    explanation: item.explanation,
    difficulty: item.difficulty,
    questionType: item.type,
    tags: item.tags,
    aiConfidence: item.confidence,
    aiConfidenceReason: item.confidenceReason,
    paperId: paperInfo.paperId,
    paperTitle: paperInfo.paperTitle,
    year: paperInfo.year,
    slot: paperInfo.slot,
    sourceYear: paperInfo.year,
    sourceSlot: paperInfo.slot,
    source: paperInfo.fileName,
    question_number: item.questionNumber || undefined,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    hasDiagram: Boolean(item.hasDiagram || item.imageUrl),
  };
}

// ---------------------------------------------------------------------------
// Client-side PDF text extraction via pdfjs-dist with line/layout preservation
// ---------------------------------------------------------------------------
async function extractPdfTextClientSide(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | undefined = undefined;
    let pageStr = "";

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const str = item.str;
      if (!str && !item.hasEOL) continue;

      const currentY = item.transform ? item.transform[5] : undefined;
      if (lastY !== undefined && currentY !== undefined && Math.abs(currentY - lastY) > 6) {
        pageStr += "\n";
      } else if (pageStr && !pageStr.endsWith("\n") && !pageStr.endsWith(" ") && str) {
        pageStr += " ";
      }

      pageStr += str;

      if (item.hasEOL) {
        pageStr += "\n";
      }
      lastY = currentY;
    }

    const trimmed = pageStr.trim();
    if (trimmed) pageTexts.push(trimmed);
  }

  return pageTexts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Client-side Multi-Key AI analysis with automatic failover
// ---------------------------------------------------------------------------
const CLIENT_SYSTEM_INSTRUCTION =
  "Extract every complete question in the provided text. Return only questions present in the text. " +
  "Use the provided exam, subject/section and chapter catalog; choose exact existing IDs/names where suitable. " +
  "If a chapter does not match, put a concise suggested chapter name. Never invent a subject or section. " +
  "Use examId from the catalog. Preserve source answer key if present; otherwise solve carefully. " +
  "Generate concise, instructional explanations. For uncertainty use Low/Medium confidence and explain why. " +
  "Keep each question self-contained and include options exactly. " +
  "OCR may confuse characters (for example 1O/10, O/0, x/?); normalize only when the intended meaning is clear. " +
  "Do not guess missing or ambiguous wording; preserve it and set Low confidence with a short review reason.";

const CLIENT_QUESTION_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: { type: "number", nullable: true },
          question: { type: "string" },
          type: { type: "string", enum: ["MCQ", "Multiple Correct", "True/False", "Numerical", "Fill in the Blank", "Short Answer", "Long Answer", "Assertion & Reason", "Match the Following", "Other"] },
          options: { type: "array", items: { type: "string" } },
          correctAnswer: { type: "string" },
          explanation: { type: "string" },
          examId: { type: "string" },
          subject: { type: "string" },
          section: { type: "string" },
          chapter: { type: "string" },
          topic: { type: "string" },
          difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
          tags: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["High", "Medium", "Low"] },
          confidenceReason: { type: "string" },
        },
        required: ["question", "type", "options", "correctAnswer", "explanation", "examId", "subject", "section", "chapter", "topic", "difficulty", "tags", "confidence", "confidenceReason"],
      },
    },
  },
  required: ["questions"],
};

async function analyzeClientSide(body: { text: string; catalog: object; batchNumber: number | string }): Promise<{ questions: AIQuestion[] }> {
  return runAiWithFailover(
    CLIENT_SYSTEM_INSTRUCTION,
    JSON.stringify({ catalog: body.catalog, text: body.text, batchNumber: body.batchNumber }),
    CLIENT_QUESTION_SCHEMA,
    (rawJson) => {
      const parsed = JSON.parse(rawJson) as { questions: AIQuestion[] };
      if (!Array.isArray(parsed.questions)) throw new Error("AI response did not contain a question list.");
      return parsed;
    }
  );
}

// ---------------------------------------------------------------------------
// Unified API helpers with automatic server/client fallback
// ---------------------------------------------------------------------------
async function apiWithFallback(
  path: string,
  payload: BodyInit,
  contentType?: string,
  fallbackFn?: () => Promise<unknown>,
): Promise<unknown> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: contentType ? { "content-type": contentType } : {},
      body: payload,
    });
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error((result as { error?: string }).error || "Request failed.");
      return result;
    }
  } catch {
    // Fall through to client fallback
  }
  if (fallbackFn) return fallbackFn();
  throw new Error("API unavailable. Please check your configuration.");
}

function guessPaperInfo(fileName: string, examsList: Exam[]) {
  const lower = fileName.toLowerCase();
  let examId = examsList[0]?.id || "cat";
  for (const e of examsList) {
    if (lower.includes(e.id.toLowerCase()) || lower.includes(e.name.toLowerCase())) {
      examId = e.id;
      break;
    }
  }
  const yearMatch = fileName.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  const slotMatch = fileName.match(/\b(?:slot|shift)\s*(\d)\b/i) || fileName.match(/\b(slot|shift)-?(\d)\b/i);
  const slot = slotMatch ? `Slot ${slotMatch[1] || slotMatch[2]}` : "Slot 1";
  const examObj = examsList.find((e) => e.id === examId);
  const cleanName = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  const paperTitle = `${examObj?.name || "Exam"} ${year} ${slot}`.trim() || cleanName;

  return { examId, year, slot, paperTitle };
}

export function AiPdfImport({ exams, sections, chapters, questions, importedBy, onApprove }: {
  exams: Exam[]; sections: Section[]; chapters: Chapter[]; questions: Question[]; importedBy: string;
  onApprove: (question: Question, createChapter: boolean) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [activeTab, setActiveTab] = useState<"extract" | "records">("extract");

  // Paper Details Form State
  const [paperId, setPaperId] = useState<string>("");
  const [paperTitle, setPaperTitle] = useState<string>("");
  const [paperExamId, setPaperExamId] = useState<string>(exams[0]?.id || "cat");
  const [paperYear, setPaperYear] = useState<number>(new Date().getFullYear());
  const [paperSlot, setPaperSlot] = useState<string>("Slot 1");

  // Extracted Papers Record State
  const [extractedPapers, setExtractedPapers] = useState<ExtractedPaper[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PAPERS_STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ step: 1, current: 0, total: 1, detected: 0, page: 0, pageCount: 0, label: "Reading PDF", stage: "reading" });
  const [ocrWarnings, setOcrWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showApiKeysModal, setShowApiKeysModal] = useState(false);
  const [snippingItem, setSnippingItem] = useState<ReviewItem | null>(null);

  // Sync extracted papers from client Firestore and backend on mount
  useEffect(() => {
    // 1. Client-side Firestore direct sync
    if (isFirebaseConfigured && firestore) {
      getDocs(collection(firestore, "extractedPapers"))
        .then((snapshot) => {
          if (!snapshot.empty) {
            const remotePapers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ExtractedPaper);
            setExtractedPapers((current) => {
              const map = new Map<string, ExtractedPaper>();
              current.forEach((p) => map.set(p.id, p));
              remotePapers.forEach((p) => map.set(p.id, p));
              const merged = Array.from(map.values()).sort((a, b) => String(b.extractedAt || "").localeCompare(String(a.extractedAt || "")));
              localStorage.setItem(PAPERS_STORAGE_KEY, JSON.stringify(merged));
              return merged;
            });
          }
        })
        .catch(() => {
          /* Local storage fallback already active */
        });
    }

    // 2. Backend endpoint sync (if serverless database configured)
    fetch("/api/admin/papers")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { papers?: ExtractedPaper[] }) => {
        if (Array.isArray(data.papers) && data.papers.length > 0) {
          setExtractedPapers((current) => {
            const map = new Map<string, ExtractedPaper>();
            current.forEach((p) => map.set(p.id, p));
            data.papers?.forEach((p) => map.set(p.id, p));
            const merged = Array.from(map.values()).sort((a, b) => String(b.extractedAt || "").localeCompare(String(a.extractedAt || "")));
            localStorage.setItem(PAPERS_STORAGE_KEY, JSON.stringify(merged));
            return merged;
          });
        }
      })
      .catch(() => {
        // LocalStorage fallback already loaded
      });
  }, []);

  const pending = items.filter((item) => item.status === "pending");
  const detectedSubjects = [...new Set(items.map((item) => item.value.subject).filter(Boolean))];
  const duplicates = useMemo(() => items.filter((item) => item.duplicate).length, [items]);

  function setPdf(selected: File | undefined) {
    setError("");
    setItems([]);
    if (!selected) {
      setFile(null);
      setPaperId("");
      return;
    }
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setError("Choose a valid PDF file.");
      return;
    }
    if (selected.size > 25 * 1024 * 1024) {
      setFile(null);
      setError("PDFs must be 25 MB or smaller.");
      return;
    }

    setFile(selected);
    const guessed = guessPaperInfo(selected.name, exams);
    setPaperExamId(guessed.examId);
    setPaperYear(guessed.year);
    setPaperSlot(guessed.slot);
    setPaperTitle(guessed.paperTitle);
    setPaperId(`paper_${guessed.examId}_${guessed.year}_${guessed.slot.replace(/\s+/g, "").toLowerCase()}_${Date.now().toString(36)}`);
  }

  async function persistPaperRecord(record: ExtractedPaper) {
    setExtractedPapers((current) => {
      const filtered = current.filter((p) => p.id !== record.id);
      const next = [record, ...filtered];
      localStorage.setItem(PAPERS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    if (isFirebaseConfigured && firestore) {
      try {
        await setDoc(doc(firestore, "extractedPapers", record.id), record, { merge: true });
      } catch (err) {
        console.warn("Client Firestore paper save note:", err);
      }
    }

    try {
      await fetch("/api/admin/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
    } catch {
      // Saved in client-side Firestore & localStorage
    }
  }

  async function deletePaperRecord(id: string) {
    setExtractedPapers((current) => {
      const next = current.filter((p) => p.id !== id);
      localStorage.setItem(PAPERS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    if (isFirebaseConfigured && firestore) {
      try {
        await deleteDoc(doc(firestore, "extractedPapers", id));
      } catch (err) {
        console.warn("Client Firestore paper delete note:", err);
      }
    }

    try {
      await fetch(`/api/admin/papers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // Deleted from client-side Firestore & localStorage
    }
  }

  async function runOcr(selectedFile: File): Promise<{ text: string; failedPages: number[]; lowConfidencePages: number[] }> {
    try {
      const response = await fetch("/api/pdf/ocr", { method: "POST", credentials: "same-origin", body: selectedFile });
      const ct = response.headers.get("content-type") || "";
      if (!ct.includes("application/x-ndjson") && !ct.includes("application/json")) {
        return await runOcrClientSide(selectedFile);
      }
      if (!response.ok || !response.body) {
        return await runOcrClientSide(selectedFile);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pendingLine = "";
      const completion: { value: { text: string; failedPages: number[]; lowConfidencePages: number[] } | null } = { value: null };
      let serverFailed = false;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as { type: string; text?: string; page?: number; pageCount?: number; confidence?: number; failedPages?: number[]; lowConfidencePages?: number[]; message?: string; status?: string; progress?: number };
          if (event.type === "start") setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "PDF contains scanned pages. Running OCR...", pageCount: event.pageCount ?? 0, page: 0 }));
          if (event.type === "engine") setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "Loading OCR engine..." }));
          if (event.type === "page") setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "PDF contains scanned pages. Running OCR...", page: event.page ?? current.page, pageCount: event.pageCount ?? current.pageCount }));
          if (event.type === "complete" && typeof event.text === "string") completion.value = { text: event.text, failedPages: event.failedPages ?? [], lowConfidencePages: event.lowConfidencePages ?? [] };
          if (event.type === "error") serverFailed = true;
        } catch {
          serverFailed = true;
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        pendingLine += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = pendingLine.split(/\r?\n/);
        pendingLine = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
        if (done) break;
      }
      if (pendingLine) handleLine(pendingLine);
      if (serverFailed || !completion.value?.text.trim()) {
        return await runOcrClientSide(selectedFile);
      }
      return completion.value;
    } catch {
      return await runOcrClientSide(selectedFile);
    }
  }

  async function runOcrClientSide(selectedFile: File): Promise<{ text: string; failedPages: number[]; lowConfidencePages: number[] }> {
    setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "Running OCR in browser..." }));
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const arrayBuffer = await selectedFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    const textParts: string[] = [];
    const failedPages: number[] = [];
    const lowConfidencePages: number[] = [];
    for (let i = 1; i <= pageCount; i++) {
      setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: `Running OCR in browser: Page ${i} / ${pageCount}...`, page: i, pageCount }));
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL("image/png");
        const { data } = await worker.recognize(dataUrl);
        if (data.confidence < 50) lowConfidencePages.push(i);
        textParts.push(data.text);
      } catch {
        failedPages.push(i);
      }
    }
    await worker.terminate();
    return { text: textParts.join("\n\n"), failedPages, lowConfidencePages };
  }

  async function runSingleBatch(batchText: string, catalog: object, batchNumber: number | string, lowConfidencePages: number[]) {
    const response = await apiWithFallback(
      "/api/pdf/analyze",
      JSON.stringify({ text: batchText, catalog, batchNumber }),
      "application/json",
      () => analyzeClientSide({ text: batchText, catalog, batchNumber }),
    ) as { questions: AIQuestion[] };

    return response.questions.map((value) => {
      const qWithExam = { ...value, examId: paperExamId };
      const analyzed = lowConfidencePages.length
        ? { ...qWithExam, confidence: "Low" as const, confidenceReason: `OCR quality was low on page${lowConfidencePages.length === 1 ? "" : "s"} ${lowConfidencePages.join(", ")}; verify text. ${value.confidenceReason}` }
        : qWithExam;
      const section = sections.find((entry) => entry.examId === analyzed.examId && entry.name.toLowerCase() === analyzed.section.toLowerCase());
      if (!section) {
        return {
          id: crypto.randomUUID(),
          value: { ...analyzed, confidence: "Low" as const, confidenceReason: `${analyzed.confidenceReason} No matching existing section was found.`, section: "Unmatched" },
          status: "pending" as const,
          duplicate: false,
          edited: false,
          createChapter: false,
        };
      }
      const chapter = chapters.find((entry) => entry.sectionId === section.id && entry.name.toLowerCase() === analyzed.chapter.toLowerCase());
      const same = questions.some((q) => normalize(q.question) === normalize(analyzed.question)
        && q.sectionId === section.id && (!chapter || q.chapterId === chapter.id)
        && (["A", "B", "C", "D"] as Answer[]).every((key) => normalize(q.options[key] ?? "") === normalize(analyzed.options["ABCD".indexOf(key)] ?? "")));
      return { id: crypto.randomUUID(), value: analyzed, status: "pending" as const, duplicate: same, edited: false, createChapter: false };
    });
  }

  async function analyzePdf() {
    if (!file) return;
    setBusy(true);
    setError("");
    setItems([]);
    setOcrWarnings([]);
    setProgress({ step: 1, current: 0, total: 1, detected: 0, page: 0, pageCount: 0, label: "Reading PDF", stage: "reading" });

    try {
      let pdfText = "";
      let ocrRequired = false;

      const clientExtract = async () => {
        setProgress((current) => ({ ...current, step: 1, stage: "reading", label: "Extracting text with line layout..." }));
        const text = await extractPdfTextClientSide(file, (page, total) => {
          setProgress((current) => ({ ...current, step: 1, stage: "reading", label: `Reading PDF page ${page} / ${total}...`, page, pageCount: total }));
        });
        const compact = text.replace(/\s/g, "");
        const ratio = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length / Math.max(compact.length, 1);
        return { text, ocrRequired: compact.length < 20 || ratio < 0.4 };
      };

      const extracted = await apiWithFallback(
        "/api/pdf/text",
        file,
        undefined,
        clientExtract,
      ) as { text: string; ocrRequired: boolean };

      pdfText = extracted.text;
      ocrRequired = Boolean(extracted.ocrRequired);

      let lowConfidencePages: number[] = [];
      if (ocrRequired || !pdfText?.trim()) {
        const clientResult = await clientExtract();
        if (clientResult.text?.trim() && (!clientResult.ocrRequired || clientResult.text.trim().length > 60)) {
          pdfText = clientResult.text;
          ocrRequired = false;
        } else {
          setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "PDF contains scanned pages. Running OCR..." }));
          const ocr = await runOcr(file);
          pdfText = ocr.text;
          lowConfidencePages = ocr.lowConfidencePages;
          const warnings: string[] = [];
          if (ocr.lowConfidencePages.length) warnings.push(`OCR confidence is low on page${ocr.lowConfidencePages.length === 1 ? "" : "s"} ${ocr.lowConfidencePages.join(", ")}. Review wording carefully.`);
          if (ocr.failedPages.length) warnings.push(`OCR could not read page${ocr.failedPages.length === 1 ? "" : "s"} ${ocr.failedPages.join(", ")}; processing continued.`);
          setOcrWarnings(warnings);
        }
      }

      setProgress((current) => ({ ...current, step: 3, stage: "questions", label: "Segmenting paper questions", page: current.pageCount, detected: 0 }));
      const batches = questionChunks(pdfText);
      const numberedEstimate = (pdfText.match(/^\s*(?:(?:Q(?:uestion|ue)?\.?|Prob(?:lem)?\.?)\s*)?\d{1,3}[.)\]:-]/gim) ?? []).length;
      const estimatedTotal = numberedEstimate || Math.max(batches.length, batches.length * 3);
      setProgress((current) => ({ ...current, step: 3, stage: "questions", label: "Segmenting paper questions", current: numberedEstimate, total: estimatedTotal, detected: numberedEstimate }));
      await new Promise((resolve) => window.setTimeout(resolve, 80));

      const result: ReviewItem[] = [];
      const catalog = {
        exams: exams.filter((e) => e.id === paperExamId),
        sections: sections.filter((s) => s.examId === paperExamId),
        chapters: chapters.filter((c) => c.examId === paperExamId),
        paperContext: { title: paperTitle, year: paperYear, slot: paperSlot },
      };

      setProgress((current) => ({ ...current, step: 4, stage: "ai", label: "Analyzing questions with AI", current: 1, total: estimatedTotal }));

      for (let index = 0; index < batches.length; index++) {
        setProgress((current) => ({
          ...current,
          step: 4,
          stage: "ai",
          label: `Analyzing questions with AI (Batch ${index + 1}/${batches.length})`,
          current: Math.min(result.length + 1, estimatedTotal),
          total: estimatedTotal,
          detected: result.length,
        }));

        if (index > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
        }

        try {
          const parsedItems = await runSingleBatch(batches[index], catalog, index + 1, lowConfidencePages);
          result.push(...parsedItems);
        } catch (reason) {
          const halfLength = Math.floor(batches[index].length / 2);
          const part1 = batches[index].slice(0, halfLength);
          const part2 = batches[index].slice(halfLength);
          let splitSuccess = false;

          if (part1.trim() && part2.trim()) {
            try {
              const res1 = await runSingleBatch(part1, catalog, `${index + 1}a`, lowConfidencePages);
              const res2 = await runSingleBatch(part2, catalog, `${index + 1}b`, lowConfidencePages);
              result.push(...res1, ...res2);
              splitSuccess = true;
            } catch {
              /* Keep splitSuccess false */
            }
          }

          if (!splitSuccess) {
            result.push({
              id: crypto.randomUUID(),
              value: {
                questionNumber: null,
                question: `Batch ${index + 1} could not be processed`,
                type: "Other",
                options: [],
                correctAnswer: "",
                explanation: "",
                examId: paperExamId,
                subject: "",
                section: "",
                chapter: "",
                topic: "",
                difficulty: "Medium",
                tags: [],
                confidence: "Low",
                confidenceReason: "Retry this batch after checking API key / network.",
              },
              status: "failed",
              batchText: batches[index],
              error: reason instanceof Error ? reason.message : "Processing failed",
              duplicate: false,
              edited: false,
              createChapter: false,
            });
          }
        }

        setItems([...result]);
      }

      const validCount = result.filter((entry) => entry.status !== "failed").length;
      setProgress((current) => ({ ...current, current: validCount, total: validCount || 1, detected: validCount }));

      if (!result.some((entry) => entry.status === "pending")) {
        setError("No questions were detected in this PDF. Please verify that the PDF contains selectable text or clear scan quality.");
      }

      // Automatically maintain record of this extracted paper
      const currentPaperRecord: ExtractedPaper = {
        id: paperId || `paper_${paperExamId}_${paperYear}_${paperSlot.replace(/\s+/g, "").toLowerCase()}_${Date.now().toString(36)}`,
        fileName: file.name,
        paperTitle: paperTitle.trim() || file.name.replace(/\.pdf$/i, ""),
        examId: paperExamId,
        examName: exams.find((e) => e.id === paperExamId)?.name || paperExamId.toUpperCase(),
        year: Number(paperYear) || new Date().getFullYear(),
        slot: paperSlot.trim() || "Slot 1",
        extractedAt: new Date().toISOString(),
        extractedBy: importedBy || "Administrator",
        totalQuestions: validCount,
        approvedCount: 0,
        rejectedCount: 0,
        status: "In Review",
        extractedQuestions: result.map((r) => r.value),
      };

      await persistPaperRecord(currentPaperRecord);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PDF processing failed.");
    } finally {
      setBusy(false);
    }
  }

  function update(id: string, changes: Partial<ReviewItem["value"]>) {
    setItems((current) => current.map((entry) => entry.id === id ? { ...entry, value: { ...entry.value, ...changes }, edited: true } : entry));
  }

  function mark(id: string, status: ReviewItem["status"]) {
    setItems((current) => {
      const next = current.map((entry) => entry.id === id ? { ...entry, status } : entry);
      updatePaperRecordStats(next);
      return next;
    });
  }

  function existingFor(item: ReviewItem) {
    return sections.find((section) => section.examId === item.value.examId && section.name.toLowerCase() === item.value.section.toLowerCase());
  }

  function targetChapter(item: ReviewItem) {
    const section = existingFor(item);
    return chapters.find((chapter) => chapter.sectionId === section?.id && chapter.name.toLowerCase() === item.value.chapter.toLowerCase());
  }

  function updatePaperRecordStats(currentItems: ReviewItem[]) {
    if (!paperId) return;
    const existing = extractedPapers.find((p) => p.id === paperId);
    if (!existing) return;

    const approvedCount = currentItems.filter((i) => i.status === "approved").length;
    const rejectedCount = currentItems.filter((i) => i.status === "rejected").length;
    const total = currentItems.filter((i) => i.status !== "failed").length;
    const status: ExtractedPaper["status"] =
      approvedCount === total && total > 0
        ? "Completed"
        : approvedCount > 0
        ? "Partially Approved"
        : "In Review";

    const updated: ExtractedPaper = {
      ...existing,
      approvedCount,
      rejectedCount,
      status,
    };

    void persistPaperRecord(updated);
  }

  async function retryFailed(entry: ReviewItem) {
    if (!entry.batchText) return;
    setBusy(true);
    setError("");
    try {
      const retryItems = await runSingleBatch(entry.batchText, { exams, sections, chapters }, "retry", []);
      setItems((current) => {
        const index = current.findIndex((item) => item.id === entry.id);
        const next = [...current.slice(0, index), ...retryItems, ...current.slice(index + 1)];
        updatePaperRecordStats(next);
        return next;
      });
      if (!retryItems.length) setError("This batch did not return any questions.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(item: ReviewItem, forceDuplicate = false) {
    if (item.duplicate && !forceDuplicate) return;
    const section = existingFor(item);
    if (!section) {
      setError(`Choose an existing section for Question ${item.value.questionNumber ?? "?"} before approving.`);
      return;
    }
    const chapter = targetChapter(item);
    if (!chapter && !item.createChapter) {
      setError(`Confirm creation of the suggested chapter "${item.value.chapter}" before approving.`);
      return;
    }

    try {
      const qModel = questionToModel(item.value, section, chapter, `import-${crypto.randomUUID()}`, {
        paperId,
        paperTitle: paperTitle.trim() || file?.name || "Exam Paper",
        year: paperYear,
        slot: paperSlot,
        fileName: file?.name,
      });

      await onApprove(qModel, item.createChapter && !chapter);
      mark(item.id, "approved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add question.");
    }
  }

  async function approveAll() {
    setError("");
    for (const item of pending) {
      if (item.duplicate || item.status === "failed" || item.value.confidence === "Low" || !existingFor(item)) continue;
      if (!targetChapter(item) && !item.createChapter) continue;
      await approve(item, false);
    }
  }

  function loadPaperForReview(paper: ExtractedPaper) {
    setPaperId(paper.id);
    setPaperTitle(paper.paperTitle);
    setPaperExamId(paper.examId);
    setPaperYear(paper.year);
    setPaperSlot(paper.slot);

    if (Array.isArray(paper.extractedQuestions) && paper.extractedQuestions.length > 0) {
      const reviewItems: ReviewItem[] = (paper.extractedQuestions as AIQuestion[]).map((q) => {
        const section = sections.find((entry) => entry.examId === q.examId && entry.name.toLowerCase() === q.section.toLowerCase());
        const chapter = chapters.find((entry) => entry.sectionId === section?.id && entry.name.toLowerCase() === q.chapter.toLowerCase());
        const same = questions.some((existingQ) => normalize(existingQ.question) === normalize(q.question));
        return {
          id: crypto.randomUUID(),
          value: q,
          status: "pending",
          duplicate: same,
          edited: false,
          createChapter: !chapter && Boolean(q.chapter),
        };
      });
      setItems(reviewItems);
    }
    setActiveTab("extract");
  }

  function downloadPaperJson(paper: ExtractedPaper) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(paper, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${paper.paperTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}_questions.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    setPdf(event.dataTransfer.files[0]);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    setPdf(event.target.files?.[0]);
  }

  const selectedExamObj = exams.find((e) => e.id === paperExamId);

  return (
    <div className="page-stack ai-import-page">
      <section className="section-heading page-title">
        <div>
          <span className="eyebrow"><Sparkles size={13} /> QUESTION BANK &amp; EXAM PAPERS</span>
          <h1>AI PDF Import &amp; Paper Records</h1>
          <p>Extract questions, tag with year &amp; slot, and maintain comprehensive records of extracted papers.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="button button-outline api-keys-modal-trigger"
            onClick={() => setShowApiKeysModal(!showApiKeysModal)}
          >
            <Key size={15} /> {showApiKeysModal ? "Hide API Key Pool" : "Manage API Keys Pool"}
          </button>
        </div>
      </section>

      {/* EXPANDABLE API KEYS MANAGER PANEL */}
      {showApiKeysModal && (
        <section className="api-keys-inline-section">
          <ApiKeyManager onClosed={() => setShowApiKeysModal(false)} />
        </section>
      )}

      {/* NAVIGATION TABS: EXTRACT vs ARCHIVE */}
      <div className="import-tab-nav" role="tablist">
        <button
          type="button"
          className={`import-tab-btn ${activeTab === "extract" ? "active" : ""}`}
          onClick={() => setActiveTab("extract")}
        >
          <Upload size={15} /> Upload &amp; Extract Paper
        </button>
        <button
          type="button"
          className={`import-tab-btn ${activeTab === "records" ? "active" : ""}`}
          onClick={() => setActiveTab("records")}
        >
          <FolderArchive size={15} /> Extracted Papers Records ({extractedPapers.length})
        </button>
      </div>

      {activeTab === "extract" ? (
        <>
          <section className="settings-card">
            <h2>Upload Question PDF</h2>
            <p>Upload CAT, XAT, CMAT or MAT question papers (scanned or selectable PDF, up to 25 MB).</p>
            <div
              className={`pdf-dropzone ${dragging ? "pdf-dropzone-active" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={onChange} hidden />
              {!file ? (
                <>
                  <div className="pdf-upload-icon"><Upload size={22} /></div>
                  <b>Drag &amp; drop a question paper PDF here</b>
                  <span>or</span>
                  <button type="button" className="button button-outline" onClick={() => inputRef.current?.click()}>
                    Choose PDF
                  </button>
                </>
              ) : (
                <div className="pdf-file-row">
                  <FileText size={22} />
                  <div>
                    <b>{file.name}</b>
                    <small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small>
                  </div>
                  <button type="button" className="icon-button" aria-label="Remove PDF" onClick={() => setPdf(undefined)}>
                    <X size={17} />
                  </button>
                </div>
              )}
            </div>

            {/* PAPER CLASSIFICATION & METADATA CARD */}
            {file && (
              <div className="paper-meta-card">
                <h3><Layers size={15} /> Paper Details &amp; Classification</h3>
                <div className="paper-meta-grid">
                  <label className="form-label">
                    Target Exam
                    <select
                      value={paperExamId}
                      onChange={(e) => {
                        const newExam = e.target.value;
                        setPaperExamId(newExam);
                        const examName = exams.find((x) => x.id === newExam)?.name || newExam.toUpperCase();
                        setPaperTitle(`${examName} ${paperYear} ${paperSlot}`.trim());
                      }}
                      disabled={busy}
                    >
                      {exams.map((exam) => (
                        <option key={exam.id} value={exam.id}>{exam.name} ({exam.tagline})</option>
                      ))}
                    </select>
                  </label>

                  <label className="form-label">
                    Exam Year
                    <input
                      type="number"
                      min={2000}
                      max={2030}
                      value={paperYear}
                      onChange={(e) => {
                        const y = parseInt(e.target.value, 10) || new Date().getFullYear();
                        setPaperYear(y);
                        setPaperTitle(`${selectedExamObj?.name || "Exam"} ${y} ${paperSlot}`.trim());
                      }}
                      disabled={busy}
                    />
                  </label>

                  <label className="form-label">
                    Slot / Shift
                    <input
                      type="text"
                      placeholder="e.g. Slot 1, Morning, Shift 2"
                      value={paperSlot}
                      onChange={(e) => {
                        setPaperSlot(e.target.value);
                        setPaperTitle(`${selectedExamObj?.name || "Exam"} ${paperYear} ${e.target.value}`.trim());
                      }}
                      disabled={busy}
                    />
                  </label>

                  <label className="form-label">
                    Paper Title / Label
                    <input
                      type="text"
                      value={paperTitle}
                      onChange={(e) => setPaperTitle(e.target.value)}
                      disabled={busy}
                      placeholder="e.g. CAT 2024 Slot 1 Question Paper"
                    />
                  </label>
                </div>
              </div>
            )}

            <button
              type="button"
              className="button button-primary"
              disabled={!file || busy}
              onClick={() => void analyzePdf()}
            >
              {busy ? (
                <><LoaderCircle size={16} className="spin-icon" /> Extracting Paper Questions…</>
              ) : (
                <><Sparkles size={16} /> Analyze &amp; Extract Paper</>
              )}
            </button>

            {busy && (
              <div className="import-progress" role="status">
                <div>
                  <b>Step {progress.step}/4 · {progress.label}</b>
                  <span>
                    {progress.stage === "ocr"
                      ? `Page ${progress.page} / ${progress.pageCount || "…"}`
                      : progress.stage === "ai"
                      ? `Question ${progress.current} / ${progress.total}`
                      : progress.stage === "questions" && !progress.detected
                      ? "Finding question patterns…"
                      : `Questions detected: ${progress.detected}`}
                  </span>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${
                        progress.stage === "reading"
                          ? 5
                          : progress.stage === "ocr"
                          ? 20 + (progress.pageCount ? Math.round((progress.page / progress.pageCount) * 35) : 0)
                          : progress.stage === "questions"
                          ? 60
                          : 65 + Math.round((progress.current / Math.max(progress.total, 1)) * 35)
                      }%`,
                    }}
                  />
                </div>
                <small>Preserves question lines and multi-line options. Adaptive batches of 2-3 questions with multi-key failover.</small>
              </div>
            )}
          </section>

          {error && (
            <div className="answer-validation answer-validation-review" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button type="button" className="icon-button" onClick={() => setError("")} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )}

          {!!ocrWarnings.length && (
            <div className="answer-validation answer-validation-review" role="status">
              <AlertCircle size={17} />
              <span>{ocrWarnings.join(" ")}</span>
            </div>
          )}

          {/* EXTRACTED QUESTIONS WORKBENCH */}
          {!!items.length && (
            <>
              <section className="question-stat-panel import-summary">
                <div className="section-heading">
                  <div>
                    <h2>{paperTitle || "Extracted Paper"}</h2>
                    <p>{file?.name ?? "Question PDF"} · {paperYear} {paperSlot}</p>
                  </div>
                  <span className="soft-badge">{items.length} questions detected</span>
                </div>
                <div className="import-summary-grid">
                  <span>Successfully analyzed <b>{items.filter((item) => item.status !== "failed").length}</b></span>
                  <span>Added to bank <b>{items.filter((item) => item.status === "approved").length}</b></span>
                  <span>Needs review <b>{pending.length}</b></span>
                  <span>Rejected <b>{items.filter((item) => item.status === "rejected").length}</b></span>
                  <span>Failed <b>{items.filter((item) => item.status === "failed").length}</b></span>
                  <span>Possible duplicates <b>{duplicates}</b></span>
                </div>
                <div className="import-subjects">
                  <b>Subjects detected:</b>
                  {detectedSubjects.length ? (
                    detectedSubjects.map((subject) => <span className="soft-badge" key={subject}>{subject}</span>)
                  ) : (
                    <span>None matched</span>
                  )}
                </div>
                <div className="import-review-actions">
                  <button type="button" className="button button-outline" onClick={() => setActiveTab("records")}>
                    <FolderArchive size={15} /> View All Paper Records
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!pending.length}
                    onClick={() => void approveAll()}
                  >
                    Approve all valid questions ({pending.length})
                  </button>
                </div>
              </section>

              <section className="import-question-list">
                <div className="section-heading">
                  <div>
                    <h2>Review extracted questions</h2>
                    <p>Review classifications, correct answers, and explanations before adding to the bank.</p>
                  </div>
                </div>

                {items.map((entry, index) => {
                  const item = entry.value;
                  const section = existingFor(entry);
                  const matchingChapter = targetChapter(entry);
                  const optionString = item.options.join("\n");

                  return (
                    <article className="import-question-card" key={entry.id}>
                      <header>
                        <div>
                          <span className="eyebrow">QUESTION {item.questionNumber ?? index + 1}</span>
                          <span className={`confidence-tag confidence-${item.confidence.toLowerCase()}`}>
                            {item.confidence} confidence
                          </span>
                          <span className="paper-tag">{paperTitle}</span>
                        </div>
                        <span
                          className={`status-pill ${
                            entry.status === "approved"
                              ? "status-approved"
                              : entry.status === "rejected"
                              ? "status-rejected"
                              : entry.status === "failed"
                              ? "status-wrong"
                              : ""
                          }`}
                        >
                          {entry.status === "pending" ? "Needs review" : entry.status}
                        </span>
                      </header>

                      {entry.duplicate && (
                        <div className="duplicate-warning">
                          <AlertCircle size={16} />
                          <span><b>Possible duplicate question.</b> Compare it with the existing question bank before adding.</span>
                        </div>
                      )}

                      {entry.status === "failed" ? (
                        <div className="import-failed">
                          <b>Processing failed</b>
                          <p>{entry.error}</p>
                          <button type="button" className="button button-outline" disabled={busy} onClick={() => void retryFailed(entry)}>
                            Retry this batch
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className="form-label">
                            Question
                            <textarea
                              rows={3}
                              value={item.question}
                              disabled={entry.status !== "pending"}
                              onChange={(event) => update(entry.id, { question: event.target.value })}
                            />
                          </label>

                          <div className="import-edit-grid">
                            <label className="form-label">
                              Type
                              <select
                                value={item.type}
                                disabled={entry.status !== "pending"}
                                onChange={(event) => update(entry.id, { type: event.target.value })}
                              >
                                {["MCQ", "Multiple Correct", "True/False", "Numerical", "Fill in the Blank", "Short Answer", "Long Answer", "Assertion & Reason", "Match the Following", "Other"].map((value) => (
                                  <option key={value}>{value}</option>
                                ))}
                              </select>
                            </label>

                            <label className="form-label">
                              Exam
                              <select
                                value={item.examId}
                                disabled={entry.status !== "pending"}
                                onChange={(event) => update(entry.id, { examId: event.target.value, section: "", subject: "", chapter: "" })}
                              >
                                {exams.map((exam) => (
                                  <option key={exam.id} value={exam.id}>{exam.name}</option>
                                ))}
                              </select>
                            </label>

                            <label className="form-label">
                              Subject / section
                              <select
                                value={section?.id ?? ""}
                                disabled={entry.status !== "pending"}
                                onChange={(event) => {
                                  const next = sections.find((candidate) => candidate.id === event.target.value);
                                  update(entry.id, { section: next?.name ?? "", subject: next?.name ?? "", chapter: "" });
                                }}
                              >
                                <option value="">Select an existing section</option>
                                {sections.filter((candidate) => candidate.examId === item.examId).map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                ))}
                              </select>
                            </label>

                            <label className="form-label">
                              Chapter
                              <select
                                value={matchingChapter?.id ?? "suggested"}
                                disabled={entry.status !== "pending"}
                                onChange={(event) => {
                                  const selected = chapters.find((candidate) => candidate.id === event.target.value);
                                  if (selected) {
                                    update(entry.id, { chapter: selected.name });
                                    setItems((current) => current.map((row) => row.id === entry.id ? { ...row, createChapter: false, value: { ...row.value, chapter: selected.name } } : row));
                                  } else {
                                    setItems((current) => current.map((row) => row.id === entry.id ? { ...row, createChapter: false } : row));
                                  }
                                }}
                              >
                                <option value="suggested">Suggested new: {item.chapter || "Review needed"}</option>
                                {chapters.filter((candidate) => candidate.sectionId === section?.id).map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                                ))}
                              </select>
                            </label>
                          </div>

                          {!matchingChapter && item.chapter && (
                            <label className="chapter-confirm">
                              <input
                                type="checkbox"
                                checked={entry.createChapter}
                                disabled={entry.status !== "pending"}
                                onChange={(event) => setItems((current) => current.map((row) => row.id === entry.id ? { ...row, createChapter: event.target.checked } : row))}
                              />
                              Create suggested chapter "{item.chapter}" on approval
                            </label>
                          )}

                          <div className="import-edit-grid">
                            <label className="form-label">
                              Options (one per line)
                              <textarea
                                rows={Math.min(6, Math.max(2, item.options.length))}
                                value={optionString}
                                disabled={entry.status !== "pending"}
                                onChange={(event) => update(entry.id, { options: event.target.value.split(/\r?\n/).filter((line) => line.trim()) })}
                              />
                            </label>
                            <div>
                              <label className="form-label">
                                Correct answer
                                <input
                                  value={item.correctAnswer}
                                  disabled={entry.status !== "pending"}
                                  onChange={(event) => update(entry.id, { correctAnswer: event.target.value })}
                                />
                              </label>
                              <label className="form-label">
                                Difficulty
                                <select
                                  value={item.difficulty}
                                  disabled={entry.status !== "pending"}
                                  onChange={(event) => update(entry.id, { difficulty: event.target.value as Difficulty })}
                                >
                                  {["Easy", "Medium", "Hard"].map((value) => (
                                    <option key={value}>{value}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </div>

                          <label className="form-label">
                            Explanation
                            <textarea
                              rows={3}
                              value={item.explanation}
                              disabled={entry.status !== "pending"}
                              onChange={(event) => update(entry.id, { explanation: event.target.value })}
                            />
                          </label>

                          <div className="import-classification">
                            <span><b>Topic:</b> {item.topic || "—"}</span>
                            <span><b>Tags:</b> {item.tags.join(", ") || "—"}</span>
                            <span className={`confidence-tag confidence-${item.confidence.toLowerCase()}`}>
                              Confidence: {item.confidence} {item.confidenceReason ? `(${item.confidenceReason})` : ""}
                            </span>
                          </div>

                          {/* Attached Graph Preview */}
                          {item.imageUrl && (
                            <div className="import-attached-graph-preview">
                              <div className="attached-graph-header">
                                <span><ImageIcon size={14} /> Attached Graph / Diagram:</span>
                                <button
                                  type="button"
                                  className="text-button remove-graph-btn"
                                  onClick={() => update(entry.id, { imageUrl: undefined, hasDiagram: false })}
                                >
                                  <X size={14} /> Remove Graph
                                </button>
                              </div>
                              <div className="attached-graph-thumb-wrap">
                                <img src={item.imageUrl} alt="Attached Graph" className="attached-graph-thumb" />
                              </div>
                            </div>
                          )}

                          {entry.status === "pending" && (
                            <div className="import-card-actions">
                              <button
                                type="button"
                                className={`button ${item.imageUrl ? "button-outline" : "button-secondary"} btn-snip-graph`}
                                onClick={() => setSnippingItem(entry)}
                                title="Crop or attach graph/diagram from PDF for this question"
                              >
                                <Crop size={15} /> {item.imageUrl ? "Edit / Replace Graph" : "📷 Snip Graph from PDF"}
                              </button>
                              <button type="button" className="button button-quiet" onClick={() => mark(entry.id, "rejected")}>
                                {entry.duplicate ? "Skip duplicate" : "Reject"}
                              </button>
                              <button
                                type="button"
                                className="button button-outline"
                                onClick={() => setItems((current) => current.map((row) => row.id === entry.id ? { ...row, edited: true } : row))}
                              >
                                Edit fields above
                              </button>
                              {entry.duplicate && (
                                <button type="button" className="button button-outline" onClick={() => void approve(entry, true)}>
                                  Add anyway
                                </button>
                              )}
                              {item.confidence === "Low" && (
                                <button
                                  type="button"
                                  className="button button-outline"
                                  disabled={!section || (!matchingChapter && !entry.createChapter)}
                                  onClick={() => void approve(entry)}
                                >
                                  Review &amp; Add Anyway
                                </button>
                              )}
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={entry.duplicate || item.confidence === "Low" || !section || (!matchingChapter && !entry.createChapter)}
                                onClick={() => void approve(entry)}
                              >
                                <Check size={15} /> Approve &amp; Add
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  );
                })}
              </section>
            </>
          )}
        </>
      ) : (
        /* ARCHIVE TAB: RECORDS OF EXTRACTED PAPERS */
        <section className="page-stack">
          <div className="section-heading">
            <div>
              <h2>Extracted Papers Records</h2>
              <p>Persistent catalog of all previous year papers extracted and imported into Firestore.</p>
            </div>
            <span className="soft-badge">{extractedPapers.length} papers recorded</span>
          </div>

          <div className="paper-archive-list">
            {extractedPapers.map((paper) => {
              const examBadgeClass =
                paper.examId === "cat"
                  ? "paper-badge-cat"
                  : paper.examId === "xat"
                  ? "paper-badge-xat"
                  : paper.examId === "cmat"
                  ? "paper-badge-cmat"
                  : paper.examId === "mat"
                  ? "paper-badge-mat"
                  : "paper-badge-generic";

              return (
                <article className="paper-archive-card" key={paper.id}>
                  <div className="paper-archive-header">
                    <div className="paper-archive-title">
                      <h3>
                        <span className={`paper-badge ${examBadgeClass}`}>{paper.examName}</span>
                        {paper.paperTitle}
                      </h3>
                      <p>
                        File: <b>{paper.fileName}</b> · Year: <b>{paper.year}</b> · Shift: <b>{paper.slot}</b> · Extracted {new Date(paper.extractedAt).toLocaleDateString()} by {paper.extractedBy}
                      </p>
                    </div>
                    <span
                      className={`status-pill ${
                        paper.status === "Completed"
                          ? "status-approved"
                          : paper.status === "Partially Approved"
                          ? "status-correct"
                          : ""
                      }`}
                    >
                      {paper.status}
                    </span>
                  </div>

                  <div className="paper-archive-stats">
                    <span>Total Detected: <b>{paper.totalQuestions}</b></span>
                    <span>Approved &amp; Added: <b>{paper.approvedCount}</b></span>
                    <span>Rejected: <b>{paper.rejectedCount}</b></span>
                    <span>Pending Review: <b>{Math.max(0, paper.totalQuestions - paper.approvedCount - paper.rejectedCount)}</b></span>
                  </div>

                  <div className="paper-archive-actions">
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => void deletePaperRecord(paper.id)}
                    >
                      <Trash2 size={14} /> Remove Record
                    </button>
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => downloadPaperJson(paper)}
                    >
                      <Download size={14} /> Download JSON
                    </button>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => loadPaperForReview(paper)}
                    >
                      <RefreshCw size={14} /> Review &amp; Edit Questions
                    </button>
                  </div>
                </article>
              );
            })}

            {!extractedPapers.length && (
              <div className="empty-state">
                <div><FolderArchive size={30} /></div>
                <h3>No Extracted Papers Recorded Yet</h3>
                <p>When you upload and extract a question paper PDF, it is automatically cataloged and maintained here.</p>
                <button type="button" className="button button-primary" onClick={() => setActiveTab("extract")}>
                  <Upload size={15} /> Upload a Question Paper PDF
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {snippingItem && (
        <PdfGraphSnipper
          file={file}
          questionNumber={snippingItem.value.questionNumber}
          onApply={(croppedDataUrl) => {
            update(snippingItem.id, { imageUrl: croppedDataUrl, hasDiagram: true });
            setSnippingItem(null);
          }}
          onClose={() => setSnippingItem(null)}
        />
      )}
    </div>
  );
}
