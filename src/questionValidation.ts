import type { Answer, Chapter, Difficulty, Question, Section } from "./model";

export const ALL_ANSWER_OPTIONS: Answer[] = ["A", "B", "C", "D", "E"];

export type ValidationResult = {
  isValid: boolean;
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type ValidatableQuestion = {
  question?: string;
  type?: string;
  options?: Record<string, string> | string[];
  correctAnswer?: string;
  explanation?: string;
  difficulty?: Difficulty | string;
};

/**
 * Normalizes an option key or number string (e.g. "1" -> "A", "5" -> "E", "Option 5" -> "E", "Choice E" -> "E")
 */
export function normalizeOptionKey(keyOrNumber: string): Answer | undefined {
  if (!keyOrNumber) return undefined;
  const cleaned = keyOrNumber.trim().toUpperCase()
    .replace(/^(?:OPTION|CHOICE)\s+/i, "")
    .replace(/^\(?([A-E1-5])\)?\.?$/, "$1");
  const numMap: Record<string, Answer> = {
    "1": "A",
    "2": "B",
    "3": "C",
    "4": "D",
    "5": "E",
  };
  if (numMap[cleaned]) return numMap[cleaned];
  if (ALL_ANSWER_OPTIONS.includes(cleaned as Answer)) return cleaned as Answer;
  return undefined;
}

/**
 * Returns the active option keys (A, B, C, D, E) present on a question.
 * Only returns keys that have actual non-empty content.
 * Never creates or returns a 5th option if the question does not have one.
 */
export function getQuestionOptionKeys(question: { options?: Record<string, string> | Partial<Record<Answer, string>> }): Answer[] {
  if (!question.options || typeof question.options !== "object") return ["A", "B", "C", "D"];
  const active = ALL_ANSWER_OPTIONS.filter((key) => {
    const val = question.options?.[key];
    return typeof val === "string" && val.trim().length > 0;
  });
  return active.length > 0 ? active : ["A", "B", "C", "D"];
}

/**
 * Validates a question before saving or importing.
 * Detects missing question text, truncated passages, missing multiple choice options,
 * invalid answer keys, and option mismatches.
 */
export function validateQuestionForImport(q: ValidatableQuestion): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Question text validation
  const questionText = typeof q.question === "string" ? q.question.trim() : "";
  if (!questionText) {
    errors.push("Question text is completely missing or empty.");
  } else if (questionText.length < 8) {
    errors.push("Question text is too short to be a valid question.");
  } else {
    // Check if question appears truncated (e.g., ends with dangling condition or lacks question sentence)
    const hasQuestionSign = /[?:]\s*$/.test(questionText) || /\b(which|what|how|why|when|where|who|calculate|find|determine|select|choose|identify|evaluate)\b/i.test(questionText);
    if (!hasQuestionSign && questionText.length < 30) {
      warnings.push("Question text may be incomplete or missing the actual question sentence.");
    }
  }

  // 2. Options validation
  const isTextMode = q.type === "TITA" || q.type === "Numerical" || q.type === "Short Answer";
  
  if (!isTextMode) {
    let optionsCount = 0;
    const rawOptions = q.options;

    if (Array.isArray(rawOptions)) {
      rawOptions.forEach((opt, idx) => {
        const str = typeof opt === "string" ? opt.trim() : "";
        if (str) {
          optionsCount++;
        } else if (idx < rawOptions.length - 1 && rawOptions[idx + 1]) {
          errors.push(`Option ${idx + 1} is blank while subsequent options have content.`);
        }
      });
    } else if (rawOptions && typeof rawOptions === "object") {
      const optMap: Record<string, string> = rawOptions;
      ALL_ANSWER_OPTIONS.forEach((key, idx) => {
        const val = optMap[key];
        const str = typeof val === "string" ? val.trim() : "";
        if (str) {
          optionsCount++;
        } else {
          // If subsequent options exist but this one is blank
          const subsequentHasValue = ALL_ANSWER_OPTIONS.slice(idx + 1).some((nextKey) => {
            const nextVal = optMap[nextKey];
            return typeof nextVal === "string" && nextVal.trim().length > 0;
          });
          if (subsequentHasValue) {
            errors.push(`Option ${key} is missing or empty while later options are present.`);
          }
        }
      });
    }

    if (optionsCount < 2) {
      errors.push(`Multiple-choice question must have at least 2 valid options (found ${optionsCount}).`);
    } else if (optionsCount === 3) {
      warnings.push("Question has only 3 options. MBA exams typically use 4 or 5 options.");
    }

    // Check if 5th option was expected but missing
    const rawAnswer = (q.correctAnswer ?? "").trim().toUpperCase();
    if (rawAnswer === "E" || rawAnswer === "5" || rawAnswer === "OPTION 5") {
      const hasFifth = Array.isArray(rawOptions)
        ? Boolean(rawOptions[4]?.trim())
        : Boolean((rawOptions as Record<string, string>)?.E?.trim());
      if (!hasFifth) {
        errors.push("Correct answer points to Option E/5, but the 5th option content is missing.");
      }
    }
  }

  // 3. Correct answer validation
  const ans = typeof q.correctAnswer === "string" ? q.correctAnswer.trim() : "";
  if (!ans) {
    warnings.push("No correct answer is recorded for this question.");
  } else if (!isTextMode) {
    const normalizedKey = normalizeOptionKey(ans);
    let matchedOptionText = false;
    const rawOptions = q.options;

    if (Array.isArray(rawOptions)) {
      matchedOptionText = rawOptions.some((opt) => opt.trim().toLowerCase() === ans.toLowerCase());
    } else if (rawOptions && typeof rawOptions === "object") {
      matchedOptionText = Object.values(rawOptions).some((opt) => typeof opt === "string" && opt.trim().toLowerCase() === ans.toLowerCase());
    }

    if (!normalizedKey && !matchedOptionText) {
      warnings.push(`Correct answer "${ans}" does not match any recognized option key (A-E) or option text.`);
    }
  }

  const passed = errors.length === 0;
  return {
    isValid: passed,
    valid: passed,
    errors,
    warnings,
  };
}

/**
 * Evaluates whether a student's answer is correct for a question.
 * Accurately supports:
 * - Option 1, 2, 3, 4, and Option 5
 * - Letter selection ("A", "B", "C", "D", "E")
 * - Number selection ("1", "2", "3", "4", "5")
 * - Exact or normalized option text match (e.g. "None of the remaining options is correct")
 * - Numerical tolerance for TITA questions
 */
function parseNumericValue(val: string): number | undefined {
  const clean = val.replace(/,/g, "").replace(/\s/g, "");
  const fraction = clean.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    return den ? Number(fraction[1]) / den : undefined;
  }
  const n = Number(clean);
  return Number.isNaN(n) ? undefined : n;
}

const normText = (s: string) => s.trim().replace(/[.,;:]+$/, "").toLowerCase();

/**
 * Evaluates whether a student's answer is correct for a question.
 * Accurately supports:
 * - Option 1, 2, 3, 4, and Option 5
 * - Letter selection ("A", "B", "C", "D", "E")
 * - Number selection ("1", "2", "3", "4", "5")
 * - Exact or normalized option text match (e.g. "None of the remaining options is correct")
 * - Numerical tolerance and fractions for TITA questions
 */
export function evaluateStudentAnswer(question: Question, submittedAnswer: string): boolean {
  if (submittedAnswer === undefined || submittedAnswer === null) return false;
  const subTrimmed = submittedAnswer.trim();
  if (!subTrimmed) return false;

  const rawCorrect = (question.correctAnswer ?? "").trim();
  if (!rawCorrect) return false;

  // Detect TITA mode
  const anyNonEmptyOption = question.options && Object.values(question.options).some((v) => typeof v === "string" && v.trim().length > 0);
  const isTextMode = question.answerMode === "text"
    || (question as { questionType?: string }).questionType === "TITA"
    || (question as { type?: string }).type === "TITA"
    || (question as { questionType?: string }).questionType === "Numerical"
    || (question as { type?: string }).type === "Numerical"
    || !anyNonEmptyOption;

  if (isTextMode) {
    const subNum = parseNumericValue(subTrimmed);
    const corrNum = parseNumericValue(rawCorrect);

    if (subNum !== undefined && corrNum !== undefined) {
      return Math.abs(subNum - corrNum) < 1e-6;
    }
    return normText(subTrimmed) === normText(rawCorrect);
  }

  // MCQ evaluation
  const subUpper = subTrimmed.toUpperCase();
  const corrUpper = rawCorrect.toUpperCase();

  const numMap: Record<string, Answer> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
  const subLetter = numMap[subUpper] || (ALL_ANSWER_OPTIONS.includes(subUpper as Answer) ? (subUpper as Answer) : undefined);
  const corrLetter = numMap[corrUpper] || (ALL_ANSWER_OPTIONS.includes(corrUpper as Answer) ? (corrUpper as Answer) : undefined);

  // 1. Direct letter match (A-E)
  if (subLetter && corrLetter && subLetter === corrLetter) {
    return true;
  }

  // 2. Direct string match
  if (subUpper === corrUpper || normText(subTrimmed) === normText(rawCorrect)) {
    return true;
  }

  // 3. Student submitted letter matching option text of correct answer
  const activeKeys = getQuestionOptionKeys(question);
  const targetCorrectKey = corrLetter ?? activeKeys.find((k) => normText(question.options[k] ?? "") === normText(rawCorrect));

  if (targetCorrectKey) {
    if (subLetter && subLetter === targetCorrectKey) return true;
    const correctText = question.options[targetCorrectKey];
    if (correctText && normText(correctText) === normText(subTrimmed)) return true;
  }

  // 4. Student submitted option text matching the student's selected option
  const matchedStudentKey = activeKeys.find((k) => normText(question.options[k] ?? "") === normText(subTrimmed));
  if (matchedStudentKey && targetCorrectKey && matchedStudentKey === targetCorrectKey) {
    return true;
  }

  return false;
}

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

export function checkQuestionNeedsReview(
  item: ReviewItem,
  sections: Section[],
  _chapters?: Chapter[]
): { needsReview: boolean; reason?: string } {
  if (item.status === "failed") {
    return { needsReview: true, reason: item.error || "Batch processing failed" };
  }
  if (item.duplicate) {
    return { needsReview: true, reason: "Possible duplicate with existing question in bank" };
  }
  if (item.value.confidence === "Low") {
    return { needsReview: true, reason: item.value.confidenceReason || "Low AI extraction confidence" };
  }
  const section = sections.find(
    (s) => s.examId === item.value.examId && s.name.toLowerCase() === item.value.section.toLowerCase()
  );
  if (!section) {
    return { needsReview: true, reason: `Unmatched section: "${item.value.section}"` };
  }
  const validation = validateQuestionForImport({
    question: item.value.question,
    options: item.value.options,
    type: item.value.type,
    correctAnswer: item.value.correctAnswer,
  });
  if (!validation.isValid || !validation.valid) {
    return { needsReview: true, reason: validation.errors.join("; ") };
  }
  if (!item.value.correctAnswer || !item.value.correctAnswer.trim()) {
    return { needsReview: true, reason: "Missing correct answer key" };
  }
  if (item.value.hasDiagram && !item.value.imageUrl) {
    return { needsReview: true, reason: "Diagram / graph snippet needed" };
  }
  if (validation.warnings.some((w) => w.includes("incomplete") || w.includes("does not match any recognized option"))) {
    return { needsReview: true, reason: validation.warnings.join("; ") };
  }
  return { needsReview: false };
}

/**
 * Detects if a line is an option choice (e.g. (A), (1), [1], A., 1), Option 1, etc.)
 * rather than a question stem start.
 */
export function isOptionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Option indicators: (A)-(E), (a)-(e), (1)-(5), [A]-[E], [1]-[5]
  if (/^\s*(?:\([1-5a-eA-E]\)|\[[1-5a-eA-E]\])\s*/i.test(trimmed)) {
    return true;
  }

  // Explicit label: Option A, Option 1, Option (A), Option (1), Choice A, Choice 1
  if (/^\s*(?:Option|Choice)\s*[-:]?\s*(?:\([1-5a-eA-E]\)|\[[1-5a-eA-E]\]|[1-5a-eA-E]\b)/i.test(trimmed)) {
    return true;
  }

  // Letter options: A. , B) , C: , D -
  if (/^\s*[a-eA-E]\s*[.)\]:-]\s+\S+/i.test(trimmed)) {
    return true;
  }

  // Single digit option 1) to 5)
  if (/^\s*[1-5]\s*\)\s+\S+/i.test(trimmed)) {
    return true;
  }

  // Roman numerals: (i), (ii), (iii), (iv), (v) or i), ii)
  if (/^\s*(?:\([ivx]+\)|[ivx]+\s*\))\s+/i.test(trimmed)) {
    return true;
  }

  // Short 1-5 digit followed by dot/colon with typical option content (e.g. "1. 45", "2. None of these", "3. Rs. 500")
  if (/^\s*[1-5]\s*[.:-]\s+(?:none\b|all\b|both\b|neither\b|cannot\b|\$|₹|[A-Za-z0-9/%.,+\- ]{1,45})$/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Smart adaptive batching: groups text into chunks of complete questions,
 * ensuring options are NEVER split across chunk boundaries.
 */
export function questionChunks(text: string, maxPerChunk: number = 3, maxCharLen: number = 4000): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const starts: number[] = [];

  // Check if document has explicit "Question X" or "Q.X" headers
  const hasExplicitQHeaders = lines.some((line) =>
    /^\s*(?:(?:Question|Que(?:st)?\.?|Prob(?:lem)?\.?|Q\.?|Ques\.?)\s*#?\s*\d{1,3}\b|Question\s*ID\s*:\s*\d+)/i.test(line.trim())
  );

  const directionRegex = /^\s*(?:Directions?\b|Read the following|Passage\b|Consider the following|Common Data|Instructions?\b|Caselet\b|Study the following)/i;

  function isQuestionStartLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (isOptionLine(trimmed)) return false;

    // 1. Explicit question markers (Question 1, Q.1, Q1:, Problem 1, Question ID: 123)
    if (/^\s*(?:(?:Question|Que(?:st)?\.?|Prob(?:lem)?\.?|Q\.?|Ques\.?)\s*#?\s*\d{1,3}\b|Question\s*ID\s*:\s*\d+)/i.test(trimmed)) {
      return true;
    }

    // 2. If document uses explicit Question headers, do not treat bare numbers as questions
    if (hasExplicitQHeaders) {
      return false;
    }

    // 3. For documents that only use bare numbers (e.g. "1. ", "2. "):
    // Numbers > 5 are definitely questions (options are only 1-4 or 1-5)
    if (/^\s*(?:[6-9]|\d{2,3})[.)\]:-]\s+\S+/.test(trimmed)) {
      return true;
    }

    // For bare 1-5: must have substantial text (>= 25 chars) and not match option indicators
    if (/^\s*[1-5][.)\]:-]\s+\S+/.test(trimmed) && trimmed.length >= 25) {
      return true;
    }

    return false;
  }

  lines.forEach((line, index) => {
    if (isQuestionStartLine(line)) starts.push(index);
  });

  let parts: string[] = [];
  if (starts.length > 0) {
    const boundaries: number[] = [0];
    for (let i = 1; i < starts.length; i++) {
      let splitPoint = starts[i];
      for (let j = starts[i - 1] + 1; j < starts[i]; j++) {
        if (directionRegex.test(lines[j])) {
          splitPoint = j;
          break;
        }
      }
      boundaries.push(splitPoint);
    }
    boundaries.push(lines.length);

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
    if (currentBatch.length >= maxPerChunk || (currentLen + part.length > maxCharLen && currentBatch.length > 0)) {
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

