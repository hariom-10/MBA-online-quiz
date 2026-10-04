import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AlertCircle, Check, FileText, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import type { Answer, Chapter, Difficulty, Exam, Question, Section } from "./model";

type AIQuestion = {
  questionNumber: number | null; question: string; type: string; options: string[]; correctAnswer: string;
  explanation: string; examId: string; subject: string; section: string; chapter: string; topic: string;
  difficulty: Difficulty; tags: string[]; confidence: "High" | "Medium" | "Low"; confidenceReason: string;
};
type ReviewItem = { id: string; value: AIQuestion; status: "pending" | "approved" | "rejected" | "failed"; error?: string; batchText?: string; duplicate: boolean; edited: boolean; createChapter: boolean };
type HistoryRow = { file: string; date: string; total: number; added: number; rejected: number; duplicates: number; failed: number; importedBy: string };
const HISTORY_KEY = "mba-pdf-import-history";

function questionChunks(text: string) {
  const lines = text.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (/^\s*(?:(?:Q(?:uestion)?\s*)?\d{1,3}[.)\]:-]|\(\d{1,3}\)\s)/i.test(line)) starts.push(index);
  });
  let parts: string[] = [];
  if (starts.length > 1) {
    const boundaries = [0, ...starts.filter((n) => n > 0), lines.length];
    parts = boundaries.slice(0, -1).map((from, i) => lines.slice(from, boundaries[i + 1]).join("\n").trim()).filter(Boolean);
  }
  if (parts.length < 2) {
    const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    parts = paragraphs.length > 1 ? paragraphs : text.match(/.{1,12000}(?:\s|$)/gs) ?? [text];
  }
  const batches: string[] = [];
  for (let i = 0; i < parts.length; i += 10) batches.push(parts.slice(i, i + 10).join("\n\n"));
  return batches;
}

function normalize(text: string) { return text.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function questionToModel(item: AIQuestion, section: Section, chapter: Chapter | undefined, id: string): Question {
  const options = item.options.slice(0, 4);
  const optionMap = { A: options[0] ?? "", B: options[1] ?? "", C: options[2] ?? "", D: options[3] ?? "" };
  const optionBased = item.type === "MCQ" && options.length === 4 && /^[A-D]$/.test(item.correctAnswer.trim());
  return {
    id, examId: section.examId, sectionId: section.id, chapterId: chapter?.id ?? "", topic: chapter?.name ?? item.chapter,
    subTopic: item.topic || undefined, question: item.question, options: optionMap,
    answerMode: optionBased ? "choice" : "text", correctAnswer: item.correctAnswer.trim() || undefined,
    hasAnswerKey: Boolean(item.correctAnswer.trim()), explanation: item.explanation, difficulty: item.difficulty,
    questionType: item.type, tags: item.tags, aiConfidence: item.confidence, aiConfidenceReason: item.confidenceReason,
  };
}

export function AiPdfImport({ exams, sections, chapters, questions, importedBy, onApprove }: {
  exams: Exam[]; sections: Section[]; chapters: Chapter[]; questions: Question[]; importedBy: string;
  onApprove: (question: Question, createChapter: boolean) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>(() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; } });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ step: 1, current: 0, total: 1, detected: 0, page: 0, pageCount: 0, label: "Reading PDF", stage: "reading" });
  const [ocrWarnings, setOcrWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const pending = items.filter((item) => item.status === "pending");
  const detectedSubjects = [...new Set(items.map((item) => item.value.subject).filter(Boolean))];
  const duplicates = useMemo(() => items.filter((item) => item.duplicate).length, [items]);

  function setPdf(selected: File | undefined) {
    setError(""); setItems([]);
    if (!selected) { setFile(null); return; }
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) { setFile(null); setError("Choose a PDF file."); return; }
    if (selected.size > 18 * 1024 * 1024) { setFile(null); setError("PDFs must be 18 MB or smaller."); return; }
    setFile(selected);
  }

  async function api(path: string, payload: BodyInit, contentType?: string) {
    const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { ...(contentType ? { "content-type": contentType } : {}) }, body: payload });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  }

  async function runOcr(selectedFile: File): Promise<{ text: string; failedPages: number[]; lowConfidencePages: number[] }> {
    const response = await fetch("/api/pdf/ocr", { method: "POST", credentials: "same-origin", body: selectedFile });
    if (!response.ok) {
      let message = "Unable to extract text from this PDF. Please try another PDF.";
      try { message = (await response.json()).error || message; } catch { /* keep generic message */ }
      throw new Error(message);
    }
    if (!response.body) throw new Error("Unable to extract text from this PDF. Please try another PDF.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pendingLine = "";
    const completion: { value: { text: string; failedPages: number[]; lowConfidencePages: number[] } | null } = { value: null };
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as { type: string; text?: string; page?: number; pageCount?: number; confidence?: number; failedPages?: number[]; lowConfidencePages?: number[]; message?: string; status?: string; progress?: number };
      if (event.type === "start") setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "PDF contains scanned pages. Running OCR...", pageCount: event.pageCount ?? 0, page: 0 }));
      if (event.type === "engine") setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "Loading OCR engine..." }));
      if (event.type === "page") setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "PDF contains scanned pages. Running OCR...", page: event.page ?? current.page, pageCount: event.pageCount ?? current.pageCount }));
      if (event.type === "complete" && typeof event.text === "string") completion.value = { text: event.text, failedPages: event.failedPages ?? [], lowConfidencePages: event.lowConfidencePages ?? [] };
      if (event.type === "error") throw new Error(event.message || "Unable to extract text from this PDF. Please try another PDF.");
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
    const completed = completion.value;
    if (!completed?.text.trim()) throw new Error("Unable to extract text from this PDF. Please try another PDF.");
    return completed;
  }

  async function analyzePdf() {
    if (!file) return;
    setBusy(true); setError(""); setItems([]); setOcrWarnings([]);
    setProgress({ step: 1, current: 0, total: 1, detected: 0, page: 0, pageCount: 0, label: "Reading PDF", stage: "reading" });
    try {
      const extracted = await api("/api/pdf/text", file) as { text: string; ocrRequired?: boolean };
      let pdfText = extracted.text;
      let lowConfidencePages: number[] = [];
      if (extracted.ocrRequired || !pdfText?.trim()) {
        setProgress((current) => ({ ...current, step: 2, stage: "ocr", label: "PDF contains scanned pages. Running OCR..." }));
        const ocr = await runOcr(file);
        pdfText = ocr.text;
        lowConfidencePages = ocr.lowConfidencePages;
        const warnings: string[] = [];
        if (ocr.lowConfidencePages.length) warnings.push(`OCR confidence is low on page${ocr.lowConfidencePages.length === 1 ? "" : "s"} ${ocr.lowConfidencePages.join(", ")}. Review question wording, options, and calculations carefully.`);
        if (ocr.failedPages.length) warnings.push(`OCR could not read page${ocr.failedPages.length === 1 ? "" : "s"} ${ocr.failedPages.join(", ")}; processing continued for the other pages.`);
        setOcrWarnings(warnings);
      }
      setProgress((current) => ({ ...current, step: 3, stage: "questions", label: "Detecting questions", page: current.pageCount, detected: 0 }));
      const batches = questionChunks(pdfText);
      const numberedEstimate = (pdfText.match(/^\s*(?:(?:Q(?:uestion)?\s*)?\d{1,3}[.)\]:-]|\(\d{1,3}\)\s)/gim) ?? []).length;
      const estimatedTotal = numberedEstimate || Math.max(batches.length, batches.length * 10);
      setProgress((current) => ({ ...current, step: 3, stage: "questions", label: "Detecting questions", current: numberedEstimate, total: estimatedTotal, detected: numberedEstimate }));
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const result: ReviewItem[] = [];
      const catalog = { exams, sections, chapters };
      setProgress((current) => ({ ...current, step: 4, stage: "ai", label: "Analyzing questions with AI", current: 1, total: estimatedTotal }));
      for (let index = 0; index < batches.length; index++) {
        setProgress((current) => ({ ...current, step: 4, stage: "ai", label: "Analyzing questions with AI", current: Math.min(result.length + 1, estimatedTotal), total: estimatedTotal, detected: result.length }));
        try {
          const response = await api("/api/pdf/analyze", JSON.stringify({ text: batches[index], catalog, batchNumber: index + 1, ocrSource: pdfText.includes("OCR confidence") }), "application/json") as { questions: AIQuestion[] };
          for (const value of response.questions) {
            const analyzed = lowConfidencePages.length ? { ...value, confidence: "Low" as const, confidenceReason: `OCR quality was low on page${lowConfidencePages.length === 1 ? "" : "s"} ${lowConfidencePages.join(", ")}; verify the text and answer. ${value.confidenceReason}` } : value;
            const section = sections.find((entry) => entry.examId === analyzed.examId && entry.name.toLowerCase() === analyzed.section.toLowerCase());
            if (!section) { result.push({ id: crypto.randomUUID(), value: { ...analyzed, confidence: "Low", confidenceReason: `${analyzed.confidenceReason} No matching existing subject/section was found.`, section: "Unmatched" }, status: "pending", duplicate: false, edited: false, createChapter: false }); continue; }
            const chapter = chapters.find((entry) => entry.sectionId === section.id && entry.name.toLowerCase() === analyzed.chapter.toLowerCase());
            const same = questions.some((question) => normalize(question.question) === normalize(analyzed.question)
              && question.sectionId === section.id && (!chapter || question.chapterId === chapter.id)
              && (["A", "B", "C", "D"] as Answer[]).every((key) => normalize(question.options[key] ?? "") === normalize(analyzed.options["ABCD".indexOf(key)] ?? "")));
            result.push({ id: crypto.randomUUID(), value: analyzed, status: "pending", duplicate: same, edited: false, createChapter: false });
          }
        } catch (reason) {
          result.push({ id: crypto.randomUUID(), value: { questionNumber: null, question: `Batch ${index + 1} could not be processed`, type: "Other", options: [], correctAnswer: "", explanation: "", examId: exams[0]?.id ?? "", subject: "", section: "", chapter: "", topic: "", difficulty: "Medium", tags: [], confidence: "Low", confidenceReason: "Retry this batch after checking the error." }, status: "failed", batchText: batches[index], error: reason instanceof Error ? reason.message : "Processing failed", duplicate: false, edited: false, createChapter: false });
        }
        setItems([...result]); setProgress((current) => ({ ...current, step: 4, stage: "ai", label: "Analyzing questions with AI", current: Math.min(Math.max(result.length, index + 1), estimatedTotal), total: estimatedTotal, detected: result.filter((entry) => entry.status !== "failed").length }));
      }
      setProgress((current) => ({ ...current, current: result.filter((entry) => entry.status !== "failed").length, total: result.filter((entry) => entry.status !== "failed").length || 1, detected: result.filter((entry) => entry.status !== "failed").length }));
      if (!result.some((entry) => entry.status === "pending")) setError("No questions were detected in this PDF. Check that it contains selectable text and numbered or clearly separated questions.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDF processing failed."); }
    finally { setBusy(false); }
  }

  function update(id: string, changes: Partial<ReviewItem["value"]>) {
    setItems((current) => current.map((entry) => entry.id === id ? { ...entry, value: { ...entry.value, ...changes }, edited: true } : entry));
  }
  function mark(id: string, status: ReviewItem["status"]) { setItems((current) => current.map((entry) => entry.id === id ? { ...entry, status } : entry)); }
  function existingFor(item: ReviewItem) { return sections.find((section) => section.examId === item.value.examId && section.name.toLowerCase() === item.value.section.toLowerCase()); }
  function targetChapter(item: ReviewItem) { const section = existingFor(item); return chapters.find((chapter) => chapter.sectionId === section?.id && chapter.name.toLowerCase() === item.value.chapter.toLowerCase()); }

  async function retryFailed(entry: ReviewItem) {
    if (!entry.batchText) return;
    setBusy(true); setError("");
    try {
      const response = await api("/api/pdf/analyze", JSON.stringify({ text: entry.batchText, catalog: { exams, sections, chapters }, batchNumber: "retry" }), "application/json") as { questions: AIQuestion[] };
      const retryItems: ReviewItem[] = response.questions.map((value) => {
        const section = sections.find((candidate) => candidate.examId === value.examId && candidate.name.toLowerCase() === value.section.toLowerCase());
        const chapter = chapters.find((candidate) => candidate.sectionId === section?.id && candidate.name.toLowerCase() === value.chapter.toLowerCase());
        const duplicate = section ? questions.some((question) => normalize(question.question) === normalize(value.question) && question.sectionId === section.id
          && (!chapter || question.chapterId === chapter.id)
          && (["A", "B", "C", "D"] as Answer[]).every((key) => normalize(question.options[key] ?? "") === normalize(value.options["ABCD".indexOf(key)] ?? ""))) : false;
        return { id: crypto.randomUUID(), value: section ? value : { ...value, confidence: "Low", confidenceReason: `${value.confidenceReason} No matching existing subject/section was found.`, section: "Unmatched" }, status: "pending", duplicate, edited: false, createChapter: false };
      });
      setItems((current) => { const index = current.findIndex((item) => item.id === entry.id); return [...current.slice(0, index), ...retryItems, ...current.slice(index + 1)]; });
      if (!retryItems.length) setError("This batch did not return any questions. Check that the PDF text separates the questions clearly.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retry failed."); }
    finally { setBusy(false); }
  }

  async function approve(item: ReviewItem, forceDuplicate = false) {
    if (item.duplicate && !forceDuplicate) return;
    const section = existingFor(item);
    if (!section) { setError(`Choose an existing section for Question ${item.value.questionNumber ?? "?"} before approving.`); return; }
    const chapter = targetChapter(item);
    if (!chapter && !item.createChapter) { setError(`Confirm creation of the suggested chapter “${item.value.chapter}” before approving.`); return; }
    try {
      await onApprove(questionToModel(item.value, section, chapter, `import-${crypto.randomUUID()}`), item.createChapter && !chapter);
      mark(item.id, "approved");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add question."); }
  }

  async function approveAll() {
    setError("");
    for (const item of pending) {
      if (item.duplicate || item.status === "failed" || item.value.confidence === "Low" || !existingFor(item)) continue;
      if (!targetChapter(item) && !item.createChapter) continue;
      await approve(item, false);
    }
  }

  function saveHistory() {
    const row: HistoryRow = { file: file?.name ?? "PDF", date: new Date().toISOString(), total: items.length, added: items.filter((item) => item.status === "approved").length, rejected: items.filter((item) => item.status === "rejected").length, duplicates, failed: items.filter((item) => item.status === "failed").length, importedBy };
    const next = [row, ...history].slice(0, 30); setHistory(next); localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); setPdf(event.dataTransfer.files[0]); }
  function onChange(event: ChangeEvent<HTMLInputElement>) { setPdf(event.target.files?.[0]); }
  return <div className="page-stack ai-import-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><Sparkles size={13} /> QUESTION BANK</span><h1>AI PDF Import</h1><p>Extract questions, match your existing exam structure, and review every result before adding it.</p></div></section>
    <section className="settings-card"><h2>Upload Question PDF</h2><p>PDF only · selectable text · maximum 18 MB</p>
      <div className={`pdf-dropzone ${dragging ? "pdf-dropzone-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={onChange} hidden />
        {!file ? <><div className="pdf-upload-icon"><Upload size={22} /></div><b>Drag &amp; drop a PDF here</b><span>or</span><button className="button button-outline" onClick={() => inputRef.current?.click()}>Choose PDF</button></> : <div className="pdf-file-row"><FileText size={22} /><div><b>{file.name}</b><small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small></div><button className="icon-button" aria-label="Remove PDF" onClick={() => setPdf(undefined)}><X size={17} /></button></div>}
      </div>
      <button className="button button-primary" disabled={!file || busy} onClick={() => void analyzePdf()}>{busy ? <><LoaderCircle size={16} className="spin-icon" /> Analyzing PDF…</> : <><Sparkles size={16} /> Analyze PDF</>}</button>
      {busy && <div className="import-progress" role="status"><div><b>Step {progress.step}/4 · {progress.label}</b><span>{progress.stage === "ocr" ? `Page ${progress.page} / ${progress.pageCount || "…"}` : progress.stage === "ai" ? `Question ${progress.current} / ${progress.total}` : progress.stage === "questions" && !progress.detected ? "Finding question numbers…" : `Questions detected: ${progress.detected}`}</span></div><div className="progress-track"><span style={{ width: `${progress.stage === "reading" ? 5 : progress.stage === "ocr" ? 20 + (progress.pageCount ? Math.round(progress.page / progress.pageCount * 35) : 0) : progress.stage === "questions" ? 60 : 65 + Math.round(progress.current / Math.max(progress.total, 1) * 35)}%` }} /></div><small>PDF pages are processed one at a time. AI analysis runs in batches of about 10 questions.</small></div>}
    </section>
    {error && <div className="answer-validation answer-validation-review" role="alert"><AlertCircle size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
    {!!ocrWarnings.length && <div className="answer-validation answer-validation-review" role="status"><AlertCircle size={17} /><span>{ocrWarnings.join(" ")}</span></div>}
    {!!items.length && <>
      <section className="question-stat-panel import-summary"><div className="section-heading"><div><h2>Import summary</h2><p>{file?.name ?? "Question PDF"}</p></div><span className="soft-badge">{items.length} detected</span></div><div className="import-summary-grid"><span>Successfully analyzed <b>{items.filter((item) => item.status !== "failed").length}</b></span><span>Added <b>{items.filter((item) => item.status === "approved").length}</b></span><span>Needs review <b>{pending.length}</b></span><span>Rejected <b>{items.filter((item) => item.status === "rejected").length}</b></span><span>Failed <b>{items.filter((item) => item.status === "failed").length}</b></span><span>Possible duplicates <b>{duplicates}</b></span></div><div className="import-subjects"><b>Subjects detected</b>{detectedSubjects.length ? detectedSubjects.map((subject) => <span className="soft-badge" key={subject}>{subject}</span>) : <span>None matched</span>}</div><div className="import-review-actions"><button className="button button-outline" onClick={saveHistory}>Save import history</button><button className="button button-primary" disabled={!pending.length} onClick={() => void approveAll()}>Approve all valid questions</button></div></section>
      <section className="import-question-list"><div className="section-heading"><div><h2>Review extracted questions</h2><p>Low confidence items and possible duplicates need individual review.</p></div></div>
        {items.map((entry, index) => { const item = entry.value; const section = existingFor(entry); const matchingChapter = targetChapter(entry); const optionString = item.options.join("\n"); return <article className="import-question-card" key={entry.id}>
          <header><div><span className="eyebrow">QUESTION {item.questionNumber ?? index + 1}</span><span className={`confidence-tag confidence-${item.confidence.toLowerCase()}`}>{item.confidence} confidence</span></div><span className={`status-pill ${entry.status === "approved" ? "status-approved" : entry.status === "rejected" ? "status-rejected" : entry.status === "failed" ? "status-wrong" : ""}`}>{entry.status === "pending" ? "Needs review" : entry.status}</span></header>
          {entry.duplicate && <div className="duplicate-warning"><AlertCircle size={16} /><span><b>Possible duplicate question.</b> Compare it with the existing question bank before choosing Add Anyway.</span></div>}
          {entry.status === "failed" ? <div className="import-failed"><b>Processing failed</b><p>{entry.error}</p><button className="button button-outline" disabled={busy} onClick={() => void retryFailed(entry)}>Retry this batch</button></div> : <>
            <label className="form-label">Question<textarea rows={3} value={item.question} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { question: event.target.value })} /></label>
            <div className="import-edit-grid"><label className="form-label">Type<select value={item.type} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { type: event.target.value })}>{["MCQ", "Multiple Correct", "True/False", "Numerical", "Fill in the Blank", "Short Answer", "Long Answer", "Assertion & Reason", "Match the Following", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="form-label">Exam<select value={item.examId} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { examId: event.target.value, section: "", subject: "", chapter: "" })}>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}</select></label>
              <label className="form-label">Subject / section<select value={section?.id ?? ""} disabled={entry.status !== "pending"} onChange={(event) => { const next = sections.find((candidate) => candidate.id === event.target.value); update(entry.id, { section: next?.name ?? "", subject: next?.name ?? "", chapter: "" }); }}><option value="">Select an existing section</option>{sections.filter((candidate) => candidate.examId === item.examId).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
              <label className="form-label">Chapter<select value={matchingChapter?.id ?? "suggested"} disabled={entry.status !== "pending"} onChange={(event) => { const selected = chapters.find((candidate) => candidate.id === event.target.value); if (selected) { update(entry.id, { chapter: selected.name }); setItems((current) => current.map((row) => row.id === entry.id ? { ...row, createChapter: false, value: { ...row.value, chapter: selected.name } } : row)); } else setItems((current) => current.map((row) => row.id === entry.id ? { ...row, createChapter: false } : row)); }}><option value="suggested">Suggested new: {item.chapter || "Review needed"}</option>{chapters.filter((candidate) => candidate.sectionId === section?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
            </div>
            {!matchingChapter && item.chapter && <label className="chapter-confirm"><input type="checkbox" checked={entry.createChapter} disabled={entry.status !== "pending"} onChange={(event) => setItems((current) => current.map((row) => row.id === entry.id ? { ...row, createChapter: event.target.checked } : row))} /> Create suggested chapter “{item.chapter}” on approval</label>}
            <div className="import-edit-grid"><label className="form-label">Options (one per line)<textarea rows={Math.min(6, Math.max(2, item.options.length))} value={optionString} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { options: event.target.value.split(/\r?\n/).filter((line) => line.trim()) })} /></label><div><label className="form-label">Correct answer<input value={item.correctAnswer} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { correctAnswer: event.target.value })} /></label><label className="form-label">Difficulty<select value={item.difficulty} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { difficulty: event.target.value as Difficulty })}>{["Easy", "Medium", "Hard"].map((value) => <option key={value}>{value}</option>)}</select></label></div></div>
            <label className="form-label">Explanation<textarea rows={3} value={item.explanation} disabled={entry.status !== "pending"} onChange={(event) => update(entry.id, { explanation: event.target.value })} /></label>
            <div className="import-classification"><span><b>Topic:</b> {item.topic || "—"}</span><span><b>Tags:</b> {item.tags.join(", ") || "—"}</span><span className={`confidence-tag confidence-${item.confidence.toLowerCase()}`}>{item.confidenceReason || "No uncertainty noted"}</span></div>
            {entry.status === "pending" && <div className="import-card-actions"><button className="button button-quiet" onClick={() => mark(entry.id, "rejected")}>{entry.duplicate ? "Skip duplicate" : "Reject"}</button><button className="button button-outline" onClick={() => setItems((current) => current.map((row) => row.id === entry.id ? { ...row, edited: true } : row))}>Edit fields above</button>{entry.duplicate && <button className="button button-outline" onClick={() => void approve(entry, true)}>Add anyway</button>}{item.confidence === "Low" && <button className="button button-outline" disabled={!section || (!matchingChapter && !entry.createChapter)} onClick={() => void approve(entry)}>Review &amp; Add Anyway</button>}<button className="button button-primary" disabled={entry.duplicate || item.confidence === "Low" || !section || (!matchingChapter && !entry.createChapter)} onClick={() => void approve(entry)}><Check size={15} /> Approve &amp; Add</button></div>}
          </>}
        </article>; })}
      </section>
    </>}
    <section className="question-stat-panel"><div className="section-heading"><div><h2>Import history</h2><p>Saved summaries for imports reviewed in this browser.</p></div></div><div className="table-wrap"><table><thead><tr><th>File</th><th>Date</th><th>Total</th><th>Added</th><th>Rejected</th><th>Duplicates</th><th>Failed</th><th>Imported by</th></tr></thead><tbody>{history.map((row, index) => <tr key={`${row.file}-${index}`}><td>{row.file}</td><td>{new Date(row.date).toLocaleDateString()}</td><td>{row.total}</td><td>{row.added}</td><td>{row.rejected}</td><td>{row.duplicates}</td><td>{row.failed}</td><td>{row.importedBy}</td></tr>)}{!history.length && <tr><td colSpan={8} className="table-empty">No imports yet.</td></tr>}</tbody></table></div></section>
  </div>;
}
