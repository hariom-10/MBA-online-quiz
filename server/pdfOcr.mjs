import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_OCR_PAGES = 250;
const TESSERACT_CACHE = resolve(process.cwd(), ".cache", "tesseract");

/** Render and OCR one PDF page at a time. The canvas backing store is released before advancing. */
export async function recognizePdf(buffer, onProgress = () => {}) {
  let loadingTask;
  let worker;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, verbosity: 0,
      standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).href,
    });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_OCR_PAGES) throw new Error(`PDF has ${pdf.numPages} pages; OCR limit is ${MAX_OCR_PAGES}.`);
    onProgress({ type: "start", pageCount: pdf.numPages });
    await mkdir(TESSERACT_CACHE, { recursive: true });
    worker = await createWorker("eng", 1, {
      cachePath: TESSERACT_CACHE,
      logger: (message) => {
        if (message.status && /load|initializ/i.test(message.status)) {
          onProgress({ type: "engine", status: message.status, progress: message.progress });
        }
      },
      errorHandler: () => {},
    });
    await worker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "200" });
    const pageText = [];
    const failedPages = [];
    const lowConfidencePages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      let page;
      let canvas;
      try {
        page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.max(0.5, Math.min(2.1, 2200 / Math.max(base.width, base.height)));
        const viewport = page.getViewport({ scale });
        const canvasFactory = pdf.canvasFactory;
        const canvasAndContext = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        canvas = canvasAndContext.canvas;
        const context = canvasAndContext.context;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const image = canvas.toBuffer("image/png");
        const { data } = await worker.recognize(image);
        const text = typeof data.text === "string" ? data.text.trim() : "";
        const confidence = Number.isFinite(data.confidence) ? Math.round(data.confidence) : 0;
        if (confidence < 52 || text.length < 35) lowConfidencePages.push(pageNumber);
        pageText.push(`\n[PDF PAGE ${pageNumber}; OCR confidence ${confidence}/100${confidence < 52 ? "; verify OCR text" : ""}]\n${text}`);
        onProgress({ type: "page", page: pageNumber, pageCount: pdf.numPages, confidence, characters: text.length });
      } catch (error) {
        failedPages.push(pageNumber);
        pageText.push(`\n[PDF PAGE ${pageNumber}; OCR failed; source content unavailable]\n`);
        console.error(`[pdf-import] OCR failed on page ${pageNumber}:`, error);
        onProgress({ type: "page", page: pageNumber, pageCount: pdf.numPages, failed: true });
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        page?.cleanup();
      }
    }
    const text = pageText.join("\n").trim();
    if (!text.replace(/\[[^\]]+\]/g, "").replace(/\s/g, "")) throw new Error("OCR did not recover readable text.");
    return { text, pageCount: pdf.numPages, failedPages, lowConfidencePages };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
