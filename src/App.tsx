import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, ArrowLeft, ArrowRight, Award, BookOpen, Check, ChevronDown, CircleHelp, ClipboardList,
  Clock3, Eye, EyeOff, Filter, Flag, GraduationCap, Image as ImageIcon, Key, LayoutDashboard, LogIn, LogOut, Menu, Moon, Search, ShieldCheck, Sun,
  Shuffle, Sparkles, Target, Trash2, UserRound, X, Zap, Users, Settings, Layers3, FileText,
} from "lucide-react";
import { initialChapters, initialExams, initialQuestions, initialSections } from "./data";
import { applyClassification, classifyQuestion, type QuestionClassification } from "./classifier";
import { demoAnswerKeys } from "./demoAnswerKeys";
import { findCat2024Slot3Solution } from "./cat2024Slot3Solutions";
import { MathContent, MathPreview, QuestionGraphViewer } from "./MathContent";
import { ALL_ANSWER_OPTIONS, getQuestionOptionKeys, evaluateStudentAnswer, validateQuestionForImport } from "./questionValidation";
import { AiPdfImport } from "./AiPdfImport";
import { ApiKeyManager } from "./ApiKeyManager";
import { CbtMockExam } from "./CbtMockExam";
import { PageTransition } from "./components/ui";
import { firestore, isFirebaseConfigured } from "./firebase";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import {
  clearLocalSession, createLocalStudent, deleteLocalStudent, listManagedAttempts, listManagedStudents, loginLocalAccount, logoutAdminSession,
  resetLocalStudentPassword, setLocalStudentDisabled, updateLocalStudent, verifySession,
} from "./localAuth";
import type { Answer, Attempt, Chapter, Difficulty, Exam, ExamCategory, ExtractedPaper, CbtExamResult, PlatformChapter, PlatformExam, PlatformSubject, Question, QuestionChange, QuestionReport, QuestionReportStatus, Section, SiteSettings, StudentAccountInput, StudentQuizAttempt, UserProfile } from "./model";

type View = "dashboard" | "practice" | "random" | "wrong" | "progress" | "reports" | "admin";
type QuizState = { questions: Question[]; index: number; answers: Record<string, string | null>; title: string; origin: View; sessionId: string };
type EntityType = "exam" | "section" | "chapter" | "question";
type Entity = Exam | Section | Chapter | Question;
type LoginKind = "student" | "admin";
type LoginPage = "choose" | "student-category" | LoginKind;
type AdminArea = "dashboard" | "students" | "create-student" | "questions" | "delete-questions" | "sections" | "chapters" | "categories" | "exams" | "subjects" | "statistics" | "settings" | "reports" | "ai-import" | "api-keys";
const defaultSettings: SiteSettings = {
  id: "public",
  title: "MBA Prep",
  welcomeMessage: "Build your confidence, one focused practice session at a time.",
  logoUrl: "",
  theme: "violet",
  hiddenExamIds: [],
  hiddenSectionIds: [],
};
const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "random", label: "Random quiz", icon: Shuffle },
  { id: "wrong", label: "Wrong questions", icon: Target },
  { id: "progress", label: "My progress", icon: Activity },
  { id: "reports", label: "My reports", icon: Flag },
];
const answerOptions: Answer[] = ALL_ANSWER_OPTIONS;

function readLocal<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) as T : fallback;
}
function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
function percent(a: number, b: number) {
  return b ? Math.round((a / b) * 100) : 0;
}
function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function isCorrectAnswer(question: Question, submitted: string): boolean {
  return evaluateStudentAnswer(question, submitted);
}
function mapFirestoreQuestion(id: string, row: Record<string, unknown>, examId: string, sections: Section[], chapters: Chapter[]): Question {
  const questionText = typeof row.question === "string" ? row.question : "";
  const pdfSolution = examId === "cat" ? findCat2024Slot3Solution(questionText) : undefined;
  const category = (typeof row.category === "string" && row.category.trim())
    || (typeof row.subject === "string" && row.subject.trim())
    || (typeof row.topic === "string" && row.topic.trim())
    || "";
  const section = sections.find((item) => item.examId === examId && item.name.trim().toLowerCase() === category.toLowerCase())
    ?? sections.find((item) => item.examId === examId && (
      (category.toLowerCase().includes("verbal") && item.name.toLowerCase().includes("verbal")) ||
      (category.toLowerCase().includes("decision") && item.name.toLowerCase().includes("decision")) ||
      (category.toLowerCase().includes("quant") && item.name.toLowerCase().includes("quant")) ||
      (category.toLowerCase().includes("general") && item.name.toLowerCase().includes("general"))
    ))
    ?? sections.find((item) => item.examId === examId);
  const chapter = section && (chapters.find((item) => item.sectionId === section.id && item.name.trim().toLowerCase() === (row.chapter ? String(row.chapter).trim().toLowerCase() : ""))
    ?? chapters.find((item) => item.sectionId === section.id));

  let optA = typeof row.optionA === "string" ? row.optionA.trim() : "";
  let optB = typeof row.optionB === "string" ? row.optionB.trim() : "";
  let optC = typeof row.optionC === "string" ? row.optionC.trim() : "";
  let optD = typeof row.optionD === "string" ? row.optionD.trim() : "";
  let optE = typeof row.optionE === "string" ? row.optionE.trim() : "";

  if (Array.isArray(row.options)) {
    if (!optA && row.options[0]) optA = String(row.options[0]).trim();
    if (!optB && row.options[1]) optB = String(row.options[1]).trim();
    if (!optC && row.options[2]) optC = String(row.options[2]).trim();
    if (!optD && row.options[3]) optD = String(row.options[3]).trim();
    if (!optE && row.options[4]) optE = String(row.options[4]).trim();
  } else if (row.options && typeof row.options === "object") {
    const opts = row.options as Record<string, unknown>;
    if (!optA && opts.A) optA = String(opts.A).trim();
    if (!optB && opts.B) optB = String(opts.B).trim();
    if (!optC && opts.C) optC = String(opts.C).trim();
    if (!optD && opts.D) optD = String(opts.D).trim();
    if (!optE && opts.E) optE = String(opts.E).trim();
  }

  const options: Record<string, string> = {
    A: optA,
    B: optB,
    C: optC,
    D: optD,
  };
  if (optE) {
    options.E = optE;
  }

  const rawAnswer = (typeof row.answer === "string" && row.answer.trim())
    || (typeof row.correctAnswer === "string" && row.correctAnswer.trim())
    || (typeof row.correct_answer === "string" && row.correct_answer.trim())
    || "";
  const answer = pdfSolution?.answer ?? rawAnswer;
  const hasOptions = Boolean(options.A?.trim() || options.B?.trim());

  const numMap: Record<string, Answer> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
  const answerTrimmed = answer.trim().toUpperCase();
  const directMatch = numMap[answerTrimmed] || (ALL_ANSWER_OPTIONS.find((l) => l === answerTrimmed));
  const answerLetter = directMatch ?? ALL_ANSWER_OPTIONS.find((letter) => options[letter]?.trim().toLowerCase() === answer.toLowerCase());

  const yearNum = typeof row.year === "number" ? row.year : (typeof row.sourceYear === "number" ? row.sourceYear : (Number(row.year) || undefined));
  const slotStr = typeof row.slot === "string" || typeof row.slot === "number" ? String(row.slot) : (typeof row.sourceSlot === "string" ? row.sourceSlot : undefined);
  const paperTitle = typeof row.paperTitle === "string" ? row.paperTitle : undefined;
  const paperId = typeof row.paperId === "string" ? row.paperId : undefined;
  const source = typeof row.source === "string" ? row.source : undefined;
  const imageUrl = typeof row.imageUrl === "string" && row.imageUrl.trim() ? row.imageUrl : undefined;
  const imageAlt = typeof row.imageAlt === "string" ? row.imageAlt : undefined;
  const hasDiagram = Boolean(row.hasDiagram || imageUrl);

  return {
    id: `firestore-${id}`,
    examId,
    sectionId: section?.id ?? `${examId}-s1`,
    chapterId: chapter?.id ?? `${section?.id ?? `${examId}-s1`}-c1`,
    topic: category || undefined,
    question: questionText,
    options,
    answerMode: hasOptions ? "choice" : "text",
    correctAnswer: hasOptions ? answerLetter : answer || undefined,
    hasAnswerKey: Boolean(hasOptions ? answerLetter : answer),
    explanation: pdfSolution?.explanation ?? (typeof row.explanation === "string" ? row.explanation : ""),
    difficulty: (row.difficulty as Difficulty) || "Medium",
    subject: typeof row.subject === "string" ? row.subject : typeof row.category === "string" ? row.category : undefined,
    chapter: typeof row.chapter === "string" ? row.chapter : typeof row.chapterName === "string" ? row.chapterName : typeof row.topic === "string" ? row.topic : undefined,
    subTopic: typeof row.subTopic === "string" ? row.subTopic : undefined,
    year: yearNum,
    slot: slotStr,
    sourceYear: yearNum,
    sourceSlot: slotStr,
    paperId,
    paperTitle,
    source,
    question_number: typeof row.question_number === "number" ? row.question_number : (Number(row.question_number) || undefined),
    imageUrl,
    imageAlt,
    hasDiagram,
  };
}

function aiQuestionToAppQuestion(
  q: Record<string, unknown>,
  index: number,
  paper: ExtractedPaper,
  sections: Section[],
  chapters: Chapter[]
): Question {
  const examId = (paper.examId || (typeof q.examId === "string" ? q.examId : "xat")).toLowerCase();
  const qText = String(q.question ?? "").trim();

  // Find matching section with keyword tolerance
  const sectionName = String(q.section ?? q.subject ?? q.category ?? "").trim().toLowerCase();
  const matchedSection = sections.find((s) => s.examId === examId && s.name.trim().toLowerCase() === sectionName)
    ?? sections.find((s) => s.examId === examId && (
      (sectionName.includes("verbal") && s.name.toLowerCase().includes("verbal")) ||
      (sectionName.includes("decision") && s.name.toLowerCase().includes("decision")) ||
      (sectionName.includes("quant") && s.name.toLowerCase().includes("quant")) ||
      (sectionName.includes("data") && s.name.toLowerCase().includes("data")) ||
      (sectionName.includes("general") && s.name.toLowerCase().includes("general")) ||
      (sectionName.includes("knowledge") && s.name.toLowerCase().includes("knowledge"))
    ))
    ?? sections.find((s) => s.examId === examId);

  const sectionId = matchedSection?.id ?? `${examId}-s1`;

  // Find matching chapter
  const chapterName = String(q.chapter ?? q.topic ?? "").trim().toLowerCase();
  const matchedChapter = chapters.find((c) => c.sectionId === sectionId && c.name.trim().toLowerCase() === chapterName)
    ?? chapters.find((c) => c.sectionId === sectionId);
  const chapterId = matchedChapter?.id ?? `${sectionId}-c1`;

  // Parse options
  let optA = "";
  let optB = "";
  let optC = "";
  let optD = "";
  let optE = "";

  if (Array.isArray(q.options)) {
    optA = String(q.options[0] ?? "");
    optB = String(q.options[1] ?? "");
    optC = String(q.options[2] ?? "");
    optD = String(q.options[3] ?? "");
    optE = String(q.options[4] ?? "");
  } else if (q.options && typeof q.options === "object") {
    const opts = q.options as Record<string, unknown>;
    optA = String(opts.A ?? opts.optionA ?? "");
    optB = String(opts.B ?? opts.optionB ?? "");
    optC = String(opts.C ?? opts.optionC ?? "");
    optD = String(opts.D ?? opts.optionD ?? "");
    optE = String(opts.E ?? opts.optionE ?? "");
  } else {
    optA = String(q.optionA ?? "");
    optB = String(q.optionB ?? "");
    optC = String(q.optionC ?? "");
    optD = String(q.optionD ?? "");
    optE = String(q.optionE ?? "");
  }

  const optionMap: Record<string, string> = { A: optA, B: optB, C: optC, D: optD };
  if (optE.trim()) optionMap.E = optE;

  const hasOptions = Boolean(optA.trim() || optB.trim());
  const rawAns = String(q.correctAnswer ?? q.answer ?? "").trim().toUpperCase();
  const answerLetter = (["A", "B", "C", "D", "E"] as const).find((l) => l === rawAns)
    ?? (["A", "B", "C", "D", "E"] as const).find((l) => optionMap[l]?.trim().toLowerCase() === rawAns.toLowerCase());

  const qNum = typeof q.questionNumber === "number" ? q.questionNumber : (Number(q.question_number) || index + 1);
  const qId = (typeof q.id === "string" && q.id.trim()) ? q.id : `paper-${paper.id}-q${qNum}`;

  return {
    id: qId,
    examId,
    sectionId,
    chapterId,
    topic: (typeof q.chapter === "string" && q.chapter.trim()) || matchedChapter?.name || "General Practice",
    subTopic: (typeof q.topic === "string" && q.topic.trim()) || undefined,
    question: qText,
    options: optionMap,
    answerMode: hasOptions ? "choice" : "text",
    correctAnswer: hasOptions ? answerLetter : rawAns || undefined,
    hasAnswerKey: Boolean(hasOptions ? answerLetter : rawAns),
    explanation: String(q.explanation ?? ""),
    difficulty: (q.difficulty as Difficulty) || "Medium",
    questionType: (typeof q.type === "string" && q.type.trim()) || (hasOptions ? "MCQ" : "TITA"),
    tags: Array.isArray(q.tags) ? (q.tags as string[]) : [],
    paperId: paper.id,
    paperTitle: paper.paperTitle,
    year: paper.year,
    slot: paper.slot,
    sourceYear: paper.year,
    sourceSlot: paper.slot,
    source: paper.fileName,
    question_number: qNum,
    imageUrl: typeof q.imageUrl === "string" ? q.imageUrl : undefined,
    imageAlt: typeof q.imageAlt === "string" ? q.imageAlt : undefined,
    hasDiagram: Boolean(q.hasDiagram || q.imageUrl),
  };
}

async function fetchFirestoreExamQuestions(examId: string, sections: Section[], chapters: Chapter[]): Promise<Question[]> {
  if (!firestore) throw new Error("Firebase is not configured. Add your Firebase Web App values to .env.local and restart the app.");
  const examCode = examId.toUpperCase();
  const examQuery = query(collection(firestore, "examQuestions"), where("exam", "in", [examCode, examId.toLowerCase()]));
  const snapshot = await getDocs(examQuery);
  return snapshot.docs.map((document) => mapFirestoreQuestion(document.id, document.data(), examId, sections, chapters))
    .filter((question) => Boolean(question.question.trim()));
}
function normalizeCatalogValue(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}
function questionsForPlatformChapter(questions: Question[], exam: PlatformExam, subject: PlatformSubject, chapter: PlatformChapter) {
  const examNames = new Set([exam.id, exam.name, exam.quizExamId].map(normalizeCatalogValue).filter(Boolean));
  const subjectName = normalizeCatalogValue(subject.name);
  const chapterName = normalizeCatalogValue(chapter.name);
  return questions.filter((question) => {
    const examMatches = [question.examId, question.exam].some((value) => examNames.has(normalizeCatalogValue(value)));
    if (!examMatches) return false;
    const subjectMatches = [question.subject, question.topic].some((value) => normalizeCatalogValue(value) === subjectName);
    if (!subjectMatches) return false;
    const chapterMatches = [question.chapter, question.subTopic, question.topic]
      .some((value) => normalizeCatalogValue(value) === chapterName);
    if (!chapterMatches && normalizeCatalogValue(question.chapterId) !== normalizeCatalogValue(chapter.id)) return false;
    const options = question.options;
    const correctAnswer = question.correctAnswer?.trim().toUpperCase();
    return question.answerMode !== "text"
      && ["A", "B", "C", "D"].every((key) => typeof options[key as Answer] === "string" && Boolean(options[key as Answer]?.trim()))
      && Boolean(correctAnswer && ["A", "B", "C", "D"].includes(correctAnswer) && question.hasAnswerKey !== false);
  }).map((question) => ({
    ...question,
    examId: exam.quizExamId || exam.id,
    sectionId: subject.id,
    chapterId: chapter.id,
    subject: subject.name,
    chapter: chapter.name,
    topic: subject.name,
  }));
}
type AnswerCheck = { kind: "mismatch" | "review"; message: string } | null;
function checkMathAnswer(question: Pick<Question, "question" | "options" | "correctAnswer" | "explanation">): AnswerCheck {
  if (!question.correctAnswer) return null;
  const explanation = question.explanation ?? "";
  const mathematical = /\\(?:log|frac|sqrt|sin|cos|tan)|√|[A-Za-z]\s*\^\s*\d|\b[A-Za-z]\d|(?:\d\s*[%/*^=<>≤≥+\-]\s*(?:\d|[A-Za-z]))/i
    .test(`${question.question}\n${Object.values(question.options).join("\n")}`);
  if (!mathematical) return null;
  if (!explanation.trim()) {
    return { kind: "review", message: "No solution explanation is available for an automatic consistency check. Review the selected answer before saving." };
  }

  const optionAnswer = explanation.match(/\b(?:correct\s+answer|final\s+answer|answer)\s*(?:is|=|:)?\s*(?:option\s*)?([A-E])\b|\boption\s+([A-E])\s+is\s+(?:the\s+)?correct\b/i);
  const declaredLetter = (optionAnswer?.[1] ?? optionAnswer?.[2])?.toUpperCase();
  if (declaredLetter && declaredLetter !== question.correctAnswer) {
    return { kind: "mismatch", message: `The explanation identifies option ${declaredLetter}, but option ${question.correctAnswer} is marked correct.` };
  }

  const numericAnswer = explanation.match(/(?:final\s+answer|answer|therefore|hence|thus|so)\s*(?:is|=|:)?\s*([-+]?\d+(?:\.\d+)?)(?:\s*\.|$|\s)/i);
  if (numericAnswer?.[1]) {
    const calculated = Number(numericAnswer[1]);
    const correctKey = answerOptions.find((letter) => letter === question.correctAnswer) ?? "A";
    const selected = Number(question.options[correctKey]?.replace(/[^\d.\-]/g, ""));
    if (Number.isFinite(calculated) && Number.isFinite(selected) && Math.abs(calculated - selected) > 1e-9) {
      return { kind: "mismatch", message: `The explanation's stated result (${calculated}) does not match option ${question.correctAnswer} (${selected}).` };
    }
    if (Number.isFinite(calculated) && Number.isFinite(selected)) return null;
  }

  if (!declaredLetter) {
    return { kind: "review", message: "The mathematical result could not be verified automatically. Review the solution against the selected option before saving." };
  }
  return null;
}
export default function App() {
  const [exams, setExams] = useState<Exam[]>(() => readLocal("mba-exams", initialExams));
  const [sections, setSections] = useState<Section[]>(() => readLocal("mba-sections", initialSections));
  const [chapters, setChapters] = useState<Chapter[]>(() => readLocal("mba-chapters", initialChapters));
  const [questions, setQuestions] = useState<Question[]>(() => readLocal<Question[]>("mba-questions", initialQuestions)
    .filter((question) => !question.id.startsWith("firestore-"))
    .map((question) => demoAnswerKeys[question.id] ? { ...question, ...demoAnswerKeys[question.id] } : question));
  const [examQuestionsLoading, setExamQuestionsLoading] = useState(false);
  const [examQuestionsError, setExamQuestionsError] = useState("");
  const [questionLoadRevision, setQuestionLoadRevision] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [studentQuizAttempts, setStudentQuizAttempts] = useState<StudentQuizAttempt[]>([]);
  const [reviewingAttemptId, setReviewingAttemptId] = useState<string | null>(null);
  const [adminAttempts, setAdminAttempts] = useState<(Attempt & { userId: string })[]>([]);
  const [questionReports, setQuestionReports] = useState<QuestionReport[]>([]);
  const [questionHistoryRevision, setQuestionHistoryRevision] = useState(0);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(() => readLocal("mba-settings", defaultSettings));
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [darkMode, setDarkMode] = useState(() => readLocal("mba-dark-mode", false));
  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [selectedPlatformExam, setSelectedPlatformExam] = useState<PlatformExam | null>(null);
  const [view, setView] = useState<View>(() => profile?.role === "admin" ? "admin" : "dashboard");
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [result, setResult] = useState<QuizState | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [loginKind, setLoginKind] = useState<LoginPage>("choose");
  const [selectedStudentCategory, setSelectedStudentCategory] = useState<ExamCategory | null>(null);
  const [studentCategoryId, setStudentCategoryId] = useState(() => profile?.role === "student"
    ? localStorage.getItem(`mba-student-category-${profile.uid}`) ?? ""
    : "");
  const [examCategories, setExamCategories] = useState<ExamCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoriesReloadKey, setCategoriesReloadKey] = useState(0);
  const [platformExams, setPlatformExams] = useState<PlatformExam[]>([]);
  const [platformExamsLoading, setPlatformExamsLoading] = useState(false);
  const [platformExamsError, setPlatformExamsError] = useState("");
  const [platformExamsReloadKey, setPlatformExamsReloadKey] = useState(0);
  const [subjectsExamId, setSubjectsExamId] = useState("");
  const [platformSubjects, setPlatformSubjects] = useState<PlatformSubject[]>([]);
  const [platformChapters, setPlatformChapters] = useState<PlatformChapter[]>([]);
  const [platformSubjectsLoading, setPlatformSubjectsLoading] = useState(false);
  const [platformSubjectsError, setPlatformSubjectsError] = useState("");
  const [subjectsReloadKey, setSubjectsReloadKey] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const answerLock = useRef(false);
  const [adminArea, setAdminArea] = useState<AdminArea>("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [editing, setEditing] = useState<{ type: EntityType; item?: Entity; reportId?: string } | null>(null);
  const [reportingQuestion, setReportingQuestion] = useState<Question | null>(null);
  const [bulkClassifications, setBulkClassifications] = useState<Question[] | null>(null);
  const [extractedPapers, setExtractedPapers] = useState<ExtractedPaper[]>(() => {
    const primary = readLocal<ExtractedPaper[]>("mba-extracted-papers-record", []);
    const secondary = readLocal<ExtractedPaper[]>("mba-extracted-papers", []);
    const map = new Map<string, ExtractedPaper>();
    secondary.forEach((p) => map.set(p.id, p));
    primary.forEach((p) => map.set(p.id, p));
    return Array.from(map.values());
  });
  const [activeCbtPaper, setActiveCbtPaper] = useState<{ paper: ExtractedPaper; questions: Question[]; practiceMode?: boolean } | null>(null);
  const isAdmin = profile?.role === "admin" && profile.uid === "local-admin";
  const activeStudentCategory = examCategories.find((category) => category.id === studentCategoryId && category.active);
  const pendingReportCount = questionReports.filter((report) => report.status === "Pending Review").length;

  useEffect(() => {
    const shouldLoadCategories = loginKind === "student-category"
      || (profile?.role === "student")
      || (isAdmin && view === "admin" && (adminArea === "categories" || adminArea === "exams" || adminArea === "subjects"));
    if (!shouldLoadCategories) return;
    let active = true;
    let receivedLiveCategories = false;
    let firstServerSnapshot = true;
    let fetchedCategories: ExamCategory[] | null = null;
    const studentView = loginKind === "student-category" || profile?.role === "student";
    const endpoint = studentView ? "/api/categories" : "/api/admin/categories";
    const unsubscribe = studentView && firestore
      ? onSnapshot(collection(firestore, "examCategories"), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        receivedLiveCategories = snapshot.docs.length > 0;
        if (firstServerSnapshot) {
          firstServerSnapshot = false;
          if (snapshot.empty && fetchedCategories?.length) return;
        }
        const categories = snapshot.docs
          .map((document) => ({ ...document.data(), id: document.id } as ExamCategory))
          .filter((category) => category.active === true)
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || a.name.localeCompare(b.name));
        if (active) {
          setExamCategories(categories);
          setCategoriesError("");
          setCategoriesLoading(false);
        }
      }, (reason) => {
        console.warn("Live exam category updates are unavailable:", reason);
      })
      : undefined;
    setCategoriesLoading(true);
    setCategoriesError("");
    fetch(endpoint, { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json() as { categories?: ExamCategory[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load exam categories.");
        if (!Array.isArray(result.categories)) throw new Error("The category service returned invalid data.");
        fetchedCategories = result.categories;
        if (active) setExamCategories(result.categories);
      })
      .catch((reason: unknown) => {
        if (active && !receivedLiveCategories) setCategoriesError(reason instanceof Error ? reason.message : "Could not load exam categories.");
      })
      .finally(() => {
        if (active) setCategoriesLoading(false);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [adminArea, categoriesReloadKey, isAdmin, loginKind, profile?.role, view]);

  useEffect(() => {
    const isStudentExamList = profile?.role === "student" && Boolean(studentCategoryId);
    const isAdminExamManager = isAdmin && view === "admin" && (adminArea === "exams" || adminArea === "subjects");
    if (!isStudentExamList && !isAdminExamManager) return;
    let active = true;
    let receivedLiveExams = false;
    let firstServerSnapshot = true;
    let fetchedExams: PlatformExam[] | null = null;
    const endpoint = isAdminExamManager
      ? "/api/admin/exams"
      : `/api/exams?categoryId=${encodeURIComponent(studentCategoryId)}`;
    const unsubscribe = isStudentExamList && firestore
      ? onSnapshot(query(collection(firestore, "platformExams"), where("categoryId", "==", studentCategoryId)), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        receivedLiveExams = snapshot.docs.length > 0;
        if (firstServerSnapshot) {
          firstServerSnapshot = false;
          if (snapshot.empty && fetchedExams?.length) return;
        }
        const loaded = snapshot.docs
          .map((document) => ({ ...document.data(), id: document.id } as PlatformExam))
          .filter((exam) => exam.active === true)
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || a.name.localeCompare(b.name));
        if (active) {
          setPlatformExams(loaded);
          setPlatformExamsError("");
          setPlatformExamsLoading(false);
        }
      }, (reason) => {
        console.warn("Live exam updates are unavailable:", reason);
      })
      : undefined;
    setPlatformExamsLoading(true);
    setPlatformExamsError("");
    fetch(endpoint, { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json() as { exams?: PlatformExam[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load exams.");
        if (!Array.isArray(result.exams)) throw new Error("The exam service returned invalid data.");
        fetchedExams = result.exams;
        if (active) setPlatformExams(result.exams);
      })
      .catch((reason: unknown) => {
        if (active && !receivedLiveExams) setPlatformExamsError(reason instanceof Error ? reason.message : "Could not load exams.");
      })
      .finally(() => {
        if (active) setPlatformExamsLoading(false);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [adminArea, isAdmin, platformExamsReloadKey, profile?.role, studentCategoryId, view]);

  useEffect(() => {
    if (!isAdmin || view !== "admin" || adminArea !== "subjects") return;
    if (!platformExams.some((exam) => exam.id === subjectsExamId) && platformExams[0]) setSubjectsExamId(platformExams[0].id);
  }, [adminArea, isAdmin, platformExams, subjectsExamId, view]);

  useEffect(() => {
    if (!isAdmin || view !== "admin" || adminArea !== "subjects" || !subjectsExamId) return;
    let active = true;
    setPlatformSubjectsLoading(true);
    setPlatformSubjectsError("");
    fetch(`/api/admin/subjects?examId=${encodeURIComponent(subjectsExamId)}`, { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json() as { subjects?: PlatformSubject[]; chapters?: PlatformChapter[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load subjects and chapters.");
        if (!Array.isArray(result.subjects) || !Array.isArray(result.chapters)) throw new Error("The subject service returned invalid data.");
        if (active) {
          setPlatformSubjects(result.subjects);
          setPlatformChapters(result.chapters);
          setPlatformSubjectsError("");
        }
      })
      .catch((reason: unknown) => {
        if (active) setPlatformSubjectsError(reason instanceof Error ? reason.message : "Could not load subjects and chapters.");
      })
      .finally(() => { if (active) setPlatformSubjectsLoading(false); });
    return () => { active = false; };
  }, [adminArea, isAdmin, subjectsExamId, subjectsReloadKey, view]);

  useEffect(() => {
    if (!selectedPlatformExam || isAdmin) return;
    let active = true;
    setPlatformSubjectsLoading(true);
    setPlatformSubjectsError("");
    fetch(`/api/exam-subjects?examId=${encodeURIComponent(selectedPlatformExam.id)}`, { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json() as { subjects?: PlatformSubject[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load subjects.");
        if (!Array.isArray(result.subjects)) throw new Error("The subject service returned invalid data.");
        if (active) setPlatformSubjects(result.subjects);
      })
      .catch((reason: unknown) => {
        if (active) setPlatformSubjectsError(reason instanceof Error ? reason.message : "Could not load subjects.");
      })
      .finally(() => { if (active) setPlatformSubjectsLoading(false); });
    return () => { active = false; };
  }, [selectedPlatformExam, isAdmin, subjectsReloadKey]);

  const showError = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError(""), 6000);
  }, []);

  // One-time global cleanup: clear questions from browser storage
  useEffect(() => {
    const WIPE_FLAG = "mba-questions-wiped-all-2026-v1";
    if (!localStorage.getItem(WIPE_FLAG)) {
      localStorage.removeItem("mba-questions");
      localStorage.removeItem("mba-extracted-papers");
      localStorage.removeItem("mba-extracted-papers-record");
      localStorage.setItem(WIPE_FLAG, "true");
      setQuestions([]);
      setExtractedPapers([]);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void fetch("/api/admin/papers", { credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json() as { papers?: ExtractedPaper[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load paper records.");
        if (!Array.isArray(data.papers)) throw new Error("Paper service returned invalid data.");
        if (!active) return;
        const merged = [...data.papers];
        setExtractedPapers(merged);
        localStorage.setItem("mba-extracted-papers", JSON.stringify(merged));
        localStorage.setItem("mba-extracted-papers-record", JSON.stringify(merged));
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Could not load paper records.");
          window.setTimeout(() => setError(""), 6000);
        }
      });
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    let active = true;
    void verifySession().then((session) => {
      if (!active) return;
      if (session) {
        setProfile(session);
        if (session.role === "admin") {
          setView("admin");
          setAdminArea("dashboard");
        } else {
          setStudentCategoryId(localStorage.getItem(`mba-student-category-${session.uid}`) ?? "");
        }
      }
    }).finally(() => { if (active) setSessionLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (profile?.role !== "student") {
      setAttempts([]);
      setStudentQuizAttempts([]);
      setReviewingAttemptId(null);
      return;
    }
    let active = true;
    void fetch("/api/student/attempts", { credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json() as { attempts?: StudentQuizAttempt[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load your quiz history.");
        if (!Array.isArray(data.attempts)) throw new Error("Performance service returned invalid data.");
        if (!active) return;
        setStudentQuizAttempts(data.attempts);
        setAttempts(data.attempts.slice().reverse().flatMap((record) => record.questions
          .filter((question) => question.isAttempted)
          .map((question) => ({
            questionId: question.id,
            examId: record.examId,
            selectedAnswer: question.selectedAnswer,
            isCorrect: question.isCorrect,
            attemptedAt: record.completedAt,
            sessionId: record.id,
          }))));
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not load your quiz history.");
        window.setTimeout(() => setError(""), 6000);
      });
    return () => { active = false; };
  }, [profile?.role, profile?.uid]);

  useEffect(() => {
    if (!isAdmin) {
      setAdminAttempts([]);
      setUserProfiles([]);
      return;
    }
    let active = true;
    Promise.all([listManagedStudents(), listManagedAttempts()])
      .then(([students, adminAttemptRows]) => {
        if (!active) return;
        setUserProfiles(students);
        setAdminAttempts(adminAttemptRows as (Attempt & { userId: string })[]);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Could not load student performance data.");
        window.setTimeout(() => setError(""), 6000);
      });
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    setTypedAnswer("");
  }, [quiz?.questions[quiz.index]?.id]);

  useEffect(() => {
    if (!profile) {
      setQuestionReports([]);
      return;
    }
    const localReports = readLocal<QuestionReport[]>("mba-question-reports", []);
    setQuestionReports(profile.role === "admin"
      ? localReports
      : localReports.filter((report) => report.studentUid === profile.uid));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem("mba-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    document.title = `${settings.title} — Exam Practice`;
  }, [settings.title]);

  useEffect(() => {
    localStorage.setItem("mba-exams", JSON.stringify(exams));
    localStorage.setItem("mba-sections", JSON.stringify(sections));
    localStorage.setItem("mba-chapters", JSON.stringify(chapters));
    const localQuestions = questions.filter((question) => !question.id.startsWith("firestore-"));
    localStorage.setItem("mba-questions", JSON.stringify(localQuestions));
  }, [exams, sections, chapters, questions]);

  useEffect(() => {
    if (!isFirebaseConfigured || !firestore) {
      setExamQuestionsLoading(false);
      return;
    }

    const inAdminMode = isAdmin || view === "admin";
    setExamQuestionsLoading(true);
    setExamQuestionsError("");

    // In admin mode, load all exam questions from Firestore so the admin dashboard and question management have the complete catalog (CAT, CMAT, MAT, XAT).
    // In student mode with selectedExam, query for the selected exam.
    const examQuery = inAdminMode || !selectedExam
      ? query(collection(firestore, "examQuestions"))
      : query(collection(firestore, "examQuestions"), where("exam", "in", [selectedExam.toUpperCase(), selectedExam.toLowerCase()]));

    return onSnapshot(examQuery, (snapshot) => {
      const nextQuestions = snapshot.docs
        .map((document) => {
          const data = document.data();
          const docExamId = String(data.examId || data.exam || selectedExam || "cat").toLowerCase();
          return mapFirestoreQuestion(document.id, data, docExamId, sections, chapters);
        })
        .filter((question) => Boolean(question.question.trim()));

      setQuestions((current) => {
        const nonFirestore = current.filter((q) => !q.id.startsWith("firestore-"));
        const map = new Map<string, Question>();
        nonFirestore.forEach((q) => map.set(q.id, q));
        nextQuestions.forEach((q) => map.set(q.id, q));
        return Array.from(map.values());
      });

      const refreshedById = new Map(nextQuestions.map((question) => [question.id, question]));
      setQuiz((current) => current ? {
        ...current,
        questions: current.questions.map((question) => current.answers[question.id] === undefined
          ? refreshedById.get(question.id) ?? question
          : question),
      } : current);
      setExamQuestionsLoading(false);
      setExamQuestionsError("");
    }, (reason) => {
      console.error("Firestore question listener note:", reason);
      setExamQuestionsLoading(false);
      setExamQuestionsError("Could not load questions. Check your Firebase configuration and Firestore rules.");
    });
  }, [isAdmin, view, selectedExam, sections, chapters, questionLoadRevision]);

  // Bridge approved questions from extracted papers into the question pool
  useEffect(() => {
    const relevantPapers = (isAdmin || view === "admin")
      ? extractedPapers
      : selectedExam
      ? extractedPapers.filter(
          (p) => (p.examId || "").toLowerCase() === selectedExam.toLowerCase() || (p.examName || "").toLowerCase() === selectedExam.toLowerCase()
        )
      : [];
    if (!relevantPapers.length) return;

    const paperQuestions: Question[] = [];
    for (const paper of relevantPapers) {
      if (!Array.isArray(paper.extractedQuestions) || !paper.extractedQuestions.length) continue;

      paper.extractedQuestions.forEach((rawQ: unknown, index: number) => {
        const qObj = rawQ as Record<string, unknown>;
        const isApproved = qObj.status === "approved" || !qObj.status || paper.status === "Completed" || (paper.approvedCount > 0 && index < paper.approvedCount);
        if (isApproved && typeof qObj.question === "string" && qObj.question.trim()) {
          const converted = aiQuestionToAppQuestion(qObj, index, paper, sections, chapters);
          paperQuestions.push(converted);
        }
      });
    }

    if (paperQuestions.length > 0) {
      setQuestions((current) => {
        const existingMap = new Map<string, Question>();
        const paperQMap = new Map<string, string>(); // "paperId_qNum" -> id
        current.forEach((q) => {
          existingMap.set(q.id, q);
          if (q.paperId && q.question_number) {
            paperQMap.set(`${q.paperId}_${q.question_number}`, q.id);
          }
        });

        let changed = false;
        for (const pq of paperQuestions) {
          const matchedId = (pq.paperId && pq.question_number) ? paperQMap.get(`${pq.paperId}_${pq.question_number}`) : undefined;
          const targetId = matchedId || pq.id;
          const existing = existingMap.get(targetId);

          if (existing) {
            if (
              existing.question !== pq.question ||
              JSON.stringify(existing.options) !== JSON.stringify(pq.options) ||
              existing.correctAnswer !== pq.correctAnswer ||
              existing.explanation !== pq.explanation ||
              existing.imageUrl !== pq.imageUrl ||
              existing.hasDiagram !== pq.hasDiagram
            ) {
              const mergedImageUrl = pq.imageUrl || existing.imageUrl;
              const mergedHasDiagram = Boolean(pq.hasDiagram || existing.hasDiagram || mergedImageUrl);
              existingMap.set(targetId, {
                ...existing,
                ...pq,
                id: targetId,
                imageUrl: mergedImageUrl,
                hasDiagram: mergedHasDiagram,
              });
              changed = true;
            }
          } else {
            existingMap.set(pq.id, pq);
            if (pq.paperId && pq.question_number) {
              paperQMap.set(`${pq.paperId}_${pq.question_number}`, pq.id);
            }
            changed = true;
          }
        }
        if (changed) {
          const merged = Array.from(existingMap.values());
          localStorage.setItem("mba-questions", JSON.stringify(merged.filter((q) => !q.id.startsWith("firestore-"))));
          return merged;
        }
        return current;
      });
    }
  }, [isAdmin, view, selectedExam, extractedPapers, sections, chapters]);

  useEffect(() => {
    localStorage.setItem("mba-dark-mode", JSON.stringify(darkMode));
  }, [darkMode]);

  const activeExam = exams.find((exam) => exam.id === selectedExam);
  const examSections = sections.filter((section) => section.examId === selectedExam && !settings.hiddenSectionIds.includes(section.id));
  const examQuestions = questions.filter((question) => {
    if (question.examId !== selectedExam) return false;
    const hasMatchingSection = examSections.some((section) => section.id === question.sectionId);
    if (hasMatchingSection) return true;
    // Fallback: If question belongs to this exam, allow it and attribute to exam
    return !question.sectionId || question.sectionId.startsWith(selectedExam);
  });
  const byId = useMemo(() => new Map(attempts.map((attempt) => [attempt.questionId, attempt])), [attempts]);

  function openExam(id: string) {
    if (settings.hiddenExamIds.includes(id)) {
      showError("This exam is currently unavailable.");
      return;
    }
    setSelectedExam(id);
    setView("dashboard");
    setSectionId(null);
    setQuiz(null);
    setResult(null);
  }
  function browsePlatformExam(id: string) {
    const exam = platformExams.find((item) => item.id === id && item.active);
    if (!exam) {
      showError("This exam is currently unavailable.");
      return;
    }
    setSelectedPlatformExam(exam);
    setSelectedExam(null);
    setPlatformSubjects([]);
    setPlatformSubjectsError("");
    setView("dashboard");
  }
  function returnToExamPicker() {
    setSelectedPlatformExam(null);
    setPlatformSubjects([]);
    setPlatformSubjectsError("");
  }
  function visit(next: View) {
    if (next === "admin" && !isAdmin) {
      showError("Admin access is restricted to authorized accounts.");
      return;
    }
    if (!profile && next !== "dashboard") {
      setAuthOpen(true);
      showError("Sign in or create a student account to continue.");
      return;
    }
    setView(next);
    setQuiz(null);
    setResult(null);
    setMobileMenu(false);
  }
  async function persistAttempt(question: Question, answer: string): Promise<Attempt & { correctAnswer: string; explanation: string }> {
    if (!profile) {
      setAuthOpen(true);
      throw new Error("Sign in to save your answers and progress.");
    }
    const sessionId = quiz?.sessionId ?? makeId("session");
    let attempt: Attempt & { correctAnswer: string; explanation: string };
    if (!question.correctAnswer) throw new Error("This question does not have an answer key yet.");
    attempt = {
      questionId: question.id,
      examId: question.examId,
      selectedAnswer: answer,
      isCorrect: isCorrectAnswer(question, answer),
      attemptedAt: new Date().toISOString(),
      sessionId,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation ?? "",
    };
    return attempt;
  }
  async function saveCompletedQuiz(
    title: string,
    examId: string,
    questionsForAttempt: Question[],
    answers: Record<string, string | null | undefined>,
    totalTimeSeconds: number,
    scoringMode: "practice" | "cbt",
  ) {
    if (!profile || profile.role !== "student") return;
    const response = await fetch("/api/student/attempts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        examId,
        totalTimeSeconds,
        scoringMode,
        questions: questionsForAttempt.map((question) => ({
          id: question.id,
          question: question.question,
          options: question.options,
          selectedAnswer: answers[question.id] ?? "",
          correctAnswer: question.correctAnswer ?? "",
          explanation: question.explanation ?? "",
          answerMode: question.answerMode ?? "choice",
          chapterId: question.chapterId,
          chapterName: chapters.find((chapter) => chapter.id === question.chapterId)?.name ?? question.chapter ?? question.topic ?? "",
          sectionName: sections.find((section) => section.id === question.sectionId)?.name ?? question.subject ?? "",
        })),
      }),
    });
    const data = await response.json() as { attempt?: StudentQuizAttempt; error?: string };
    if (!response.ok) throw new Error(data.error || "Could not save your quiz result.");
    if (!data.attempt) throw new Error("Performance service did not confirm the saved result.");
    setStudentQuizAttempts((current) => [data.attempt!, ...current]);
    setAttempts((current) => [
      ...current,
      ...data.attempt!.questions.filter((question) => question.isAttempted).map((question) => ({
        questionId: question.id,
        examId: data.attempt!.examId,
        selectedAnswer: question.selectedAnswer,
        isCorrect: question.isCorrect,
        attemptedAt: data.attempt!.completedAt,
        sessionId: data.attempt!.id,
      })),
    ]);
  }
  function beginQuiz(pool: Question[], title: string, origin: View) {
    if (!pool.length) {
      showError("There are no questions in this selection yet.");
      return;
    }
    const answerableQuestions = pool.filter((question) => question.correctAnswer || question.hasAnswerKey !== false);
    if (!answerableQuestions.length) {
      showError("These questions do not have an answer key yet and cannot be practiced.");
      return;
    }
    if (answerableQuestions.length !== pool.length) {
      setToast(`${pool.length - answerableQuestions.length} question${pool.length - answerableQuestions.length === 1 ? " has" : "s have"} no answer key yet and ${pool.length - answerableQuestions.length === 1 ? "is" : "are"} not available for practice.`);
      window.setTimeout(() => setToast(""), 3500);
    }
    setQuiz({ questions: answerableQuestions, index: 0, answers: {}, title, origin, sessionId: makeId("session") });
    setResult(null);
    setView(origin);
  }
  async function chooseAnswer(answer: string) {
    if (!quiz) return;
    const question = quiz.questions[quiz.index];
    if (quiz.answers[question.id] !== undefined || answerLock.current) return;
    answerLock.current = true;
    setSavingQuestionId(question.id);
    try {
      const graded = await persistAttempt(question, answer);
      setQuiz((state) => state ? {
        ...state,
        answers: { ...state.answers, [question.id]: answer },
        questions: state.questions.map((entry) => entry.id === question.id
          ? { ...entry, correctAnswer: graded.correctAnswer, explanation: graded.explanation }
          : entry),
      } : state);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not save your answer.");
    } finally {
      answerLock.current = false;
      setSavingQuestionId(null);
    }
  }
  function advance(skip = false) {
    if (!quiz) return;
    const current = quiz.questions[quiz.index];
    const answers = skip && quiz.answers[current.id] === undefined
      ? { ...quiz.answers, [current.id]: null }
      : quiz.answers;
    if (quiz.index < quiz.questions.length - 1) setQuiz({ ...quiz, index: quiz.index + 1, answers });
    else {
      const finished = { ...quiz, answers };
      setQuiz(null);
      setResult(finished);
      void saveCompletedQuiz(
        finished.title,
        finished.questions[0]?.examId ?? selectedExam ?? "",
        finished.questions,
        finished.answers,
        0,
        "practice",
      ).then(() => setToast("Quiz result saved to your performance history."))
        .catch((reason: unknown) => showError(reason instanceof Error ? reason.message : "Could not save your quiz result."));
    }
  }
  function startChapter(section: Section, chapter: Chapter) {
    setSectionId(section.id);
    beginQuiz(questions.filter((question) => question.chapterId === chapter.id), `${section.name} · ${chapter.name}`, "practice");
  }
  function launchCbtMock(paper: ExtractedPaper, paperQuestions: Question[]) {
    if (!paperQuestions.length) {
      showError("No questions found for this paper in the question bank.");
      return;
    }
    setActiveCbtPaper({ paper, questions: paperQuestions });
  }
  function launchChapterQuiz(exam: PlatformExam, subject: PlatformSubject, chapter: PlatformChapter) {
    const quizQuestions = questionsForPlatformChapter(questions, exam, subject, chapter);
    if (!quizQuestions.length) {
      showError(`No complete four-option questions with answer keys are available for ${chapter.name} yet.`);
      return;
    }
    const startedAt = new Date().toISOString();
    const paper: ExtractedPaper = {
      id: `chapter-${chapter.id}-${Date.now()}`,
      fileName: `${exam.name} · ${chapter.name}`,
      paperTitle: `${exam.name} · ${subject.name} · ${chapter.name}`,
      examId: exam.quizExamId || exam.id,
      examName: exam.name,
      year: new Date().getFullYear(),
      slot: chapter.name,
      extractedAt: startedAt,
      extractedBy: profile?.name ?? "Student",
      totalQuestions: quizQuestions.length,
      approvedCount: quizQuestions.length,
      rejectedCount: 0,
      status: "Completed",
    };
    setActiveCbtPaper({ paper, questions: quizQuestions, practiceMode: true });
  }
  function handleSaveCbtAttempt(res: CbtExamResult) {
    if (!profile || profile.role !== "student" || !activeCbtPaper) return;
    const attemptQuestions = activeCbtPaper.questions;
    void saveCompletedQuiz(
      res.paperTitle,
      res.examId,
      attemptQuestions,
      res.answers,
      res.totalTimeSeconds,
      activeCbtPaper.practiceMode ? "practice" : "cbt",
    ).then(() => setToast(`Quiz result saved: ${res.rawScore}/${res.maxScore} marks (${res.accuracy}% accuracy)`))
      .catch((reason: unknown) => showError(reason instanceof Error ? reason.message : "Could not save your quiz result."));
  }
  async function saveEntity(type: EntityType, value: Entity, relatedReportId?: string) {
    if (!isAdmin) {
      setEditing(null);
      showError("Only the authorized admin account can change the question bank.");
      return;
    }
    try {
      if (type === "question") {
        const previous = relatedReportId ? questions.find((entry) => entry.id === value.id) : undefined;
        const question = await persistClassifiedQuestion(value as Question, [...chapters]);
        const savedQuestion = await saveApprovedQuestionToFirestore(question);
        setQuestions((current) => [...current.filter((entry) => entry.id !== savedQuestion.id && entry.id !== question.id), savedQuestion]);
        if (previous && relatedReportId) {
          const history = readLocal<QuestionChange[]>("mba-question-change-history", []);
          history.unshift({
            id: makeId("change"),
            questionId: savedQuestion.id,
            relatedReportId,
            previous: {
              question: previous.question,
              options: previous.options,
              correctAnswer: previous.correctAnswer ?? "A",
              explanation: previous.explanation ?? "",
              topic: previous.topic,
              subTopic: previous.subTopic,
            },
            next: {
              question: question.question,
              options: question.options,
              correctAnswer: question.correctAnswer ?? "A",
              explanation: question.explanation ?? "",
              topic: question.topic,
              subTopic: question.subTopic,
            },
            adminUid: profile?.uid ?? "",
            adminName: profile?.name ?? "Administrator",
            changedAt: new Date().toISOString(),
          });
          localStorage.setItem("mba-question-change-history", JSON.stringify(history));
        }
        if (relatedReportId) setQuestionHistoryRevision((current) => current + 1);
      } else {
        if (type === "exam") setExams((current) => [...current.filter((entry) => entry.id !== value.id), value as Exam]);
        else if (type === "section") setSections((current) => [...current.filter((entry) => entry.id !== value.id), value as Section]);
        else setChapters((current) => [...current.filter((entry) => entry.id !== value.id), value as Chapter]);
      }
      setEditing(null);
      setToast(`${titleCase(type)} saved`);
      window.setTimeout(() => setToast(""), 2500);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not save this item.");
    }
  }
  async function persistClassifiedQuestion(question: Question, knownChapters: Chapter[]): Promise<Question> {
    const currentChapter = knownChapters.find((chapter) => chapter.id === question.chapterId
      && chapter.examId === question.examId && chapter.sectionId === question.sectionId);
    const matchingChapter = currentChapter ?? knownChapters.find((chapter) => chapter.examId === question.examId
      && chapter.sectionId === question.sectionId && chapter.name.trim().toLowerCase() === (question.topic ?? "").trim().toLowerCase());
    let chapter = matchingChapter;
    if (!chapter) {
      if (!question.topic?.trim()) throw new Error("Choose a topic before saving the question.");
      chapter = {
        id: makeId("chapter"),
        examId: question.examId,
        sectionId: question.sectionId,
        name: question.topic.trim(),
      };
      knownChapters.push(chapter);
      setChapters((current) => current.some((entry) => entry.id === chapter?.id) ? current : [...current, chapter as Chapter]);
    }
    const saved = { ...question, chapterId: chapter.id, topic: chapter.name };
    return saved;
  }
  async function addImportedQuestion(question: Question, createChapter: boolean) {
    if (!isAdmin) throw new Error("Only the authorized admin account can import questions.");

    // If chapter needs creation, create chapter first
    if (createChapter) {
      const chapter: Chapter = { id: makeId("chapter"), examId: question.examId, sectionId: question.sectionId, name: (question.topic ?? "Suggested chapter").trim() };
      setChapters((current) => [...current, chapter]);
      question = { ...question, chapterId: chapter.id, topic: chapter.name };
    } else {
      question = await persistClassifiedQuestion(question, [...chapters]);
    }

    const validation = validateQuestionForImport(question);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join("; ")}`);
    }

    const response = await fetch("/api/admin/questions/import", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ ...question, createChapter }]),
    });
    const result = await response.json() as { error?: string; success?: boolean };
    if (!response.ok) throw new Error(result.error || "Could not import question.");
    if (result.success !== true) throw new Error("The question service did not confirm the import.");

    const persistedQuestion = { ...question, id: `firestore-${question.id.replace(/^firestore-/, "")}` };
    setQuestions((current) => {
      const index = current.findIndex((entry) => entry.id === persistedQuestion.id
        || (persistedQuestion.paperId && persistedQuestion.question_number && entry.paperId === persistedQuestion.paperId
          && entry.question_number === persistedQuestion.question_number));
      const updated = [...current];
      if (index >= 0) {
        const existing = updated[index];
        const imageUrl = persistedQuestion.imageUrl || existing.imageUrl;
        updated[index] = {
          ...existing,
          ...persistedQuestion,
          imageUrl,
          hasDiagram: Boolean(persistedQuestion.hasDiagram || existing.hasDiagram || imageUrl),
        };
      } else {
        updated.push(persistedQuestion);
      }
      localStorage.setItem("mba-questions", JSON.stringify(updated.filter((entry) => !entry.id.startsWith("firestore-"))));
      return updated;
    });
    setToast("Question added to the question bank");
    window.setTimeout(() => setToast(""), 2500);
  }

  async function addImportedQuestionsBatch(questionsToImport: Question[]) {
    if (!isAdmin) throw new Error("Only the authorized admin account can import questions.");
    if (!questionsToImport.length) return;

    let updatedChapters = [...chapters];
    let chaptersAdded = false;
    const resolvedQuestions = questionsToImport.map((question) => {
      let chapter = updatedChapters.find((entry) =>
        entry.sectionId === question.sectionId
        && (entry.id === question.chapterId || entry.name.trim().toLowerCase() === (question.topic || "").trim().toLowerCase())
      );
      if (!chapter && question.topic?.trim()) {
        chapter = {
          id: makeId("chapter"),
          examId: question.examId,
          sectionId: question.sectionId,
          name: question.topic.trim(),
        };
        updatedChapters.push(chapter);
        chaptersAdded = true;
      }
      return chapter ? { ...question, chapterId: chapter.id, topic: chapter.name } : question;
    });

    if (chaptersAdded) setChapters(updatedChapters);

    const validQuestions = resolvedQuestions.filter((question) => validateQuestionForImport(question).isValid);
    if (!validQuestions.length) return;

    const response = await fetch("/api/admin/questions/import", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validQuestions),
    });
    const result = await response.json() as { error?: string; success?: boolean };
    if (!response.ok) throw new Error(result.error || "Could not import questions.");
    if (result.success !== true) throw new Error("The question service did not confirm the import.");

    const persistedQuestions = validQuestions.map((question) => ({
      ...question,
      id: `firestore-${question.id.replace(/^firestore-/, "")}`,
    }));
    setQuestions((current) => {
      const byId = new Map(current.map((question) => [question.id, question]));
      const paperQuestionIds = new Map<string, string>();
      current.forEach((question) => {
        if (question.paperId && question.question_number) {
          paperQuestionIds.set(`${question.paperId}_${question.question_number}`, question.id);
        }
      });

      for (const question of persistedQuestions) {
        const matchedId = question.paperId && question.question_number
          ? paperQuestionIds.get(`${question.paperId}_${question.question_number}`)
          : undefined;
        const targetId = matchedId || question.id;
        const existing = byId.get(targetId);
        if (existing) {
          const imageUrl = question.imageUrl || existing.imageUrl;
          byId.set(targetId, {
            ...existing,
            ...question,
            id: targetId,
            imageUrl,
            hasDiagram: Boolean(question.hasDiagram || existing.hasDiagram || imageUrl),
          });
        } else {
          byId.set(targetId, { ...question, id: targetId });
          if (question.paperId && question.question_number) {
            paperQuestionIds.set(`${question.paperId}_${question.question_number}`, targetId);
          }
        }
      }

      const updated = Array.from(byId.values());
      localStorage.setItem("mba-questions", JSON.stringify(updated.filter((question) => !question.id.startsWith("firestore-"))));
      return updated;
    });

    setToast(`Directly uploaded ${validQuestions.length} verified question(s) to the question bank`);
    window.setTimeout(() => setToast(""), 3500);
  }

  async function saveApprovedQuestionToFirestore(question: Question): Promise<Question> {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage questions.");
    const section = sections.find((entry) => entry.id === question.sectionId);
    const cleanId = question.id.startsWith("firestore-") ? question.id.replace("firestore-", "") : question.id;
    const chapter = chapters.find((entry) => entry.id === question.chapterId);
    const response = await fetch("/api/admin/questions", {
      method: question.id.startsWith("firestore-") || question.id.startsWith("import-") ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...question,
        id: cleanId,
        category: section?.name ?? question.topic ?? "",
        subject: section?.name ?? question.subject ?? question.topic ?? "",
        chapter: chapter?.name ?? question.chapter ?? "",
      }),
    });
    const result = await response.json() as { error?: string; question?: Question };
    if (!response.ok) throw new Error(result.error || "Could not save question.");
    if (!result.question) throw new Error("The question service returned invalid data.");
    return { ...question, id: `firestore-${cleanId}` };
  }
  async function submitQuestionReport(question: Question, reason: string, studentExplanation: string, evidence?: File) {
    if (!profile || profile.role !== "student") throw new Error("Sign in with a student account to report a question.");
    const exam = exams.find((item) => item.id === question.examId);
    const section = sections.find((item) => item.id === question.sectionId);
    const chapter = chapters.find((item) => item.id === question.chapterId);
    const reportId = makeId("report");
    let evidenceDataUrl: string | undefined;
    if (evidence) {
      evidenceDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the evidence image."));
        reader.onerror = () => reject(new Error("Could not read the evidence image."));
        reader.readAsDataURL(evidence);
      });
    }
    const report: QuestionReport = {
      id: reportId,
      questionId: question.id,
      questionText: question.question,
      examId: question.examId,
      examName: exam?.name ?? question.examId,
      sectionId: question.sectionId,
      sectionName: section?.name ?? question.sectionId,
      chapterId: question.chapterId,
      chapterName: chapter?.name ?? question.chapterId,
      studentUid: profile.uid,
      studentId: profile.studentId ?? "",
      studentName: profile.name,
      reason: reason.trim(),
      studentExplanation: studentExplanation.trim(),
      evidencePath: "",
      evidenceDataUrl,
      status: "Pending Review",
      adminResponse: "",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const localReports = readLocal<QuestionReport[]>("mba-question-reports", []);
    const next = [...localReports, report];
    localStorage.setItem("mba-question-reports", JSON.stringify(next));
    setQuestionReports((current) => [...current, report]);
    setToast("Report submitted. You can follow its status in My reports.");
    window.setTimeout(() => setToast(""), 5000);
  }
  async function changeQuestionReport(reportId: string, status: QuestionReportStatus, adminResponse: string) {
    if (!isAdmin) throw new Error("Only an authorized admin can review question reports.");
    const updatedAt = new Date().toISOString();
    const next = readLocal<QuestionReport[]>("mba-question-reports", []).map((report) => report.id === reportId
      ? { ...report, status, adminResponse: adminResponse.trim(), updatedAt }
      : report);
    localStorage.setItem("mba-question-reports", JSON.stringify(next));
    setQuestionReports(next);
  }
  async function openQuestionReportEvidence(report: QuestionReport): Promise<string> {
    if (report.evidenceDataUrl) return report.evidenceDataUrl;
    throw new Error("This report has no locally stored evidence image.");
  }
  async function deletePersistedQuestions(questionIds: string[]) {
    const ids = [...new Set(questionIds
      .filter((id) => id.startsWith("firestore-") || id.startsWith("import-"))
      .map((id) => id.replace(/^firestore-/, "")))];
    for (let index = 0; index < ids.length; index += 400) {
      const response = await fetch("/api/admin/questions", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ids.slice(index, index + 400) }),
      });
      const result = await response.json() as { error?: string; deleted?: string[] };
      if (!response.ok) throw new Error(result.error || "Could not delete questions.");
      if (!Array.isArray(result.deleted)) throw new Error("Question service did not confirm the deletion.");
    }
  }
  async function deletePersistedPapers(all: boolean) {
    const response = await fetch("/api/admin/papers", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all }),
    });
    const result = await response.json() as { error?: string; deleted?: string; success?: boolean };
    if (!response.ok) throw new Error(result.error || "Could not delete paper records.");
    if (all ? result.deleted !== "all" : result.success !== true) {
      throw new Error("Paper service did not confirm the deletion.");
    }
  }
  function prepareAutoCategorization(recategorizeAll: boolean) {
    if (!isAdmin) {
      showError("Only an authorized administrator can categorize questions.");
      return;
    }
    const candidates = questions.filter((question) => recategorizeAll || !question.topic || !question.subTopic);
    if (!candidates.length) {
      setToast(recategorizeAll ? "There are no questions to re-categorize." : "All questions already have a sub-topic classification.");
      window.setTimeout(() => setToast(""), 3500);
      return;
    }
    const catalog = { exams, sections, chapters };
    setBulkClassifications(candidates.map((question) => applyClassification(
      question,
      classifyQuestion(`${question.question}\n${Object.values(question.options).join("\n")}\n${question.explanation}`, catalog),
      catalog,
      recategorizeAll,
    )));
  }
  async function saveBulkClassifications(classified: Question[]) {
    if (!isAdmin) throw new Error("Only an authorized administrator can save question classifications.");
    let nextChapters = [...chapters];
    const saved: Question[] = [];
    try {
      for (const question of classified) {
        const result = await persistClassifiedQuestion(question, nextChapters);
        saved.push(await saveApprovedQuestionToFirestore(result));
        const chapter = nextChapters.find((entry) => entry.id === result.chapterId);
        if (chapter && !nextChapters.some((entry) => entry.id === chapter.id)) nextChapters.push(chapter);
      }
    } catch (reason) {
      if (saved.length) setQuestions((current) => [...current.filter((question) => !saved.some((savedQuestion) => savedQuestion.id === question.id)), ...saved]);
      throw new Error(`${reason instanceof Error ? reason.message : "Could not save classifications."}${saved.length ? ` ${saved.length} question(s) were saved before the error.` : ""}`);
    }
    setQuestions((current) => [...current.filter((question) => !saved.some((savedQuestion) => savedQuestion.id === question.id)), ...saved]);
    setBulkClassifications(null);
    setToast(`${saved.length} question classification${saved.length === 1 ? "" : "s"} saved.`);
    window.setTimeout(() => setToast(""), 3500);
  }
  async function deleteEntity(type: EntityType, item: Entity) {
    if (!isAdmin) {
      showError("Only the authorized administrator can delete question-bank content.");
      return;
    }
    if (!window.confirm(`Delete this ${type} permanently? Related content may also be removed.`)) return;
    try {
      if (type === "exam") {
        setQuestions((all) => all.filter((entry) => entry.examId !== item.id));
        setChapters((all) => all.filter((entry) => entry.examId !== item.id));
        setSections((all) => all.filter((entry) => entry.examId !== item.id));
        setExams((all) => all.filter((entry) => entry.id !== item.id));
        if (selectedExam === item.id) setSelectedExam(null);
      } else if (type === "section") {
        setQuestions((all) => all.filter((entry) => entry.sectionId !== item.id));
        setChapters((all) => all.filter((entry) => entry.sectionId !== item.id));
        setSections((all) => all.filter((entry) => entry.id !== item.id));
      } else if (type === "chapter") {
        setQuestions((all) => all.filter((entry) => entry.chapterId !== item.id));
        setChapters((all) => all.filter((entry) => entry.id !== item.id));
      } else {
        await deletePersistedQuestions([item.id]);
        setQuestions((all) => all.filter((entry) => entry.id !== item.id));
      }
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Delete failed.");
    }
  }

  async function handleDeleteSingleQuestion(questionId: string) {
    if (!isAdmin) {
      showError("Only the authorized administrator can delete questions.");
      return;
    }
    try {
      await deletePersistedQuestions([questionId]);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not delete question.");
      return;
    }
    // Also prune from extractedPapers if this question came from an imported paper
    setExtractedPapers((current) => {
      const updated = current.map((p) => {
        if (!Array.isArray(p.extractedQuestions)) return p;
        const filteredQ = p.extractedQuestions.filter((rawQ: unknown, idx: number) => {
          const qObj = rawQ as Record<string, unknown>;
          const qNum = typeof qObj?.questionNumber === "number" ? qObj.questionNumber : (Number(qObj?.question_number) || idx + 1);
          const qId = (typeof qObj?.id === "string" && qObj.id.trim()) ? qObj.id : `paper-${p.id}-q${qNum}`;
          return qId !== questionId && qObj?.id !== questionId;
        });
        return { ...p, extractedQuestions: filteredQ, totalQuestions: filteredQ.length };
      });
      localStorage.setItem("mba-extracted-papers-record", JSON.stringify(updated));
      localStorage.setItem("mba-extracted-papers", JSON.stringify(updated));
      return updated;
    });

    setQuestions((current) => {
      const next = current.filter((q) => q.id !== questionId);
      localStorage.setItem("mba-questions", JSON.stringify(next.filter((q) => !q.id.startsWith("firestore-"))));
      return next;
    });
    setToast("Question deleted successfully");
    window.setTimeout(() => setToast(""), 2500);
  }

  async function handleDeleteBatchQuestions(questionIds: string[]) {
    if (!isAdmin) {
      showError("Only the authorized administrator can delete questions.");
      return;
    }
    if (!questionIds.length) return;
    const idSet = new Set(questionIds);
    try {
      await deletePersistedQuestions(questionIds);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not delete selected questions.");
      return;
    }
    // Also prune from extractedPapers
    setExtractedPapers((current) => {
      const updated = current.map((p) => {
        if (!Array.isArray(p.extractedQuestions)) return p;
        const filteredQ = p.extractedQuestions.filter((rawQ: unknown, idx: number) => {
          const qObj = rawQ as Record<string, unknown>;
          const qNum = typeof qObj?.questionNumber === "number" ? qObj.questionNumber : (Number(qObj?.question_number) || idx + 1);
          const qId = (typeof qObj?.id === "string" && qObj.id.trim()) ? qObj.id : `paper-${p.id}-q${qNum}`;
          return !idSet.has(qId) && !idSet.has(String(qObj?.id));
        });
        return { ...p, extractedQuestions: filteredQ, totalQuestions: filteredQ.length };
      });
      localStorage.setItem("mba-extracted-papers-record", JSON.stringify(updated));
      localStorage.setItem("mba-extracted-papers", JSON.stringify(updated));
      return updated;
    });

    setQuestions((current) => {
      const next = current.filter((q) => !idSet.has(q.id));
      localStorage.setItem("mba-questions", JSON.stringify(next.filter((q) => !q.id.startsWith("firestore-"))));
      return next;
    });
    setToast(`Deleted ${questionIds.length} question(s) successfully`);
    window.setTimeout(() => setToast(""), 3000);
  }

  async function handleDeleteAllQuestionsGlobally() {
    if (!isAdmin) {
      showError("Only the authorized administrator can delete all questions.");
      return;
    }
    try {
      const questionResponse = await fetch("/api/admin/questions", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const questionResult = await questionResponse.json() as { error?: string; deleted?: string };
      if (!questionResponse.ok) throw new Error(questionResult.error || "Could not delete all questions.");
      if (questionResult.deleted !== "all") throw new Error("Question service did not confirm the deletion.");
      await deletePersistedPapers(true);

      localStorage.removeItem("mba-questions");
      localStorage.removeItem("mba-extracted-papers");
      localStorage.removeItem("mba-extracted-papers-record");

      setQuestions([]);
      setExtractedPapers([]);
      setQuiz(null);

      setToast("All questions across all categories and exams have been completely deleted.");
      window.setTimeout(() => setToast(""), 3500);
    } catch (err) {
      console.error("Global questions deletion error:", err);
      showError(err instanceof Error ? err.message : "Failed to delete all questions.");
    }
  }

  async function seedSampleData() {
    if (!isAdmin) {
      showError("Only the authorized admin account can change the question bank.");
      return;
    }
    try {
      const missing = <T extends { id: string }>(known: T[], seed: T[]) => {
        const ids = new Set(known.map((item) => item.id));
        return seed.filter((item) => !ids.has(item.id));
      };
      const toAdd = [
        ...missing(exams, initialExams).map((item) => ({ group: "exams", item })),
        ...missing(sections, initialSections).map((item) => ({ group: "sections", item })),
        ...missing(chapters, initialChapters).map((item) => ({ group: "chapters", item })),
        ...missing(questions, initialQuestions).map((item) => ({ group: "questions", item })),
      ];
      setExams((current) => [...current, ...toAdd.filter((entry) => entry.group === "exams").map((entry) => entry.item as Exam)]);
      setSections((current) => [...current, ...toAdd.filter((entry) => entry.group === "sections").map((entry) => entry.item as Section)]);
      setChapters((current) => [...current, ...toAdd.filter((entry) => entry.group === "chapters").map((entry) => entry.item as Chapter)]);
      setQuestions((current) => [...current, ...toAdd.filter((entry) => entry.group === "questions").map((entry) => {
        const question = entry.item as Question;
        return demoAnswerKeys[question.id] ? { ...question, ...demoAnswerKeys[question.id] } : question;
      })]);
      setToast(toAdd.length ? "Sample content added; existing records were left unchanged." : "Sample bank is already loaded.");
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not add sample data.");
    }
  }
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setAuthBusy(true);
    try {
      const kind = loginKind === "admin" ? "admin" : "student";
      const account = await loginLocalAccount(String(data.get("studentId")), String(data.get("password")), kind);
      if (account.role === "student") {
        if (!selectedStudentCategory?.active) throw new Error("Choose an active exam category before signing in.");
        localStorage.setItem(`mba-student-category-${account.uid}`, selectedStudentCategory.id);
        setStudentCategoryId(selectedStudentCategory.id);
      }
      setProfile(account);
      setSelectedExam(null);
      setSectionId(null);
      setView(account.role === "admin" ? "admin" : "dashboard");
      setAdminArea("dashboard");
      setAuthOpen(false);
      setError("");
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  }
  function chooseLogin(page: LoginPage) {
    setLoginKind(page);
    if (page === "student-category") setSelectedStudentCategory(null);
    setError("");
  }
  function chooseStudentCategory(category: ExamCategory) {
    setSelectedStudentCategory(category);
    setStudentCategoryId(category.id);
    setPlatformExams([]);
    setSelectedExam(null);
    setSectionId(null);
    setView("dashboard");
    if (profile?.role === "student") {
      localStorage.setItem(`mba-student-category-${profile.uid}`, category.id);
      setLoginKind("student");
    } else {
      setLoginKind("student");
    }
    setError("");
  }
  async function registerStudent(input: StudentAccountInput) {
    if (!selectedStudentCategory) throw new Error("Choose an exam category before registering.");
    setAuthBusy(true);
    try {
      const account = await createLocalStudent(input);
      if (account.role !== "student") throw new Error("Student registration cannot create an administrator account.");
      localStorage.setItem(`mba-student-category-${account.uid}`, selectedStudentCategory.id);
      setStudentCategoryId(selectedStudentCategory.id);
      setProfile(account);
      setSessionLoaded(true);
      setSelectedExam(null);
      setSectionId(null);
      setView("dashboard");
      setAdminArea("dashboard");
      setError("");
    } finally {
      setAuthBusy(false);
    }
  }
  async function saveExamCategory(input: Pick<ExamCategory, "name" | "description" | "active">, id?: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage exam categories.");
    const response = await fetch("/api/admin/categories", {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { ...input, id } : input),
    });
    const result = await response.json() as { categories?: ExamCategory[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not save exam category.");
    if (!Array.isArray(result.categories)) throw new Error("The category service returned invalid data.");
    setExamCategories(result.categories);
  }
  async function savePlatformExam(input: Pick<PlatformExam, "categoryId" | "name" | "description" | "active" | "quizExamId">, id?: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage exams.");
    const response = await fetch("/api/admin/exams", {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { ...input, id } : input),
    });
    const result = await response.json() as { exams?: PlatformExam[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not save exam.");
    if (!Array.isArray(result.exams)) throw new Error("The exam service returned invalid data.");
    setPlatformExams(result.exams);
  }
  async function deletePlatformExam(id: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage exams.");
    const response = await fetch(`/api/admin/exams?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const result = await response.json() as { exams?: PlatformExam[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not delete exam.");
    if (!Array.isArray(result.exams)) throw new Error("The exam service returned invalid data.");
    setPlatformExams(result.exams);
    setSubjectsReloadKey((current) => current + 1);
  }
  async function savePlatformSubject(input: Pick<PlatformSubject, "examId" | "name">, id?: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage subjects.");
    const response = await fetch("/api/admin/subjects", {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { ...input, id } : input),
    });
    const result = await response.json() as { subject?: PlatformSubject; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not save subject.");
    if (!result.subject) throw new Error("The subject service returned invalid data.");
    setSubjectsReloadKey((current) => current + 1);
  }
  async function deletePlatformSubject(id: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage subjects.");
    const response = await fetch(`/api/admin/subjects?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    const result = await response.json() as { subjects?: PlatformSubject[]; chapters?: PlatformChapter[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not delete subject.");
    if (!Array.isArray(result.subjects) || !Array.isArray(result.chapters)) throw new Error("The subject service returned invalid data.");
    setPlatformSubjects(result.subjects);
    setPlatformChapters(result.chapters);
  }
  async function savePlatformChapter(input: Pick<PlatformChapter, "subjectId" | "name">, id?: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage chapters.");
    const response = await fetch("/api/admin/chapters", {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { ...input, id } : input),
    });
    const result = await response.json() as { chapter?: PlatformChapter; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not save chapter.");
    if (!result.chapter) throw new Error("The chapter service returned invalid data.");
    setSubjectsReloadKey((current) => current + 1);
  }
  async function deletePlatformChapter(id: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage chapters.");
    const response = await fetch(`/api/admin/chapters?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    const result = await response.json() as { chapters?: PlatformChapter[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not delete chapter.");
    if (!Array.isArray(result.chapters)) throw new Error("The chapter service returned invalid data.");
    setPlatformChapters((current) => current.filter((chapter) => chapter.id !== id));
  }
  async function deleteExamCategory(id: string) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can manage exam categories.");
    const response = await fetch(`/api/admin/categories?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const result = await response.json() as { categories?: ExamCategory[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not delete exam category.");
    if (!Array.isArray(result.categories)) throw new Error("The category service returned invalid data.");
    setExamCategories(result.categories);
  }
  async function createManagedStudent(input: StudentAccountInput) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can create student accounts.");
    const response = await fetch("/api/admin/students", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json() as { student?: UserProfile; error?: string };
    if (!response.ok) throw new Error(result.error || "Could not create student account.");
    if (!result.student) throw new Error("Student service returned invalid data.");
    setUserProfiles((current) => [...current, result.student!]);
    setToast(`Student account ${input.studentId} created.`);
    window.setTimeout(() => setToast(""), 4000);
  }
  async function updateManagedStudent(uid: string, input: StudentAccountInput) {
    if (!isAdmin) throw new Error("Administrator access is required.");
    const updated = await updateLocalStudent(uid, input);
    setUserProfiles((current) => current.map((student) => student.uid === uid ? updated : student));
    setToast("Student account updated.");
    window.setTimeout(() => setToast(""), 3000);
  }
  async function resetManagedStudentPassword(uid: string, password: string) {
    if (!isAdmin) throw new Error("Administrator access is required.");
    await resetLocalStudentPassword(uid, password);
    setToast("Student password reset. The student must sign in again.");
    window.setTimeout(() => setToast(""), 4000);
  }
  async function setManagedStudentDisabled(uid: string, disabled: boolean) {
    if (!isAdmin) throw new Error("Administrator access is required.");
    const updated = await setLocalStudentDisabled(uid, disabled);
    setUserProfiles((current) => current.map((student) => student.uid === uid ? updated : student));
    setToast(disabled ? "Student account disabled." : "Student account enabled.");
    window.setTimeout(() => setToast(""), 3000);
  }
  async function deleteManagedStudent(uid: string) {
    if (!isAdmin) throw new Error("Administrator access is required.");
    await deleteLocalStudent(uid);
    setUserProfiles((current) => current.filter((student) => student.uid !== uid));
    setAdminAttempts((current) => current.filter((attempt) => attempt.userId !== uid));
    setToast("Student account and saved progress deleted.");
    window.setTimeout(() => setToast(""), 4000);
  }
  async function saveSiteSettings(next: SiteSettings) {
    try {
      if (next.logoUrl && new URL(next.logoUrl).protocol !== "https:") {
        throw new Error("Logo URL must use HTTPS.");
      }
      setSettings(next);
      setToast("Website settings saved");
      window.setTimeout(() => setToast(""), 2500);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not save settings.");
    }
  }
  async function signOut() {
    try {
      await logoutAdminSession();
      clearLocalSession();
      setProfile(null);
      setAttempts([]);
      setStudentQuizAttempts([]);
      setReviewingAttemptId(null);
      setSessionLoaded(true);
      setLoginKind("choose");
      setSelectedStudentCategory(null);
      setStudentCategoryId("");
      setPlatformExams([]);
      setView("dashboard");
      setSectionId(null);
      setQuiz(null);
      setResult(null);
      setLoginKind("choose");
      setSelectedExam(null);
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Could not sign out.");
    }
  }
  const currentAttemptStats = (examId: string) => {
    const availableIds = new Set(questions.filter((question) => question.examId === examId).map((question) => question.id));
    const list = [...new Map(attempts
      .filter((item) => item.examId === examId && availableIds.has(item.questionId))
      .map((item) => [item.questionId, item])).values()];
    const correct = list.filter((item) => item.isCorrect).length;
    const total = questions.filter((question) => question.examId === examId).length;
    return { total, attempted: list.length, correct, wrong: list.length - correct, accuracy: percent(correct, list.length), completion: percent(list.length, total) };
  };

  function renderPastPapersSection() {
    if (!activeExam) return null;
    const examCode = activeExam.id.toLowerCase();
    const papers = extractedPapers.filter(
      (p) => (p.examId || "").toLowerCase() === examCode || (p.examName || "").toLowerCase() === examCode
    );

    const examPool = examQuestions.length > 0 ? examQuestions : questions.filter((q) => q.examId === activeExam.id);

    return (
      <section className="past-papers-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow"><Sparkles size={14} /> EXAM SIMULATION</span>
            <h2>Past Year Papers &amp; Full CBT Mock Tests</h2>
            <p>Practice in an authentic Computer-Based Test (TCS iON CAT pattern) environment with sectional timers, question palette, and official marking (+3 / -1).</p>
          </div>
          <span className="soft-badge">{papers.length ? `${papers.length} official papers` : "Full mock available"}</span>
        </div>

        <div className="past-papers-grid">
          {papers.map((paper) => {
            const paperSpecificQuestions = examPool.filter(
              (q) => q.paperId === paper.id || 
                     (q.year === paper.year && String(q.slot || "").toLowerCase() === String(paper.slot || "").toLowerCase()) ||
                     (paper.paperTitle && q.paperTitle && q.paperTitle === paper.paperTitle)
            );
            const finalQuestions = paperSpecificQuestions.length > 0 ? paperSpecificQuestions : examPool.slice(0, paper.totalQuestions || 66);

            return (
              <motion.article
                key={paper.id}
                whileHover={{ y: -3, transition: { duration: 0.16 } }}
                className="past-paper-card"
              >
                <div>
                  <div className="past-paper-card-top">
                    <span className="past-paper-exam-badge">{paper.examName || activeExam.name} CBT PATTERN</span>
                    <span className="soft-badge">{paper.year} · {paper.slot}</span>
                  </div>
                  <h3>{paper.paperTitle || `${paper.examName} ${paper.year} ${paper.slot}`}</h3>
                  <p>Authentic past question paper with step-by-step solutions, marking, and full scorecard.</p>
                  <div className="past-paper-stats-row">
                    <span><FileText size={14} /> {finalQuestions.length || paper.totalQuestions} Questions</span>
                    <span><Clock3 size={14} /> {finalQuestions.length > 30 ? "120" : "40"} mins</span>
                    <span><Target size={14} /> +3 / -1 marks</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button button-primary past-paper-cbt-btn"
                  onClick={() => launchCbtMock(paper, finalQuestions)}
                >
                  <Zap size={15} /> Launch CBT Mock Test
                </button>
              </motion.article>
            );
          })}

          <motion.article
            whileHover={{ y: -3, transition: { duration: 0.16 } }}
            className="past-paper-card"
            style={{ borderStyle: "dashed" }}
          >
            <div>
              <div className="past-paper-card-top">
                <span className="past-paper-exam-badge" style={{ background: "#fef3c7", color: "#b45309", borderColor: "#fde68a" }}>
                  ALL SECTIONS
                </span>
                <span className="soft-badge">Adaptive Simulation</span>
              </div>
              <h3>{activeExam.name} Full-Length CBT Mock Test</h3>
              <p>Timed full-length exam simulation generated from the comprehensive {activeExam.name} question bank.</p>
              <div className="past-paper-stats-row">
                <span><FileText size={14} /> {Math.min(examPool.length, 66)} Questions</span>
                <span><Clock3 size={14} /> 120 mins</span>
                <span><Target size={14} /> +3 / -1 marks</span>
              </div>
            </div>
            <button
              type="button"
              className="button button-primary past-paper-cbt-btn"
              style={{ background: "#7c3aed" }}
              disabled={examPool.length === 0}
              onClick={() => {
                const fullMockPaper: ExtractedPaper = {
                  id: `adaptive-mock-${activeExam.id}`,
                  fileName: `${activeExam.name} Full-Length Mock`,
                  paperTitle: `${activeExam.name} Full-Length All-Sections CBT Mock`,
                  examId: activeExam.id,
                  examName: activeExam.name,
                  year: new Date().getFullYear(),
                  slot: "All Sections",
                  extractedAt: new Date().toISOString(),
                  extractedBy: "System",
                  totalQuestions: Math.min(examPool.length, 66),
                  approvedCount: Math.min(examPool.length, 66),
                  rejectedCount: 0,
                  status: "Completed",
                };
                launchCbtMock(fullMockPaper, examPool.slice(0, 66));
              }}
            >
              <Zap size={15} /> Start {activeExam.name} Full Mock Test
            </button>
          </motion.article>
        </div>
      </section>
    );
  }

  function renderDashboard() {
    if (!activeExam) return null;
    const stats = currentAttemptStats(activeExam.id);
    return (
      <PageTransition className="page-stack">
        <section className={`hero hero-${activeExam.color}`}>
          <div>
            <span className="eyebrow"><Sparkles size={14} /> YOUR PREPARATION SPACE</span>
            <h1>{activeExam.name} Preparation</h1>
            <p>{settings.welcomeMessage}</p>
            <button className="button button-light" onClick={() => visit("random")}>
              <Zap size={16} /> Start a quick quiz <ArrowRight size={16} />
            </button>
          </div>
          <div className="hero-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="hero-icon"><GraduationCap size={78} strokeWidth={1.3} /></div>
            <span className="art-star">✦</span>
            <span className="art-dot" />
          </div>
        </section>

        <section className="stat-grid">
          <StatCard icon={<BookOpen />} label="Question bank" value={stats.total} caption="questions available" tone="purple" />
          <StatCard icon={<ClipboardList />} label="Attempted" value={stats.attempted} caption={`${stats.completion}% of question bank`} tone="blue" />
          <StatCard icon={<Check />} label="Correct answers" value={stats.correct} caption={`${stats.wrong} incorrect`} tone="green" />
          <StatCard icon={<Target />} label="Accuracy" value={`${stats.accuracy}%`} caption="on attempted questions" tone="orange" />
        </section>

        {renderPastPapersSection()}

        <section className="section-heading">
          <div>
            <h2>Choose a section</h2>
            <p>Pick a subject to explore its chapters and practice.</p>
          </div>
          <span className="soft-badge">{examSections.length} sections</span>
        </section>

        {examQuestionsLoading && (
          <div className="loading-state" role="status">
            <div className="spinner" /> Loading {activeExam.name} questions from Firebase…
          </div>
        )}
        {!!examQuestionsError && (
          <div className="empty-state">
            <div><CircleHelp size={26} /></div>
            <p>{examQuestionsError}</p>
            <button className="button button-outline" onClick={() => setQuestionLoadRevision((revision) => revision + 1)}>Retry loading</button>
          </div>
        )}
        {!examQuestionsLoading && !examQuestionsError && ["cat", "cmat", "xat"].includes(activeExam.id) && examQuestions.length === 0 && (
          <EmptyState text={`No ${activeExam.name} questions were found in the Firestore examQuestions collection yet.`} />
        )}

        {(!["cat", "cmat", "xat"].includes(activeExam.id) || (!examQuestionsLoading && !examQuestionsError && examQuestions.length > 0)) && (
          <section className="section-grid">
            {examSections.map((section, index) => {
              const list = examQuestions.filter((question) => question.sectionId === section.id);
              const done = list.filter((question) => byId.has(question.id)).length;
              const progress = percent(done, list.length);
              const chapterCount = chapters.filter((chapter) => chapter.sectionId === section.id).length;
              return (
                <motion.button
                  key={section.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: index * 0.05 }}
                  whileHover={{ y: -3, transition: { duration: 0.15 } }}
                  whileTap={{ scale: 0.99 }}
                  className="section-card text-left"
                  onClick={() => setSectionId(section.id)}
                >
                  <div className={`section-icon section-icon-${index % 4}`}><SectionIcon index={index} /></div>
                  <div className="section-card-content">
                    <span className="section-count">SECTION {String(index + 1).padStart(2, "0")}</span>
                    <h3>{section.name}</h3>
                    <p>{chapterCount} chapters <span>·</span> {list.length} {list.length === 1 ? "question" : "questions"}</p>
                  </div>
                  <ArrowRight className="section-arrow" size={18} />
                  <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>
                  <div className="section-progress"><span>Section progress</span><b>{progress}%</b></div>
                </motion.button>
              );
            })}
          </section>
        )}

        {search.trim() && (
          <section className="search-results-panel">
            <div className="section-heading">
              <div>
                <h2>Question search</h2>
                <p>Matching questions in {activeExam.name}.</p>
              </div>
              <span className="soft-badge">
                {examQuestions.filter((question) => question.question.toLowerCase().includes(search.trim().toLowerCase())).length} matches
              </span>
            </div>
            <div className="status-list">
              {examQuestions
                .filter((question) => question.question.toLowerCase().includes(search.trim().toLowerCase()))
                .map((question) => (
                  <button
                    className="search-result-row"
                    key={question.id}
                    onClick={() => {
                      setSectionId(question.sectionId);
                      beginQuiz([question], `${activeExam.name} · Search practice`, "practice");
                    }}
                  >
                    <div>
                      <b><MathContent text={question.question} /></b>
                      <small>{sections.find((item) => item.id === question.sectionId)?.name} · {chapters.find((item) => item.id === question.chapterId)?.name}</small>
                    </div>
                    <ArrowRight size={16} />
                  </button>
                ))}
            </div>
          </section>
        )}

        <section className="tip-banner">
          <div className="tip-icon"><Sparkles size={18} /></div>
          <div>
            <b>Small steps add up.</b>
            <p>Practice a few questions daily to build a consistent preparation habit.</p>
          </div>
          <button className="text-button" onClick={() => visit("progress")}>
            View my progress <ArrowRight size={15} />
          </button>
        </section>
      </PageTransition>
    );
  }

  function renderSectionPicker() {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return renderDashboard();
    const chapterRows = chapters.filter((chapter) => chapter.sectionId === section.id);
    return (
      <PageTransition className="page-stack">
        <button className="back-link" onClick={() => setSectionId(null)}>
          <ArrowLeft size={16} /> Back to {activeExam?.name} dashboard
        </button>
        <section className="section-heading page-title">
          <div>
            <span className="eyebrow">SECTION</span>
            <h1>{section.name}</h1>
            <p>Choose a chapter to begin practicing.</p>
          </div>
        </section>
        <div className="chapter-grid">
          {chapterRows.map((chapter, index) => {
            const pool = questions.filter((question) => question.chapterId === chapter.id);
            const attempted = pool.filter((question) => byId.has(question.id)).length;
            return (
              <motion.article
                className="chapter-card"
                key={chapter.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: index * 0.04 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
              >
                <div className="chapter-top">
                  <div className={`chapter-icon chapter-icon-${index % 4}`}><BookOpen size={20} /></div>
                  <span className="soft-badge">{pool.length} {pool.length === 1 ? "question" : "questions"}</span>
                </div>
                <h3>{chapter.name}</h3>
                <p>{attempted} of {pool.length} attempted · {percent(attempted, pool.length)}% complete</p>
                <div className="progress-track"><span style={{ width: `${percent(attempted, pool.length)}%` }} /></div>
                <button className="button button-primary button-full" onClick={() => startChapter(section, chapter)}>
                  Start practice <ArrowRight size={16} />
                </button>
              </motion.article>
            );
          })}
          {!chapterRows.length && <EmptyState text="No chapters have been added for this section yet." />}
        </div>
      </PageTransition>
    );
  }

  function renderQuiz() {
    if (result) return <QuizResult result={result} backLabel={result.origin === "practice" ? "Back to chapter" : "Back to exam dashboard"} onAgain={() => beginQuiz(result.questions, result.title, result.origin)} onWrong={() => {
      const wrongIds = new Set(result.questions.filter((question) => result.answers[question.id] !== null && result.answers[question.id] !== undefined && !isCorrectAnswer(question, result.answers[question.id] ?? "")).map((question) => question.id));
      beginQuiz(result.questions.filter((question) => wrongIds.has(question.id)), "Review incorrect answers", "wrong");
    }} onDashboard={() => { setResult(null); setView("dashboard"); setSectionId(null); }} onBack={() => { setResult(null); setView("dashboard"); if (result.origin !== "practice") setSectionId(null); }} />;
    if (!quiz) return null;
    const q = quiz.questions[quiz.index];
    const selected = quiz.answers[q.id];
    const answered = selected !== undefined && selected !== null;
    const answeredCorrectly = answered && isCorrectAnswer(q, selected ?? "");
    const countDone = Object.keys(quiz.answers).length;
    const section = sections.find((item) => item.id === q.sectionId);
    return <div className="quiz-layout">
      <div className="quiz-topline">
        <button className="back-link" onClick={() => { setQuiz(null); setView("dashboard"); }}>
          <ArrowLeft size={16} /> Exit practice
        </button>
        <span className="flex items-center gap-1.5"><Clock3 size={15} /> {quiz.title}</span>
      </div>
      <div className="quiz-progress">
        <div>
          <span>QUESTION {quiz.index + 1} <i>of {quiz.questions.length}</i></span>
          <b>{percent(quiz.index + 1, quiz.questions.length)}%</b>
        </div>
        <div className="progress-track">
          <motion.span
            initial={{ width: 0 }}
            animate={{ width: `${percent(quiz.index + 1, quiz.questions.length)}%` }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        </div>
      </div>
      <motion.article
        key={q.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="question-card"
      >
        <div className="question-meta">
          <span className="soft-badge">{activeExam?.name ?? exams.find((exam) => exam.id === q.examId)?.name} · {section?.name}</span>
          <span className={`difficulty difficulty-${q.difficulty.toLowerCase()}`}>{q.difficulty}</span>
        </div>
        <p className="question-number">Question {quiz.index + 1}</p>
        <div className="quiz-question-stem"><MathContent text={q.question} /></div>
        {q.imageUrl && <QuestionGraphViewer imageUrl={q.imageUrl} alt={q.imageAlt || `Question ${quiz.index + 1} Diagram`} />}
        {q.answerMode === "text" ? <div className="text-answer-entry">
          <label htmlFor="typed-answer">Your answer</label>
          <div>
            <input
              id="typed-answer"
              value={typedAnswer}
              onChange={(event) => setTypedAnswer(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && typedAnswer.trim() && !answered) void chooseAnswer(typedAnswer); }}
              disabled={answered || savingQuestionId === q.id}
              placeholder="Type your numerical or text answer"
            />
            {!answered && <button className="button button-primary" disabled={!typedAnswer.trim() || savingQuestionId === q.id} onClick={() => void chooseAnswer(typedAnswer)}>Submit answer <ArrowRight size={16} /></button>}
          </div>
        </div> : <div className="answer-list">{getQuestionOptionKeys(q).map((key) => {
          const isCorrect = key === q.correctAnswer;
          const isSelected = key === selected;
          const stateClass = answered && isCorrect ? "answer-correct" : answered && isSelected ? "answer-wrong" : "";
          const pending = savingQuestionId === q.id;
          return (
            <motion.button
              key={key}
              whileHover={!answered && !pending ? { y: -2, transition: { duration: 0.12 } } : undefined}
              whileTap={!answered && !pending ? { scale: 0.99 } : undefined}
              className={`answer-option group ${stateClass} ${answered || pending ? "answer-disabled" : ""}`}
              disabled={answered || pending}
              onClick={() => void chooseAnswer(key)}
            >
              <span className="answer-letter">{answered && isCorrect ? <Check size={17} /> : key}</span>
              <span><MathContent text={q.options[key] ?? ""} /></span>
              {answered && isCorrect && <span className="answer-mark">Correct answer</span>}
              {answered && isSelected && !isCorrect && <span className="answer-mark">Your answer</span>}
            </motion.button>
          );
        })}</div>}
        {answered && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 8 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className={`feedback ${answeredCorrectly ? "feedback-correct" : "feedback-wrong"}`}
          >
            <b>{answeredCorrectly ? "✓  Correct answer!" : "✕  Not quite — that's incorrect."}</b>
            <p><strong>Correct answer: {q.correctAnswer}</strong></p>
            {q.explanation && <MathContent className="solution-content" text={q.explanation} />}
          </motion.div>
        )}
        <div className="quiz-controls">
          {!answered && <button className="text-button skip-button" disabled={savingQuestionId === q.id} onClick={() => advance(true)}>Skip question</button>}
          <button className="button button-primary next-button" disabled={!answered && countDone <= quiz.index} onClick={() => advance()}>{quiz.index === quiz.questions.length - 1 ? "See results" : "Next question"} <ArrowRight size={16} /></button>
        </div>
        {profile?.role === "student" && <button className="report-question-trigger" onClick={() => setReportingQuestion(q)}><Flag size={16} /> ⚠️ Report / Challenge Question</button>}
      </motion.article>
      <p className="quiz-footnote"><ShieldCheck size={15} /> {savingQuestionId === q.id ? "Checking your answer…" : "Your completed quiz result will be saved to your secure performance history."}</p>
    </div>;
  }

  function renderRandom() {
    return <RandomSetup exams={exams.filter((exam) => !settings.hiddenExamIds.includes(exam.id))} currentExam={selectedExam ?? exams.find((exam) => !settings.hiddenExamIds.includes(exam.id))?.id ?? ""} sections={sections.filter((section) => !settings.hiddenSectionIds.includes(section.id))} questions={questions} onBack={() => { setSectionId(null); visit("dashboard"); }} onStart={async (examId, section, count) => {
      setSelectedExam(examId);
      let questionPool = questions;
      if (["cat", "cmat", "xat"].includes(examId)) {
        setExamQuestionsLoading(true);
        try {
          const remoteQuestions = await fetchFirestoreExamQuestions(examId, sections, chapters);
          setQuestions((current) => [...current.filter((question) => question.examId !== examId), ...remoteQuestions]);
          questionPool = [...questions.filter((question) => question.examId !== examId), ...remoteQuestions];
          setExamQuestionsError("");
        } catch (reason) {
          showError(reason instanceof Error ? reason.message : `Could not load ${examId.toUpperCase()} questions.`);
          setExamQuestionsLoading(false);
          return;
        }
        setExamQuestionsLoading(false);
      }
      const available = questionPool.filter((question) => question.examId === examId && (!section || question.sectionId === section));
      const shuffled = [...available];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setSectionId(null);
      beginQuiz(shuffled.slice(0, count), `${exams.find((exam) => exam.id === examId)?.name} · Random quiz`, "random");
    }} />;
  }

  function renderWrong() {
    const wrong = questions.filter((question) => question.examId === selectedExam && byId.get(question.id)?.isCorrect === false);
    const matching = wrong.filter((question) => question.question.toLowerCase().includes(search.toLowerCase()));
    return (
      <PageTransition className="page-stack">
        <section className="section-heading page-title">
          <div>
            <span className="eyebrow"><Target size={14} /> TARGETED PRACTICE</span>
            <h1>Practice wrong questions</h1>
            <p>Review your {activeExam?.name} questions that need another look to achieve mastery.</p>
          </div>
          <span className="soft-badge">{wrong.length} to revisit</span>
        </section>
        {!matching.length ? (
          <EmptyState icon={<Target size={26} />} text={wrong.length ? "No questions match your search." : "No incorrect answers yet! Keep practicing and any misses will show up here."} />
        ) : (
          <>
            <SearchBox value={search} onChange={setSearch} placeholder="Search your incorrect questions…" />
            <div className="wrong-list">
              {matching.map((question, index) => (
                <motion.article
                  className="wrong-row"
                  key={question.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                >
                  <div className="wrong-index">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <h3><MathContent text={question.question} /></h3>
                    <p>{sections.find((item) => item.id === question.sectionId)?.name} · {chapters.find((item) => item.id === question.chapterId)?.name}</p>
                  </div>
                  <span className="status-pill status-wrong">Wrong</span>
                </motion.article>
              ))}
            </div>
            <button className="button button-primary" onClick={() => beginQuiz(matching, `${activeExam?.name} · Wrong questions`, "wrong")}>
              <Target size={16} /> Practice these questions
            </button>
          </>
        )}
      </PageTransition>
    );
  }

  function renderProgress() {
    const statusQuestions = questions
      .filter((question) => !selectedExam || question.examId === selectedExam)
      .filter((question) => question.question.toLowerCase().includes(search.toLowerCase()));
    const totalAttempted = studentQuizAttempts.reduce((total, attempt) => total + attempt.attempted, 0);
    const totalCorrect = studentQuizAttempts.reduce((total, attempt) => total + attempt.correct, 0);
    const totalIncorrect = studentQuizAttempts.reduce((total, attempt) => total + attempt.incorrect, 0);
    const chapterStats = new Map<string, { label: string; attempted: number; correct: number }>();
    studentQuizAttempts.forEach((attempt) => attempt.questions.forEach((question) => {
      if (!question.isAttempted) return;
      const chapterName = question.chapterName || question.sectionName || "General";
      const chapterKey = `${attempt.examId}:${question.sectionName}:${chapterName}`;
      const label = [exams.find((exam) => exam.id === attempt.examId)?.name ?? attempt.examId.toUpperCase(), question.sectionName, chapterName]
        .filter(Boolean)
        .join(" · ");
      const current = chapterStats.get(chapterKey) ?? { label, attempted: 0, correct: 0 };
      current.attempted += 1;
      if (question.isCorrect) current.correct += 1;
      chapterStats.set(chapterKey, current);
    }));
    const reviewingAttempt = studentQuizAttempts.find((attempt) => attempt.id === reviewingAttemptId);
    return (
      <PageTransition className="page-stack">
        <section className="section-heading page-title">
          <div>
            <span className="eyebrow"><Activity size={14} /> YOUR LEARNING JOURNEY</span>
            <h1>My progress &amp; analytics</h1>
            <p>Your preparation and performance metrics stay separate for every exam.</p>
          </div>
        </section>
        {!profile && (
          <div className="notice">
            <UserRound size={18} /> Sign in to view your secure performance history.{" "}
            <button className="text-button" onClick={() => setAuthOpen(true)}>Sign in</button>
          </div>
        )}
        {profile?.role === "student" && <>
          <section className="stat-grid">
            <StatCard icon={<ClipboardList />} label="Completed quizzes" value={studentQuizAttempts.length} caption="saved to your account" tone="purple" />
            <StatCard icon={<BookOpen />} label="Questions attempted" value={totalAttempted} caption={`${totalCorrect} correct`} tone="blue" />
            <StatCard icon={<Check />} label="Correct answers" value={totalCorrect} caption={`${totalIncorrect} incorrect`} tone="green" />
            <StatCard icon={<Target />} label="Overall accuracy" value={`${percent(totalCorrect, totalAttempted)}%`} caption="across completed quizzes" tone="orange" />
          </section>
          <section className="status-panel">
            <div className="section-heading"><div><h2>Chapter-wise performance</h2><p>Results are calculated from completed quizzes on your account.</p></div></div>
            <div className="mini-section-list">
              {[...chapterStats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([chapter, stats]) => (
                <div key={chapter}>
                  <div><span>{stats.label}</span><b>{percent(stats.correct, stats.attempted)}% · {stats.correct}/{stats.attempted}</b></div>
                  <div className="progress-track"><span style={{ width: `${percent(stats.correct, stats.attempted)}%` }} /></div>
                </div>
              ))}
              {!chapterStats.size && <p className="status-empty">Complete a quiz to see chapter performance.</p>}
            </div>
          </section>
          <section className="status-panel">
            <div className="section-heading"><div><h2>Previous quiz results</h2><p>Review your score and every answer from a completed attempt.</p></div><span className="soft-badge">{studentQuizAttempts.length} attempts</span></div>
            <div className="student-attempt-list">
              {studentQuizAttempts.map((attempt) => (
                <article className="student-attempt-card" key={attempt.id}>
                  <div>
                    <span className="eyebrow">{exams.find((exam) => exam.id === attempt.examId)?.name ?? attempt.examId.toUpperCase()}</span>
                    <h3>{attempt.title}</h3>
                    <p>{dateText(attempt.completedAt)} · {attempt.totalQuestions} questions · {Math.floor(attempt.totalTimeSeconds / 60)}m {attempt.totalTimeSeconds % 60}s</p>
                  </div>
                  <div className="student-attempt-score">
                    <b>{attempt.rawScore}/{attempt.maxScore}</b>
                    <small>{attempt.accuracy}% accuracy · {attempt.correct} correct · {attempt.incorrect} incorrect</small>
                  </div>
                  <button className="button button-outline" type="button" onClick={() => setReviewingAttemptId((current) => current === attempt.id ? null : attempt.id)}>
                    {reviewingAttempt?.id === attempt.id ? "Close review" : "Review answers"}
                  </button>
                </article>
              ))}
              {!studentQuizAttempts.length && <p className="status-empty">Your completed quiz results will appear here.</p>}
            </div>
          </section>
          {reviewingAttempt && <section className="result-review">
            <div className="section-heading"><div><h2>{reviewingAttempt.title} · Answer review</h2><p>{dateText(reviewingAttempt.completedAt)} · {reviewingAttempt.rawScore}/{reviewingAttempt.maxScore} points</p></div></div>
            {reviewingAttempt.questions.map((question, index) => (
              <article className="student-attempt-question" key={`${reviewingAttempt.id}-${question.id}`}>
                <div className="student-attempt-question-heading">
                  <b>Question {index + 1}</b>
                  <span className={`status-pill ${!question.isAttempted ? "status-not-attempted" : question.isCorrect ? "status-correct" : "status-wrong"}`}>
                    {!question.isAttempted ? "Unattempted" : question.isCorrect ? "Correct" : "Incorrect"}
                  </span>
                </div>
                <p><MathContent text={question.question} /></p>
                {question.sectionName && <small>{question.sectionName}{question.chapterName ? ` · ${question.chapterName}` : ""}</small>}
                <div className="student-attempt-answer">
                  <span>Your answer: <b>{question.selectedAnswer || "Not answered"}</b></span>
                  <span>Correct answer: <b>{question.correctAnswer}</b></span>
                </div>
                {question.explanation && <p className="student-attempt-explanation"><b>Explanation:</b> <MathContent text={question.explanation} /></p>}
              </article>
            ))}
          </section>}
        </>}
        <div className="progress-exams">
          {exams.map((exam, index) => {
            const stats = currentAttemptStats(exam.id);
            const sectionsHere = sections.filter((section) => section.examId === exam.id);
            return (
              <motion.article
                className="exam-progress-card"
                key={exam.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: index * 0.06 }}
                whileHover={{ y: -3, transition: { duration: 0.15 } }}
              >
                <div className="exam-progress-top">
                  <div className={`mini-exam-icon mini-${exam.color}`}>{exam.name.slice(0, 1)}</div>
                  <div>
                    <h2>{exam.name}</h2>
                    <p>{exam.tagline}</p>
                  </div>
                  <button className="text-button" onClick={() => openExam(exam.id)}>
                    Open exam <ArrowRight size={15} />
                  </button>
                </div>
                <div className="progress-stat-row">
                  <MiniStat label="Question bank" value={stats.total} />
                  <MiniStat label="Attempted" value={stats.attempted} />
                  <MiniStat label="Correct" value={stats.correct} />
                  <MiniStat label="Wrong" value={stats.wrong} />
                  <MiniStat label="Accuracy" value={`${stats.accuracy}%`} />
                </div>
                <div className="overall-progress">
                  <div><span>Completion</span><b>{stats.completion}%</b></div>
                  <div className="progress-track"><span style={{ width: `${stats.completion}%` }} /></div>
                </div>
                <div className="mini-section-list">
                  {sectionsHere.map((section) => {
                    const qlist = questions.filter((question) => question.sectionId === section.id);
                    const done = qlist.filter((question) => byId.has(question.id)).length;
                    return (
                      <div key={section.id}>
                        <div><span>{section.name}</span><b>{percent(done, qlist.length)}%</b></div>
                        <div className="progress-track"><span style={{ width: `${percent(done, qlist.length)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              </motion.article>
            );
          })}
        </div>
        <section className="status-panel">
          <div className="section-heading">
            <div>
              <h2>Question status</h2>
              <p>{selectedExam ? `${activeExam?.name} questions` : "Status is listed separately within each exam."}</p>
            </div>
            <span className="soft-badge">{statusQuestions.length} {statusQuestions.length === 1 ? "question" : "questions"}</span>
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Search questions…" />
          <div className="status-list">
            {statusQuestions.map((question) => {
              const attempt = byId.get(question.id);
              const status = !attempt ? "Not attempted" : attempt.isCorrect ? "Correct" : "Wrong";
              return (
                <div className="status-row" key={question.id}>
                  <div>
                    <span className="status-exam">{exams.find((exam) => exam.id === question.examId)?.name}</span>
                    <b><MathContent text={question.question} /></b>
                    <small>{sections.find((section) => section.id === question.sectionId)?.name} · {chapters.find((chapter) => chapter.id === question.chapterId)?.name}</small>
                  </div>
                  <span className={`status-pill ${status === "Wrong" ? "status-wrong" : status === "Correct" ? "status-correct" : "status-not-attempted"}`}>
                    {status}
                  </span>
                </div>
              );
            })}
            {!statusQuestions.length && <p className="status-empty">No questions match your search.</p>}
          </div>
        </section>
      </PageTransition>
    );
  }

  function renderAdmin() {
    if (!isAdmin) return null;
    const students = userProfiles.filter((user) => user.role === "student");
    if (adminArea === "ai-import") return <AiPdfImport exams={exams} sections={sections} chapters={chapters} questions={questions} importedBy={profile?.name ?? "Administrator"} onApprove={addImportedQuestion} onApproveBatch={addImportedQuestionsBatch} />;
    if (adminArea === "api-keys") return <div className="page-stack admin-page"><ApiKeyManager /></div>;
    if (adminArea === "settings") return <SettingsPanel settings={settings} exams={exams} sections={sections} onSave={(value) => void saveSiteSettings(value)} />;
    if (adminArea === "categories") return <AdminCategoriesPanel
      categories={examCategories}
      loading={categoriesLoading}
      error={categoriesError}
      onRetry={() => setCategoriesReloadKey((current) => current + 1)}
      onSave={saveExamCategory}
      onDelete={deleteExamCategory}
    />;
    if (adminArea === "exams") return <AdminExamsPanel
      categories={examCategories}
      exams={platformExams}
      quizExams={exams}
      loading={platformExamsLoading}
      error={platformExamsError}
      onRetry={() => setPlatformExamsReloadKey((current) => current + 1)}
      onSave={savePlatformExam}
      onDelete={deletePlatformExam}
    />;
    if (adminArea === "subjects") return <AdminSubjectsPanel
      exams={platformExams}
      selectedExamId={subjectsExamId}
      onSelectExam={setSubjectsExamId}
      subjects={platformSubjects}
      chapters={platformChapters}
      loading={platformSubjectsLoading}
      error={platformSubjectsError}
      onRetry={() => setSubjectsReloadKey((current) => current + 1)}
      onSaveSubject={savePlatformSubject}
      onDeleteSubject={deletePlatformSubject}
      onSaveChapter={savePlatformChapter}
      onDeleteChapter={deletePlatformChapter}
    />;
    if (adminArea === "reports") return <QuestionReportsPanel
      reports={questionReports} questions={questions}
      isAdmin historyRevision={questionHistoryRevision} onReview={changeQuestionReport} onEditQuestion={(report, question) => setEditing({ type: "question", item: question, reportId: report.id })}
      onEvidence={openQuestionReportEvidence} onError={showError}
    />;
    if (adminArea === "students") return <StudentsPanel students={students} attempts={adminAttempts} exams={exams} questions={questions}
      onUpdate={updateManagedStudent} onResetPassword={resetManagedStudentPassword}
      onSetDisabled={setManagedStudentDisabled} onDelete={deleteManagedStudent} />;
    if (adminArea === "create-student") return <CreateStudentPanel onCreate={createManagedStudent} />;
    if (adminArea === "dashboard" || adminArea === "statistics") return <StatisticsPanel
      title={adminArea === "dashboard" ? "Admin dashboard" : "Statistics"}
      students={students} attempts={adminAttempts} exams={exams} questions={questions} sections={sections}
    />;
    if (adminArea === "delete-questions") return (
      <DeleteQuestionsPanel
        exams={exams}
        sections={sections}
        questions={questions}
        onDeleteQuestion={handleDeleteSingleQuestion}
        onDeleteBatch={handleDeleteBatchQuestions}
        onDeleteAllGlobal={handleDeleteAllQuestionsGlobally}
      />
    );
    if (adminArea === "questions" || adminArea === "sections" || adminArea === "chapters") {
      const type: EntityType = adminArea === "questions" ? "question" : adminArea === "sections" ? "section" : "chapter";
      const list: Entity[] = type === "section" ? sections : type === "chapter" ? chapters : questions;
      return <AdminPanel
        type={type} types={[type]} rows={list} exams={exams} sections={sections} chapters={chapters} questions={questions}
        adminAttempts={adminAttempts} students={students} search={search} setSearch={setSearch} onTab={() => undefined}
        onAdd={() => setEditing({ type })} onEdit={(item) => setEditing({ type, item })}
        onDelete={(item) => void deleteEntity(type, item)} onSeed={() => void seedSampleData()}
        onAutoCategorize={prepareAutoCategorization}
      />;
    }
    return <div className="page-stack"><section className="section-heading page-title"><div><span className="eyebrow">CONTENT MANAGEMENT</span><h1>Add a question</h1><p>Create a question and add it to an exam, subject and chapter.</p></div></section><button className="button button-primary" onClick={() => setEditing({ type: "question" })}>+ Add question</button></div>;
  }

  const appReady = sessionLoaded;
  const viewLabel = view === "dashboard" ? "Dashboard" : view === "practice" ? "Chapter practice" : view === "random" ? "Random quiz" : view === "wrong" ? "Wrong questions" : view === "progress" ? "My progress" : view === "reports" ? "My reports" : "Admin dashboard";

  if (appReady && !profile) return <div className={darkMode ? "mode-dark login-theme" : "login-theme"}>
    <LoginPortal
      darkMode={darkMode} onToggleTheme={() => setDarkMode((current) => !current)}
      kind={loginKind} busy={authBusy} error={error}
      onChoose={chooseLogin} onSubmit={(event) => void submitAuth(event)}
      onRegister={registerStudent}
      selectedStudentCategory={selectedStudentCategory}
      categories={examCategories}
      categoriesLoading={categoriesLoading}
      categoriesError={categoriesError}
      onRetryCategories={() => setCategoriesReloadKey((current) => current + 1)}
      onSelectStudentCategory={chooseStudentCategory}
      onBack={() => {
        if (loginKind === "student") setLoginKind("student-category");
        else {
          setLoginKind("choose");
          setSelectedStudentCategory(null);
        }
        setError("");
      }}
      onDismissError={() => setError("")}
    />
    {toast && <div className="toast">{toast}<button onClick={() => setToast("")}><X size={16} /></button></div>}
  </div>;

  if (appReady && activeCbtPaper) {
    return (
      <div className={`app-shell theme-${settings.theme}${darkMode ? " mode-dark" : ""}`}>
        <CbtMockExam
          paper={activeCbtPaper.paper}
          questions={activeCbtPaper.questions}
          sections={sections}
          candidateName={profile?.name || "Student"}
          onExit={() => setActiveCbtPaper(null)}
          onSaveAttempt={handleSaveCbtAttempt}
          onReportQuestion={(q) => setReportingQuestion(q)}
          practiceMode={activeCbtPaper.practiceMode}
        />
        {(error || toast) && (
          <div className={`toast ${error ? "toast-error" : ""}`}>
            {error ? <CircleHelp size={18} /> : <Check size={18} />}
            {error || toast}
            <button onClick={() => { setError(""); setToast(""); }}><X size={16} /></button>
          </div>
        )}
      </div>
    );
  }

  return <div className={`app-shell theme-${settings.theme}${darkMode ? " mode-dark" : ""}`}>
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark">{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <GraduationCap size={23} />}</div><div><b>{settings.title.split(/\s+/)[0]}<span>{settings.title.split(/\s+/).slice(1).join(" ") || "prep"}</span></b><small>{isAdmin ? "ADMIN WORKSPACE" : "EXAM PRACTICE"}</small></div><button className="mobile-close" onClick={() => setMobileMenu(false)}><X size={19} /></button></div>
      {isAdmin && view === "admin" ? <>
        <div className="side-label admin-side-heading">ADMIN WORKSPACE</div>
        <nav className="admin-nav">{([
          ["dashboard", "Dashboard", LayoutDashboard],
          ["students", "Students", Users],
          ["categories", "Exam Categories", GraduationCap],
          ["exams", "Exam Management", BookOpen],
          ["subjects", "Subjects & Chapters", Layers3],
          ["create-student", "Create Student Account", UserRound],
          ["questions", "Questions", CircleHelp],
          ["delete-questions", "Delete Questions", Trash2],
          ["ai-import", "AI PDF Import", Sparkles],
          ["api-keys", "AI API Keys Pool", Key],
          ["sections", "Subjects / Sections", Layers3],
          ["chapters", "Chapters", BookOpen],
          ["add-question", "Add Question", Check],
          ["reports", "Question Reports", Flag],
          ["statistics", "Statistics", Activity],
          ["settings", "Settings", Settings],
        ] as const).map(([area, label, Icon]) => <button key={area} className={`nav-link ${adminArea === area ? "nav-active" : ""}`} onClick={() => {
          if (area === "add-question") {
            setAdminArea("questions");
            setEditing({ type: "question" });
          } else setAdminArea(area);
          setMobileMenu(false);
        }}><Icon size={18} />{label}{area === "reports" && pendingReportCount > 0 && <span className="report-nav-badge">{pendingReportCount}</span>}</button>)}<button className="nav-link admin-logout" onClick={() => void signOut()}><LogOut size={18} />Logout</button></nav>
      </> : <>
      {activeExam && <div className="exam-switcher"><span>PREPARING FOR</span><button onClick={() => setSelectedExam(null)}><span className={`exam-avatar mini-${activeExam.color}`}>{activeExam.name.slice(0, 1)}</span><span><b>{activeExam.name}</b><small>{activeExam.tagline}</small></span><ChevronDown size={16} /></button></div>}
      <div className="side-label">STUDY</div>
      <nav>{navItems.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} className={`nav-link ${view === item.id ? "nav-active" : ""}`} disabled={!selectedExam && item.id !== "progress" && item.id !== "reports"} onClick={() => visit(item.id)}><Icon size={18} />{item.label}{item.id === "wrong" && activeExam && <span className="nav-count">{questions.filter((question) => question.examId === selectedExam && byId.get(question.id)?.isCorrect === false).length}</span>}</button>;
      })}{isAdmin && <><div className="side-label side-label-spaced">MANAGE</div><button className={`nav-link ${view === "admin" ? "nav-active" : ""}`} onClick={() => visit("admin")}><ShieldCheck size={18} />Admin dashboard</button></>}</nav>
      </>}
      <div className="sidebar-bottom"><div className="sidebar-tip"><div className="tip-rays"><Sparkles size={16} /></div><b>Keep the streak going</b><p>A little practice every day builds big results.</p><div className="streak-bar"><span /><span /><span /><span /><span /><span /><span /></div><small>YOUR WEEKLY GOAL</small></div>
        <div className="user-box"><div className="user-avatar">{profile?.name?.slice(0, 1).toUpperCase() ?? "?"}</div><div className="user-info"><b>{profile?.name ?? "Guest learner"}</b><small>{profile?.role === "admin" ? "Administrator" : profile?.studentId ? `Student ID: ${profile.studentId}` : profile?.email ?? "Not signed in"}</small></div>{profile ? <button title="Log out" onClick={() => void signOut()}><LogOut size={17} /></button> : <button title="Sign in" onClick={() => setAuthOpen(true)}><LogIn size={17} /></button>}</div>
      </div>
    </aside>
    {mobileMenu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
    <main className="main-area">
      <header className="topbar">
        <div className="top-left">
          <button className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumb">
            <span>Workspace</span><i>/</i><b>{isAdmin ? "Admin" : activeExam?.name ?? "Select an exam"}</b><i>/</i><b>{isAdmin && view === "admin" ? titleCase(adminArea.replace("-", " ")) : viewLabel}</b>
          </div>
        </div>
        <div className="top-actions">
          <label className="header-search group focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500/40 transition-all">
            <Search size={16} className="text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions…" disabled={!selectedExam && view !== "progress"} />
            <kbd className="hidden sm:inline-flex text-[10px] text-slate-400 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
          </label>
          <ThemeToggle darkMode={darkMode} onToggle={() => setDarkMode((current) => !current)} />
          <button className="icon-button" onClick={() => profile ? (isAdmin ? setAdminArea("dashboard") : visit("progress")) : setAuthOpen(true)} aria-label={profile ? (isAdmin ? "Admin dashboard" : "My progress") : "Sign in"}>
            <UserRound size={18} />
          </button>
        </div>
      </header>
      <div className="content-area">
        <AnimatePresence mode="wait">
          {!appReady && <div className="loading-state"><div className="spinner" /> Loading your account…</div>}
          {appReady && isAdmin && view === "admin" && (
            <PageTransition key="admin-view">
              {renderAdmin()}
            </PageTransition>
          )}
          {appReady && !isAdmin && view === "reports" && (
            <PageTransition key="student-reports">
              <QuestionReportsPanel
                reports={questionReports} questions={questions}
                isAdmin={false} historyRevision={0} onReview={changeQuestionReport} onEditQuestion={() => undefined}
                onEvidence={openQuestionReportEvidence} onError={showError}
                onExit={() => { setSelectedExam(null); setView("dashboard"); }}
              />
            </PageTransition>
          )}
          {appReady && !isAdmin && !selectedExam && view === "progress" && (
            <PageTransition key="overall-progress">
              {renderProgress()}
            </PageTransition>
          )}
          {appReady && !isAdmin && !activeStudentCategory && view !== "progress" && view !== "reports" && (
            <PageTransition key="student-category-picker">
              <StudentCategoryPanel
                categories={examCategories}
                loading={categoriesLoading}
                error={categoriesError}
                onRetry={() => setCategoriesReloadKey((current) => current + 1)}
                onSelect={chooseStudentCategory}
              />
            </PageTransition>
          )}
          {appReady && !isAdmin && selectedPlatformExam && activeStudentCategory && !selectedExam && view !== "progress" && view !== "reports" && (
            <PageTransition key={`subjects-${selectedPlatformExam.id}`}>
              <StudentSubjectChapterPicker
                exam={selectedPlatformExam}
                subjects={platformSubjects}
                questions={questions}
                loading={platformSubjectsLoading}
                error={platformSubjectsError}
                questionLoading={examQuestionsLoading}
                questionError={examQuestionsError}
                onRetry={() => setSubjectsReloadKey((current) => current + 1)}
                onBack={returnToExamPicker}
                onStartChapter={(subject, chapter) => launchChapterQuiz(selectedPlatformExam, subject, chapter)}
              />
            </PageTransition>
          )}
          {appReady && !isAdmin && activeStudentCategory && !selectedExam && !selectedPlatformExam && view !== "progress" && view !== "reports" && (
            <PageTransition key="exam-picker">
              <ExamPicker
                exams={platformExams.filter((exam) => exam.active)}
                quizExams={exams.filter((exam) => !settings.hiddenExamIds.includes(exam.id))}
                category={activeStudentCategory}
                loading={platformExamsLoading}
                error={platformExamsError}
                onRetry={() => setPlatformExamsReloadKey((current) => current + 1)}
                onSelect={openExam}
                onBrowseSubjects={browsePlatformExam}
                onChangeCategory={() => {
                  if (profile?.role === "student") localStorage.removeItem(`mba-student-category-${profile.uid}`);
                  setStudentCategoryId("");
                  setSelectedStudentCategory(null);
                  setPlatformExams([]);
                  setSelectedExam(null);
                  setSelectedPlatformExam(null);
                }}
                onProgress={() => visit("progress")}
                profile={profile}
                onAuth={() => setAuthOpen(true)}
                onAdmin={() => visit("admin")}
                title={settings.title}
                welcome={settings.welcomeMessage}
                logoUrl={settings.logoUrl}
              />
            </PageTransition>
          )}
          {appReady && !isAdmin && selectedExam && (
            <PageTransition key={`${selectedExam}-${view}-${sectionId ?? "none"}`}>
              {view === "dashboard" && (sectionId ? renderSectionPicker() : renderDashboard())}
              {view === "practice" && renderQuiz()}
              {view === "random" && (quiz || result ? renderQuiz() : renderRandom())}
              {view === "wrong" && (quiz || result ? renderQuiz() : renderWrong())}
              {view === "progress" && renderProgress()}
            </PageTransition>
          )}
        </AnimatePresence>
      </div>
    </main>
    {editing && <EntityEditor key={`${editing.type}-${editing.item?.id ?? "new"}`} type={editing.type} item={editing.item} exams={exams} sections={sections} chapters={chapters} onClose={() => setEditing(null)} onSave={(item) => void saveEntity(editing.type, item, editing.reportId)} classify={(text) => classifyQuestion(text, { exams, sections, chapters })} />}
    {reportingQuestion && <QuestionReportForm question={reportingQuestion} onClose={() => setReportingQuestion(null)} onSubmit={(reason, explanation, file) => submitQuestionReport(reportingQuestion, reason, explanation, file)} />}
    {bulkClassifications && <BulkClassificationReview
      questions={bulkClassifications} exams={exams} sections={sections} chapters={chapters}
      onClose={() => setBulkClassifications(null)}
      onSave={saveBulkClassifications}
    />}
    {authOpen && <Modal onClose={() => setAuthOpen(false)}><div className="auth-modal">
      <div className="modal-emblem"><GraduationCap size={25} /></div><h2>{loginKind === "admin" ? "Admin Login" : "Student Login"}</h2><p>Sign in with the ID and password provided to you.</p>
      <form className="editor-form" onSubmit={(event) => void submitAuth(event)}>
        <Field label={loginKind === "admin" ? "Admin ID" : "Student ID"} name="studentId" required autoComplete="username" />
        <Field label={loginKind === "admin" ? "Admin Password" : "Password"} name="password" type="password" required autoComplete="current-password" />
        <button className="button button-primary button-full" disabled={authBusy}>{authBusy ? "Please wait…" : "Login"}</button>
      </form>
    </div></Modal>}
    {(error || toast) && <div className={`toast ${error ? "toast-error" : ""}`}>{error ? <CircleHelp size={18} /> : <Check size={18} />}{error || toast}<button onClick={() => { setError(""); setToast(""); }}><X size={16} /></button></div>}
  </div>;
}

function SectionIcon({ index }: { index: number }) {
  const icons = [<Target key="a" />, <Zap key="b" />, <Activity key="c" />, <BookOpen key="d" />, <Award key="e" />];
  return icons[index % icons.length];
}

function StatCard({ icon, label, value, caption, tone }: { icon: ReactNode; label: string; value: string | number; caption: string; tone: string }) {
  return (
    <motion.article
      whileHover={{ y: -3, transition: { duration: 0.16 } }}
      className="stat-card cursor-default select-none"
    >
      <div className={`stat-icon tone-${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <b>{value}</b>
        <small>{caption}</small>
      </div>
      <div className="stat-sparkline"><i /><i /><i /><i /><i /><i /><i /></div>
    </motion.article>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return <div><small>{label}</small><b>{value}</b></div>;
}

function StudentCategoryPanel({ categories, loading, error, onRetry, onSelect }: {
  categories: ExamCategory[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSelect: (category: ExamCategory) => void;
}) {
  return <div className="page-stack student-catalog-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><GraduationCap size={14} /> STUDENT PORTAL</span><h1>Choose an exam category</h1><p>Your exam list will be filtered to the category you select.</p></div></section>
    {error && <div className="login-error" role="alert"><CircleHelp size={17} />{error}<button className="button button-outline" onClick={onRetry}>Try again</button></div>}
    {loading ? <div className="category-loading" role="status">Loading active categories…</div>
      : <div className="student-category-grid">
        {categories.filter((category) => category.active).map((category) => <button key={category.id} type="button" className="student-category-card" onClick={() => onSelect(category)}>
          <span className="account-choice-icon"><GraduationCap size={23} /></span>
          <span className="student-category-name">{category.name}</span>
          <span className="student-category-description">{category.description}</span>
          <span className="account-choice-link">View exams <ArrowRight size={15} /></span>
        </button>)}
        {!error && categories.filter((category) => category.active).length === 0 && <div className="category-loading">No active exam categories are available right now.</div>}
      </div>}
  </div>;
}

function ExamPicker({ exams, quizExams, category, loading, error, onRetry, onSelect, onBrowseSubjects, onChangeCategory, onProgress, profile, onAuth, onAdmin, title, welcome, logoUrl }: {
  exams: PlatformExam[]; quizExams: Exam[]; category: ExamCategory; loading: boolean; error: string;
  onRetry: () => void; onSelect: (id: string) => void; onBrowseSubjects: (id: string) => void; onChangeCategory: () => void; onProgress: () => void; profile: UserProfile | null;
  onAuth: () => void; onAdmin: () => void; title: string; welcome: string; logoUrl: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="picker-page"
    >
      <header className="picker-header">
        <div className="brand">
          <div className="brand-mark">
            {logoUrl ? <img src={logoUrl} alt="" /> : <GraduationCap size={23} />}
          </div>
          <div>
            <b>{title}</b>
            <small>EXAM PRACTICE SUITE</small>
          </div>
        </div>
        <div className="picker-header-actions flex items-center gap-3">
          <button className="button button-quiet" onClick={onChangeCategory}>Change category</button>
          {profile && (
            <button className="button button-quiet" onClick={onProgress}>
              <Activity size={16} /> My progress
            </button>
          )}
          {profile?.role === "admin" && (
            <button className="button button-quiet" onClick={onAdmin}>
              <ShieldCheck size={16} /> Admin workspace
            </button>
          )}
          <button className="button button-outline" onClick={profile ? onProgress : onAuth}>
            {profile ? (
              <><UserRound size={16} /> {profile.name}</>
            ) : (
              <><LogIn size={16} /> Sign in</>
            )}
          </button>
        </div>
      </header>

      <div className="picker-body">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="picker-copy"
        >
          <span className="eyebrow">
            <span className="eyebrow-dot" /> {category.name.toUpperCase()} EXAM PREPARATION
          </span>
          <h1>Which {category.name} exam are<br />you preparing for?</h1>
          <p>{category.description || welcome}</p>
          <div className="picker-perks">
            <span><Check size={15} /> Real Past Question Papers &amp; CBT Mocks</span>
            <span><Check size={15} /> LaTeX Math &amp; Graph Inspection</span>
            <span><Check size={15} /> Personalized Analytics</span>
          </div>
        </motion.div>

        {error && <div className="login-error" role="alert"><CircleHelp size={17} />{error}<button className="button button-outline" onClick={onRetry}>Try again</button></div>}
        {loading ? <div className="category-loading" role="status">Loading exams…</div> : <div className="exam-card-grid">
          {exams.map((exam, index) => {
            const linkedExam = quizExams.find((item) => item.id === exam.quizExamId);
            const color = linkedExam?.color ?? ["violet", "blue", "green", "orange"][index % 4];
            return (
              <motion.article
                key={exam.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -6, transition: { duration: 0.18 } }}
                whileTap={{ scale: 0.98 }}
                className={`exam-card exam-${color} relative overflow-hidden text-left`}
              >
                <div className="exam-card-top">
                  <span className="exam-card-icon">
                    {index === 0 ? <Target /> : index === 1 ? <Zap /> : index === 2 ? <BookOpen /> : <Award />}
                  </span>
                  <span className="exam-content-badge">
                    {linkedExam ? "Practice available" : "Coming soon"}
                  </span>
                </div>
                <h2>{exam.name}</h2>
                <p>{exam.description}</p>
                <div className="exam-card-actions">
                  <button className="exam-card-bottom exam-card-action" type="button" onClick={() => onBrowseSubjects(exam.id)}>
                    Browse subjects <ArrowRight size={15} />
                  </button>
                  {linkedExam && <button className="exam-card-bottom exam-card-action" type="button" onClick={() => onSelect(linkedExam.id)}>
                    Start practice <ArrowRight size={15} />
                  </button>}
                </div>
                <span className="exam-card-shape" />
              </motion.article>
            );
          })}
          {!exams.length && !error && <div className="category-loading">No exams are currently available in {category.name}.</div>}
        </div>}
      </div>

      <footer className="picker-footer">
        <span>Engineered for focused learning. Made for your top percentile.</span>
        <span><ShieldCheck size={14} /> Secure authentication · Private browser progress</span>
      </footer>
    </motion.div>
  );
}

function StudentSubjectChapterPicker({ exam, subjects, questions, loading, error, questionLoading, questionError, onRetry, onBack, onStartChapter }: {
  exam: PlatformExam;
  subjects: PlatformSubject[];
  questions: Question[];
  loading: boolean;
  error: string;
  questionLoading: boolean;
  questionError: string;
  onRetry: () => void;
  onBack: () => void;
  onStartChapter: (subject: PlatformSubject, chapter: PlatformChapter) => void;
}) {
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [chapters, setChapters] = useState<PlatformChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState("");
  const [chaptersReloadKey, setChaptersReloadKey] = useState(0);
  const [selectedChapterId, setSelectedChapterId] = useState("");
  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId);
  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId);
  const selectedChapterQuestions = selectedSubject && selectedChapter
    ? questionsForPlatformChapter(questions, exam, selectedSubject, selectedChapter)
    : [];

  useEffect(() => {
    setSelectedSubjectId("");
    setSelectedChapterId("");
    setChapters([]);
  }, [exam.id]);

  useEffect(() => {
    if (!selectedSubjectId) {
      setChapters([]);
      setChaptersError("");
      setSelectedChapterId("");
      return;
    }
    let active = true;
    setChaptersLoading(true);
    setChaptersError("");
    setSelectedChapterId("");
    fetch(`/api/exam-chapters?subjectId=${encodeURIComponent(selectedSubjectId)}`, { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json() as { chapters?: PlatformChapter[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load chapters.");
        if (!Array.isArray(result.chapters)) throw new Error("The chapter service returned invalid data.");
        if (active) setChapters(result.chapters);
      })
      .catch((reason: unknown) => {
        if (active) setChaptersError(reason instanceof Error ? reason.message : "Could not load chapters.");
      })
      .finally(() => { if (active) setChaptersLoading(false); });
    return () => { active = false; };
  }, [selectedSubjectId, chaptersReloadKey]);

  return <div className="page-stack student-catalog-page subject-chapter-picker">
    <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to exams</button>
    <section className="section-heading page-title"><div>
      <span className="eyebrow"><BookOpen size={14} /> {exam.name.toUpperCase()}</span>
      <h1>Choose a subject and chapter</h1>
      <p>Select a subject to view its chapters.</p>
    </div></section>
    {error && <div className="login-error" role="alert"><CircleHelp size={17} />{error}<button className="button button-outline" onClick={onRetry}>Try again</button></div>}
    {loading ? <div className="category-loading" role="status">Loading subjects…</div> : <>
      <section className="question-stat-panel student-subject-panel">
        <div className="section-heading"><div><h2>Subjects</h2><p>{subjects.length} available</p></div></div>
        <div className="student-subject-list">
          {subjects.map((subject) => <button
            type="button"
            key={subject.id}
            className={`student-subject-option${subject.id === selectedSubjectId ? " selected" : ""}`}
            aria-pressed={subject.id === selectedSubjectId}
            onClick={() => setSelectedSubjectId(subject.id)}
          ><Layers3 size={18} /><span>{subject.name}</span><ArrowRight size={16} /></button>)}
          {!subjects.length && !error && <p className="table-empty">No subjects have been added to {exam.name} yet.</p>}
        </div>
      </section>
      {selectedSubject && <section className="question-stat-panel student-chapter-panel">
        <div className="section-heading"><div><h2>{selectedSubject.name} chapters</h2><p>Select a chapter to continue.</p></div></div>
        {chaptersError && <div className="login-error" role="alert"><CircleHelp size={17} />{chaptersError}<button className="button button-outline" onClick={() => setChaptersReloadKey((current) => current + 1)}>Try again</button></div>}
        {chaptersLoading ? <div className="category-loading" role="status">Loading chapters…</div> : <div className="student-chapter-list">
          {chapters.map((chapter) => <button
            type="button"
            key={chapter.id}
            className={`student-chapter-option${chapter.id === selectedChapterId ? " selected" : ""}`}
            aria-pressed={chapter.id === selectedChapterId}
            onClick={() => setSelectedChapterId(chapter.id)}
          ><BookOpen size={17} /><span>{chapter.name}</span><small>{questionsForPlatformChapter(questions, exam, selectedSubject, chapter).length} questions</small>{chapter.id === selectedChapterId && <Check size={16} />}</button>)}
          {!chapters.length && !chaptersError && <p className="table-empty">No chapters have been added to this subject yet.</p>}
        </div>}
        {selectedChapter && <div className="chapter-quiz-launch">
          {questionLoading && <p role="status">Loading question bank…</p>}
          {questionError && <p className="chapter-quiz-error" role="alert">{questionError}</p>}
          {!questionLoading && !questionError && !selectedChapterQuestions.length && <p>Quiz questions for this chapter are not available yet.</p>}
          <button type="button" className="button button-primary" disabled={questionLoading || !selectedChapterQuestions.length} onClick={() => onStartChapter(selectedSubject, selectedChapter)}>
            Start chapter quiz <ArrowRight size={16} />
          </button>
        </div>}
      </section>}
    </>}
  </div>;
}

function LoginPortal({ darkMode, onToggleTheme, kind, busy, error, onChoose, onSubmit, onRegister, selectedStudentCategory, categories, categoriesLoading, categoriesError, onRetryCategories, onSelectStudentCategory, onBack, onDismissError }: {
  darkMode: boolean; onToggleTheme: () => void; kind: LoginPage; busy: boolean; error: string;
  onChoose: (kind: LoginPage) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: (input: StudentAccountInput) => Promise<void>;
  selectedStudentCategory: ExamCategory | null;
  categories: ExamCategory[];
  categoriesLoading: boolean;
  categoriesError: string;
  onRetryCategories: () => void;
  onSelectStudentCategory: (category: ExamCategory) => void;
  onBack: () => void; onDismissError: () => void;
}) {
  const [typedId, setTypedId] = useState("");
  const [typedPassword, setTypedPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [studentMode, setStudentMode] = useState<"login" | "register">("login");
  const [registrationError, setRegistrationError] = useState("");

  function fillDemo(studentId: string, pass: string) {
    setTypedId(studentId);
    setTypedPassword(pass);
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setRegistrationError("");
    try {
      await onRegister({
        name: String(data.get("name") ?? "").trim(),
        studentId: String(data.get("studentId") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        email: String(data.get("email") ?? "").trim(),
        phone: String(data.get("phone") ?? "").trim(),
      });
    } catch (reason) {
      setRegistrationError(reason instanceof Error ? reason.message : "Could not create your student account.");
    }
  }

  return (
    <main className="login-page">
      <header className="login-header">
        <a
          className="login-brand"
          href="#home"
          onClick={(event) => { event.preventDefault(); onBack(); }}
        >
          <span className="brand-mark"><GraduationCap size={23} /></span>
          <span><b>MBA Prep</b><small>EXAM PRACTICE</small></span>
        </a>
        <div className="login-header-actions">
          <ThemeToggle darkMode={darkMode} onToggle={onToggleTheme} />
          <span className="login-header-note"><ShieldCheck size={16} /> Secure server-side session</span>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {kind === "choose" ? (
          <motion.section
            key="choose"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22 }}
            className="account-choice"
          >
            <span className="eyebrow"><span className="eyebrow-dot" /> YOUR PREPARATION, YOUR WAY</span>
            <h1>Welcome to your exam prep</h1>
            <p>Choose your portal to continue. Student practice and administrator tools have separate sign-in flows.</p>

            <div className="account-choice-grid">
              <motion.button
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                className="account-choice-card student-choice"
                aria-label="Continue to Student exam categories"
                onClick={() => onChoose("student-category")}
              >
                <span className="account-choice-icon"><GraduationCap size={26} /></span>
                <span className="account-choice-title">Student</span>
                <span className="account-choice-description">Choose an exam category, then sign in or register for the student portal.</span>
                <span className="account-choice-link">Enter Student Portal <ArrowRight size={16} /></span>
              </motion.button>

              <motion.button
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                className="account-choice-card admin-choice"
                aria-label="Continue to Admin sign in"
                onClick={() => onChoose("admin")}
              >
                <span className="account-choice-icon"><ShieldCheck size={26} /></span>
                <span className="account-choice-title">Admin</span>
                <span className="account-choice-description">Manage question banks, PDF imports, student accounts, platform settings, and question reports.</span>
                <span className="account-choice-link">Enter Admin Console <ArrowRight size={16} /></span>
                <span className="admin-only-badge">AUTHORIZED ADMIN ONLY</span>
              </motion.button>
            </div>

            {error && (
              <div className="login-error login-chooser-error">
                <CircleHelp size={17} />{error}
                <button onClick={onDismissError} aria-label="Dismiss message"><X size={15} /></button>
              </div>
            )}
            <div className="demo-login-note">
              <Sparkles size={16} className="text-amber-500" /> Choose a portal to open its dedicated sign-in page.
            </div>
          </motion.section>
        ) : kind === "student-category" ? (
          <motion.section
            key="student-category"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className="account-choice student-category-page"
          >
            <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to portal choices</button>
            <span className="eyebrow"><span className="eyebrow-dot" /> STUDENT PORTAL</span>
            <h1>Choose your exam category</h1>
            <p>Select a category before continuing to student sign in or registration.</p>
            {error && (
              <div className="login-error login-chooser-error">
                <CircleHelp size={17} />{error}
                <button onClick={onDismissError} aria-label="Dismiss message"><X size={15} /></button>
              </div>
            )}
            {categoriesError && <div className="login-error category-load-error" role="alert">
              <CircleHelp size={17} />{categoriesError}
              <button type="button" className="button button-outline" onClick={onRetryCategories}>Try again</button>
            </div>}
            {categoriesLoading ? <div className="category-loading" role="status">Loading available exam categories…</div>
              : !categoriesError && categories.length === 0 ? <div className="category-loading">No active exam categories are available right now.</div>
              : <div className="student-category-grid">
              {categories.filter((category) => category.active).map((category) => (
                <motion.button
                  key={category.id}
                  type="button"
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  className="student-category-card"
                  onClick={() => {
                    setStudentMode("login");
                    setRegistrationError("");
                    onSelectStudentCategory(category);
                  }}
                >
                  <span className="account-choice-icon"><GraduationCap size={23} /></span>
                  <span className="student-category-name">{category.name}</span>
                  <span className="student-category-description">{category.description}</span>
                  <span className="account-choice-link">Continue <ArrowRight size={15} /></span>
                </motion.button>
              ))}
            </div>
            }
          </motion.section>
        ) : (
          <motion.section
            key="form"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className="login-form-card"
          >
            <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> {kind === "student" ? "Change exam category" : "Back to Student / Admin choices"}</button>
            <div className={`login-form-icon ${kind === "admin" ? "login-form-admin" : ""}`}>
              {kind === "admin" ? <ShieldCheck size={27} /> : <GraduationCap size={27} />}
            </div>
            <span className="eyebrow">{kind === "admin" ? "RESTRICTED ACCESS" : "STUDENT WORKSPACE"}</span>
            <h1>{kind === "admin" ? "Admin Login" : "Student Login / Registration"}</h1>
            <p>{kind === "admin"
              ? "Sign in with your private administrative credentials."
              : `Selected category: ${selectedStudentCategory?.name ?? "Not selected"}. Sign in or create a student account to continue.`}</p>

            {kind === "student" && (
              <div className="student-auth-tabs" role="tablist" aria-label="Student account options">
                <button type="button" role="tab" aria-selected={studentMode === "login"} className={studentMode === "login" ? "active" : ""} onClick={() => { setStudentMode("login"); setRegistrationError(""); onDismissError(); }}>Login</button>
                <button type="button" role="tab" aria-selected={studentMode === "register"} className={studentMode === "register" ? "active" : ""} onClick={() => { setStudentMode("register"); setRegistrationError(""); onDismissError(); }}>Register</button>
              </div>
            )}

            {kind === "student" && studentMode === "register" ? (
              <>
                {registrationError && <div className="login-error"><CircleHelp size={17} />{registrationError}</div>}
                <form className="editor-form login-form" onSubmit={(event) => void submitRegistration(event)}>
                  <Field label="Full name" name="name" placeholder="Your name" required autoComplete="name" />
                  <Field label="Student ID" name="studentId" placeholder="Choose a Student ID" required autoComplete="username" />
                  <Field label="Password" name="password" type="password" placeholder="At least 8 characters" minLength={8} required autoComplete="new-password" />
                  <Field label="Email (optional)" name="email" type="email" placeholder="you@example.com" autoComplete="email" />
                  <Field label="Phone number (optional)" name="phone" type="tel" placeholder="Phone number" autoComplete="tel" />
                  <button className="button button-primary button-full mt-2" disabled={busy}>
                    {busy ? "Creating account…" : "Create Student Account"}
                  </button>
                </form>
              </>
            ) : (
              <>
                {error && <div className="login-error"><CircleHelp size={17} />{error}</div>}
                <form className="editor-form login-form" onSubmit={onSubmit}>
                  <label className="form-label">
                    <span>{kind === "admin" ? "Admin ID" : "Student ID"}</span>
                    <input
                      name="studentId"
                      value={typedId}
                      onChange={(e) => setTypedId(e.target.value)}
                      placeholder={kind === "admin" ? "Enter 'admin'" : "Enter Student ID (e.g. STU101)"}
                      required
                      autoComplete="username"
                    />
                  </label>

                  <label className="form-label">
                    <span>{kind === "admin" ? "Admin Password" : "Password"}</span>
                    <div className="relative flex items-center">
                      <input
                        name="password"
                        type={showPassword ? "text" : "password"}
                        value={typedPassword}
                        onChange={(e) => setTypedPassword(e.target.value)}
                        placeholder="Enter password"
                        required
                        autoComplete="current-password"
                        className="w-full pr-10"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>

                  <button className="button button-primary button-full mt-2" disabled={busy}>
                    {busy ? "Authenticating…" : kind === "admin" ? "Login to Admin Console" : "Enter Practice Portal"}
                  </button>
                </form>

            {/* Quick Demo Pre-Fill Helper */}
            {studentMode === "login" && kind === "student" && <div className="demo-fill-box mt-4 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5 font-semibold">
                <span>Quick Demo Fill:</span>
                <span className="text-[10px] uppercase tracking-wider text-indigo-500">1-Click</span>
              </div>
              <button
                type="button"
                className="w-full text-left p-1.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-between"
                onClick={() => fillDemo("STU101", "student123")}
              >
                <span>Sample Student: <b>STU101</b></span>
                <span className="text-indigo-500 text-[11px] font-bold">Use Credentials →</span>
              </button>
            </div>}
              </>
            )}

            {kind === "admin" && <div className="admin-login-security mt-4">
              <ShieldCheck size={16} /> Administrator access is verified by the server.
            </div>}
          </motion.section>
        )}
      </AnimatePresence>

      <footer className="login-footer">
        <span>Focused practice for your next big step.</span>
        <span><ShieldCheck size={14} /> Student progress is private to each account</span>
      </footer>
    </main>
  );
}

function ThemeToggle({ darkMode, onToggle }: { darkMode: boolean; onToggle: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
      title={darkMode ? "Light mode" : "Dark mode"}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={darkMode ? "dark" : "light"}
          initial={{ rotate: -70, opacity: 0, scale: 0.8 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 70, opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.18 }}
          className="inline-flex items-center"
        >
          {darkMode ? <Sun size={17} className="text-amber-400" /> : <Moon size={17} className="text-indigo-500" />}
        </motion.span>
      </AnimatePresence>
      <span>{darkMode ? "Light" : "Dark"}</span>
    </motion.button>
  );
}

function dateText(value: unknown): string {
  if (!value) return "Not recorded";
  const date = dateValue(value);
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not recorded";
}

function dateValue(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number"
    ? new Date(value)
    : typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function"
      ? value.toDate() as Date
      : typeof value === "object" && value !== null && "seconds" in value
        ? new Date(Number(value.seconds) * 1000)
        : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function StatisticsPanel({ title, students, attempts, exams, questions, sections }: {
  title: string; students: UserProfile[]; attempts: (Attempt & { userId: string; eventId?: string })[];
  exams: Exam[]; questions: Question[]; sections: Section[];
}) {
  const studentIds = new Set(students.map((student) => student.uid));
  const studentAttempts = attempts.filter((attempt) => studentIds.has(attempt.userId));
  const correct = studentAttempts.filter((attempt) => attempt.isCorrect).length;
  const wrong = studentAttempts.length - correct;
  const quizCount = new Set(studentAttempts.map((attempt) => attempt.sessionId).filter(Boolean)).size;
  const activeCount = students.filter((student) => {
    const last = dateValue(student.lastLogin);
    return last !== null && Date.now() - last.getTime() < 30 * 24 * 60 * 60 * 1000;
  }).length;
  return <div className="page-stack admin-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><Activity size={14} /> ADMIN ANALYTICS</span><h1>{title}</h1><p>Live student and question-bank statistics.</p></div></section>
    <section className="admin-stat-grid">
      <StatCard icon={<Users />} label="Total students" value={students.length} caption="registered student accounts" tone="purple" />
      <StatCard icon={<UserRound />} label="Active students" value={activeCount} caption="logged in during the last 30 days" tone="blue" />
      <StatCard icon={<ClipboardList />} label="Quiz attempts" value={quizCount} caption="distinct practice sessions" tone="green" />
      <StatCard icon={<BookOpen />} label="Questions answered" value={studentAttempts.length} caption="submitted answers" tone="orange" />
      <StatCard icon={<Check />} label="Correct answers" value={correct} caption="across student attempts" tone="green" />
      <StatCard icon={<X />} label="Wrong answers" value={wrong} caption="across student attempts" tone="orange" />
      <StatCard icon={<Target />} label="Average accuracy" value={`${percent(correct, studentAttempts.length)}%`} caption="correct / answered" tone="purple" />
      <StatCard icon={<BookOpen />} label="Total questions" value={questions.length} caption="published in the question bank" tone="blue" />
    </section>
    <section className="question-stat-panel exam-statistics"><div className="section-heading"><div><h2>Exam-wise statistics</h2><p>Questions and student attempts by exam.</p></div></div>
      <div className="exam-stats-grid">{exams.map((exam) => {
        const examAttempts = studentAttempts.filter((attempt) => attempt.examId === exam.id);
        return <article className="exam-stat-card" key={exam.id}><div className={`mini-exam-icon mini-${exam.color}`}>{exam.name.slice(0, 1)}</div><div><b>{exam.name}</b><small>{exam.tagline}</small></div><div className="exam-stat-values"><span><b>{questions.filter((question) => question.examId === exam.id).length}</b>Questions</span><span><b>{examAttempts.length}</b>Attempts</span><span><b>{percent(examAttempts.filter((attempt) => attempt.isCorrect).length, examAttempts.length)}%</b>Accuracy</span></div></article>;
      })}</div>
    </section>
    {title === "Admin dashboard" && <section className="question-stat-panel"><div className="section-heading"><div><h2>Top question activity</h2><p>Question attempts, correct answers and accuracy.</p></div></div><QuestionStatistics attempts={studentAttempts} questions={questions} exams={exams} sections={sections} /></section>}
  </div>;
}

function QuestionStatistics({ attempts, questions, exams, sections }: {
  attempts: Attempt[]; questions: Question[]; exams: Exam[]; sections: Section[];
}) {
  return <div className="table-wrap"><table><thead><tr><th>Question</th><th>Exam / Subject</th><th>Attempts</th><th>Correct</th><th>Accuracy</th></tr></thead><tbody>{questions.map((question) => {
    const questionAttempts = attempts.filter((attempt) => attempt.questionId === question.id);
    const correct = questionAttempts.filter((attempt) => attempt.isCorrect).length;
    return <tr key={question.id}><td className="question-cell"><MathContent text={question.question} /></td><td>{exams.find((exam) => exam.id === question.examId)?.name} · {sections.find((section) => section.id === question.sectionId)?.name}</td><td>{questionAttempts.length}</td><td>{correct}</td><td>{percent(correct, questionAttempts.length)}%</td></tr>;
  })}{!questions.length && <tr><td colSpan={5} className="table-empty">No questions are available.</td></tr>}</tbody></table></div>;
}

function QuestionReportForm({ question, onClose, onSubmit }: {
  question: Question;
  onClose: () => void;
  onSubmit: (reason: string, explanation: string, file?: File) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | undefined>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const reason = String(values.get("reason") ?? "").trim();
    const explanation = String(values.get("studentExplanation") ?? "").trim();
    if (!reason || !explanation) {
      setError("Enter both a reason and your explanation.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(reason, explanation, file);
      onClose();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Could not submit your report.");
    } finally {
      setSaving(false);
    }
  }

  return <Modal onClose={onClose}><div className="editor-modal question-report-form">
    <div className="modal-title"><div><span className="eyebrow">QUESTION FEEDBACK</span><h2>Report / Challenge Question</h2></div><button className="icon-button" onClick={onClose} disabled={saving}><X size={18} /></button></div>
    <div className="report-question-preview"><MathContent text={question.question} /></div>
    <p className="report-form-note">Your report is private to you and the administrator. It will not change the question or answer automatically.</p>
    <p className="report-demo-warning">Reports and any optional image evidence are stored in this browser only.</p>
    {error && <div className="login-error">{error}</div>}
    <form className="editor-form" onSubmit={(event) => void submit(event)}>
      <label className="form-label">Reason for reporting<textarea name="reason" maxLength={2000} rows={3} required placeholder="What may be incorrect about this question, answer, or explanation?" /></label>
      <label className="form-label">Your explanation / solution<textarea name="studentExplanation" maxLength={10000} rows={5} required placeholder="Describe how you solved it and what you believe should be corrected." /></label>
      <label className="form-label report-file-label">Upload evidence <span className="optional">(optional · JPG, PNG or WEBP · maximum 5 MB)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => {
          const candidate = event.currentTarget.files?.[0];
          if (!candidate) { setFile(undefined); return; }
          if (!["image/jpeg", "image/png", "image/webp"].includes(candidate.type)) {
            setFile(undefined);
            event.currentTarget.value = "";
            setError("Choose a JPG, PNG, or WEBP image.");
            return;
          }
          if (candidate.size > 5 * 1024 * 1024) {
            setFile(undefined);
            event.currentTarget.value = "";
            setError("Evidence images must be no larger than 5 MB.");
            return;
          }
          setError("");
          setFile(candidate);
        }} />
        {file && <small className="report-file-selected"><ImageIcon size={14} /> {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</small>}
      </label>
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Submitting report…" : "Submit Report"}</button></div>
    </form>
  </div></Modal>;
}

function QuestionReportsPanel({ reports, questions, isAdmin, historyRevision, onReview, onEditQuestion, onEvidence, onError, onExit }: {
  reports: QuestionReport[];
  questions: Question[];
  isAdmin: boolean;
  historyRevision: number;
  onReview: (reportId: string, status: QuestionReportStatus, adminResponse: string) => Promise<void>;
  onEditQuestion: (report: QuestionReport, question: Question) => void;
  onEvidence: (report: QuestionReport) => Promise<string>;
  onError: (message: string) => void;
  onExit?: () => void;
}) {
  const sortedReports = [...reports].sort((a, b) => (dateValue(b.submittedAt)?.getTime() ?? 0) - (dateValue(a.submittedAt)?.getTime() ?? 0));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sortedReports.find((report) => report.id === selectedId) ?? sortedReports[0] ?? null;
  const [response, setResponse] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [history, setHistory] = useState<QuestionChange[]>([]);
  const [busy, setBusy] = useState(false);
  const currentQuestion = selected ? questions.find((question) => question.id === selected.questionId) : undefined;

  useEffect(() => {
    setResponse(selected?.adminResponse ?? "");
    setImageUrl("");
    setHistory([]);
    if (!isAdmin || !selected) return;
    setHistory(readLocal<QuestionChange[]>("mba-question-change-history", [])
      .filter((change) => change.relatedReportId === selected.id));
  }, [selected?.id, selected?.adminResponse, isAdmin, historyRevision]);

  async function viewEvidence() {
    if (!selected) return;
    setBusy(true);
    try {
      setImageUrl(await onEvidence(selected));
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not open the evidence image.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(status: QuestionReportStatus) {
    if (!selected) return;
    setBusy(true);
    try {
      await onReview(selected.id, status, response);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not update the report.");
    } finally {
      setBusy(false);
    }
  }

  const statuses: QuestionReportStatus[] = ["Pending Review", "Under Review", "Accepted", "Rejected", "Resolved"];
  const currentOptions = currentQuestion?.options;
  return <div className="page-stack admin-page question-reports-page">
    {onExit && <button className="back-link" onClick={onExit}><ArrowLeft size={16} /> Back to exam selection</button>}
    <section className="section-heading page-title"><div><span className="eyebrow"><Flag size={14} /> {isAdmin ? "STUDENT FEEDBACK" : "YOUR QUESTION FEEDBACK"}</span><h1>{isAdmin ? "Question Reports" : "My Question Reports"}</h1><p>{isAdmin ? "Review challenges, inspect evidence, and decide whether a question needs correction." : "Track your submitted question challenges and read the administrator's response."}</p></div></section>
    {isAdmin && <section className="report-stat-grid">{statuses.map((status) => <article className="report-stat-card" key={status}><span>{status}</span><b>{reports.filter((report) => report.status === status).length}</b></article>)}</section>}
    {!sortedReports.length ? <EmptyState icon={<Flag size={26} />} text={isAdmin ? "There are no question reports yet." : "You have not submitted any question reports yet."} /> : <div className="question-report-layout">
      <section className="question-report-list" aria-label={isAdmin ? "All question reports" : "Your question reports"}>
        {sortedReports.map((report) => <button key={report.id} className={`question-report-list-item ${selected?.id === report.id ? "report-selected" : ""}`} onClick={() => setSelectedId(report.id)}>
          <span className={`report-status status-${report.status.toLowerCase().replace(/ /g, "-")}`}>{report.status}</span>
          <b><MathContent text={report.questionText} /></b>
          <span>{report.examName} · {report.sectionName} · {report.chapterName}</span>
          {isAdmin && <span>{report.studentName} · ID {report.studentId}</span>}
          <small>{dateText(report.submittedAt)} · Report {report.id}</small>
        </button>)}
      </section>
      {selected && <article className="question-report-detail">
        <header className="report-detail-header"><div><span className="eyebrow">REPORT {selected.id}</span><h2>{selected.examName} · {selected.sectionName}</h2><p>{selected.chapterName} · Submitted {dateText(selected.submittedAt)}</p></div><span className={`report-status status-${selected.status.toLowerCase().replace(/ /g, "-")}`}>{selected.status}</span></header>
        <div className="report-detail-grid">
          <section className="report-detail-block"><h3>Original Question</h3><p className="report-original-question"><MathContent text={selected.questionText} /></p>
            <h4>Current Options</h4><ol className="report-options">{getQuestionOptionKeys({ options: currentOptions ?? {} }).map((answer) => <li key={answer}><b>{answer}.</b> <MathContent text={currentOptions?.[answer] ?? "Unavailable"} /></li>)}</ol>
            {isAdmin && <><h4>Current Correct Answer</h4><p>{currentQuestion?.correctAnswer ?? "Not available"}</p><h4>Current Explanation</h4>{currentQuestion?.explanation ? <MathContent className="solution-content" text={currentQuestion.explanation} /> : <p>No explanation is currently recorded.</p>}
              {currentQuestion && <button className="button button-outline" onClick={() => onEditQuestion(selected, currentQuestion)}>Edit Question</button>}
            </>}
          </section>
          <section className="report-detail-block"><h3>Student's Report</h3>
            {isAdmin && <p className="report-student-name">{selected.studentName} · ID {selected.studentId}</p>}
            <h4>Reason</h4><p className="report-preserve-text">{selected.reason}</p>
            <h4>Student's Explanation</h4>{selected.studentExplanation ? <MathContent className="solution-content" text={selected.studentExplanation} /> : <p>No explanation provided.</p>}
            <h4>Uploaded Photo</h4>{selected.evidencePath || selected.evidenceDataUrl
              ? <><button className="button button-quiet" onClick={() => void viewEvidence()} disabled={busy}>{busy ? "Opening evidence…" : "View Image"}</button>{imageUrl && <a className="report-evidence-link" href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt="Student-provided evidence" />Open full-size image</a>}</>
              : <p>No image evidence was uploaded.</p>}
          </section>
        </div>
        {!isAdmin && <section className="report-response"><h3>Report Status: {selected.status}</h3><p>{selected.adminResponse || "The administrator has not added a response yet."}</p></section>}
        {isAdmin && <>
          <section className="report-review-actions"><label className="form-label">Response to student <span className="optional">(optional)</span><textarea rows={3} maxLength={2000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Write a short response visible to this student." /></label>
            <div><button className="button button-outline" disabled={busy} onClick={() => void updateStatus("Under Review")}>Under Review</button><button className="button button-outline" disabled={busy} onClick={() => void updateStatus("Accepted")}>Accept Report</button><button className="button button-quiet" disabled={busy} onClick={() => void updateStatus("Rejected")}>Reject Report</button><button className="button button-primary" disabled={busy} onClick={() => void updateStatus("Resolved")}>Resolve Report</button></div>
          </section>
          {history.length > 0 && <section className="report-history"><h3>Question Change History</h3>{history.map((change) => <article key={change.id}><b>{dateText(change.changedAt)} · {change.adminName || "Administrator"}</b><small>Related report {change.relatedReportId}</small><div><span>Previous answer: {change.previous.correctAnswer}</span><span>New answer: {change.next.correctAnswer}</span></div><p>Previous question: <MathContent text={change.previous.question} /></p><p>Updated question: <MathContent text={change.next.question} /></p><p>Previous options: {JSON.stringify(change.previous.options)}</p><p>Updated options: {JSON.stringify(change.next.options)}</p><p>Previous explanation: <MathContent text={change.previous.explanation || "None"} /></p><p>Updated explanation: <MathContent text={change.next.explanation || "None"} /></p></article>)}</section>}
        </>}
      </article>}
    </div>}
  </div>;
}

function AdminCategoriesPanel({ categories, loading, error, onRetry, onSave, onDelete }: {
  categories: ExamCategory[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSave: (input: Pick<ExamCategory, "name" | "description" | "active">, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<ExamCategory | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  function resetForm() {
    setEditing(null);
    setName("");
    setDescription("");
    setActive(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await onSave({ name, description, active }, editing?.id);
      resetForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save exam category.");
    } finally {
      setBusy(false);
    }
  }

  async function updateCategory(category: ExamCategory, patch: Pick<ExamCategory, "name" | "description" | "active">) {
    setBusy(true);
    setActionError("");
    try {
      await onSave(patch, category.id);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not update exam category.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(category: ExamCategory) {
    if (!window.confirm(`Delete the "${category.name}" category?`)) return;
    setBusy(true);
    setActionError("");
    try {
      await onDelete(category.id);
      if (editing?.id === category.id) resetForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete exam category.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-stack admin-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><GraduationCap size={14} /> STUDENT PORTAL</span><h1>Exam Categories</h1><p>Create and manage the categories shown to students before sign-in.</p></div></section>
    {(error || actionError) && <div className="login-error" role="alert"><CircleHelp size={17} />{actionError || error}{error && !actionError && <button className="button button-outline" onClick={onRetry}>Try again</button>}</div>}
    <form className="question-stat-panel editor-form category-editor-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><h2>{editing ? "Edit category" : "Add category"}</h2><p>Inactive categories remain manageable here but are hidden from students.</p></div></div>
      <div className="category-form-fields">
        <label className="form-label">Category name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required placeholder="e.g. Teaching Exams" /></label>
        <label className="form-label">Description <span className="optional">(optional)</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Briefly describe the exam category" /></label>
        <label className="category-active-toggle"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active and visible to students</label>
      </div>
      <div className="category-form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add category"}</button>{editing && <button className="button button-outline" type="button" onClick={resetForm} disabled={busy}>Cancel</button>}</div>
    </form>
    <section className="question-stat-panel">
      <div className="section-heading"><div><h2>All categories</h2><p>{categories.length} {categories.length === 1 ? "category" : "categories"} configured</p></div></div>
      {loading ? <div className="category-loading" role="status">Loading categories…</div> : <div className="table-wrap"><table><thead><tr><th>Category</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {categories.map((category) => <tr key={category.id}>
          <td><b>{category.name}</b></td><td>{category.description || "—"}</td>
          <td><span className={`category-status ${category.active ? "category-status-active" : "category-status-inactive"}`}>{category.active ? "Active" : "Inactive"}</span></td>
          <td><div className="table-actions">
            <button type="button" disabled={busy} onClick={() => { setEditing(category); setName(category.name); setDescription(category.description); setActive(category.active); }}>Edit</button>
            <button type="button" disabled={busy} onClick={() => void updateCategory(category, { name: category.name, description: category.description, active: !category.active })}>{category.active ? "Deactivate" : "Activate"}</button>
            <button type="button" className="delete-action" disabled={busy} aria-label={`Delete ${category.name}`} onClick={() => void removeCategory(category)}><Trash2 size={16} /></button>
          </div></td>
        </tr>)}
        {!categories.length && <tr><td colSpan={4} className="table-empty">No categories have been created.</td></tr>}
      </tbody></table></div>}
    </section>
  </div>;
}

function AdminExamsPanel({ categories, exams, quizExams, loading, error, onRetry, onSave, onDelete }: {
  categories: ExamCategory[];
  exams: PlatformExam[];
  quizExams: Exam[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSave: (input: Pick<PlatformExam, "categoryId" | "name" | "description" | "active" | "quizExamId">, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<PlatformExam | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [quizExamId, setQuizExamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!categories.some((category) => category.id === categoryId) && categories[0]) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  function resetForm() {
    setEditing(null);
    setCategoryId(categories[0]?.id ?? "");
    setName("");
    setDescription("");
    setActive(true);
    setQuizExamId("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    try {
      await onSave({ categoryId, name, description, active, quizExamId }, editing?.id);
      resetForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save exam.");
    } finally {
      setBusy(false);
    }
  }

  async function updateExam(exam: PlatformExam, patch: Pick<PlatformExam, "categoryId" | "name" | "description" | "active" | "quizExamId">) {
    setBusy(true);
    setActionError("");
    try {
      await onSave(patch, exam.id);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not update exam.");
    } finally {
      setBusy(false);
    }
  }

  async function removeExam(exam: PlatformExam) {
    if (!window.confirm(`Delete "${exam.name}" from the exam catalog?`)) return;
    setBusy(true);
    setActionError("");
    try {
      await onDelete(exam.id);
      if (editing?.id === exam.id) resetForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete exam.");
    } finally {
      setBusy(false);
    }
  }

  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name ?? "Category unavailable";
  const statusMessage = actionError || error;
  return <div className="page-stack admin-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><BookOpen size={14} /> STUDENT PORTAL</span><h1>Exam Management</h1><p>Add exams to a category and optionally connect an existing quiz bank.</p></div></section>
    {statusMessage && <div className="login-error" role="alert"><CircleHelp size={17} />{statusMessage}{error && !actionError && <button className="button button-outline" onClick={onRetry}>Try again</button>}</div>}
    {!categories.length && !loading && <div className="category-loading">Create an exam category before adding exams.</div>}
    <form className="question-stat-panel editor-form category-editor-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><h2>{editing ? "Edit exam" : "Add exam"}</h2><p>Only active exams in active categories appear in the Student Portal.</p></div></div>
      <div className="category-form-fields">
        <label className="form-label">Exam name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required placeholder="e.g. National Entrance Exam" /></label>
        <label className="form-label">Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
          <option value="" disabled>Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? "" : " (Inactive)"}</option>)}
        </select></label>
        <label className="form-label">Description <span className="optional">(optional)</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="Brief exam description" /></label>
        <label className="form-label">Existing quiz bank <span className="optional">(optional)</span><select value={quizExamId} onChange={(event) => setQuizExamId(event.target.value)}>
          <option value="">No quiz bank linked</option>{quizExams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
        </select></label>
        <label className="category-active-toggle"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active and visible to students</label>
      </div>
      <div className="category-form-actions"><button className="button button-primary" type="submit" disabled={busy || !categories.length}>{busy ? "Saving…" : editing ? "Save changes" : "Add exam"}</button>{editing && <button className="button button-outline" type="button" onClick={resetForm} disabled={busy}>Cancel</button>}</div>
    </form>
    <section className="question-stat-panel">
      <div className="section-heading"><div><h2>All exams</h2><p>{exams.length} {exams.length === 1 ? "exam" : "exams"} configured</p></div></div>
      {loading ? <div className="category-loading" role="status">Loading exams…</div> : <div className="table-wrap"><table><thead><tr><th>Exam</th><th>Category</th><th>Quiz bank</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {exams.map((exam) => <tr key={exam.id}>
          <td><b>{exam.name}</b>{exam.description && <small className="exam-admin-description">{exam.description}</small>}</td>
          <td>{categoryName(exam.categoryId)}</td>
          <td>{quizExams.find((item) => item.id === exam.quizExamId)?.name ?? "Not linked"}</td>
          <td><span className={`category-status ${exam.active ? "category-status-active" : "category-status-inactive"}`}>{exam.active ? "Active" : "Inactive"}</span></td>
          <td><div className="table-actions">
            <button type="button" disabled={busy} onClick={() => { setEditing(exam); setCategoryId(exam.categoryId); setName(exam.name); setDescription(exam.description); setActive(exam.active); setQuizExamId(exam.quizExamId ?? ""); }}>Edit</button>
            <button type="button" disabled={busy} onClick={() => void updateExam(exam, { categoryId: exam.categoryId, name: exam.name, description: exam.description, active: !exam.active, quizExamId: exam.quizExamId ?? "" })}>{exam.active ? "Deactivate" : "Activate"}</button>
            <button type="button" className="delete-action" disabled={busy} aria-label={`Delete ${exam.name}`} onClick={() => void removeExam(exam)}><Trash2 size={16} /></button>
          </div></td>
        </tr>)}
        {!exams.length && <tr><td colSpan={5} className="table-empty">No exams have been created.</td></tr>}
      </tbody></table></div>}
    </section>
  </div>;
}

function AdminSubjectsPanel({ exams, selectedExamId, onSelectExam, subjects, chapters, loading, error, onRetry, onSaveSubject, onDeleteSubject, onSaveChapter, onDeleteChapter }: {
  exams: PlatformExam[];
  selectedExamId: string;
  onSelectExam: (id: string) => void;
  subjects: PlatformSubject[];
  chapters: PlatformChapter[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSaveSubject: (input: Pick<PlatformSubject, "examId" | "name">, id?: string) => Promise<void>;
  onDeleteSubject: (id: string) => Promise<void>;
  onSaveChapter: (input: Pick<PlatformChapter, "subjectId" | "name">, id?: string) => Promise<void>;
  onDeleteChapter: (id: string) => Promise<void>;
}) {
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [editingSubject, setEditingSubject] = useState<PlatformSubject | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [editingChapter, setEditingChapter] = useState<PlatformChapter | null>(null);
  const [chapterName, setChapterName] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId);

  useEffect(() => {
    if (!subjects.some((subject) => subject.id === selectedSubjectId)) setSelectedSubjectId(subjects[0]?.id ?? "");
  }, [selectedSubjectId, subjects]);

  function resetSubjectForm() {
    setEditingSubject(null);
    setSubjectName("");
  }
  function resetChapterForm() {
    setEditingChapter(null);
    setChapterName("");
  }
  async function submitSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedExamId) return;
    setBusy(true);
    setActionError("");
    try {
      await onSaveSubject({ examId: selectedExamId, name: subjectName }, editingSubject?.id);
      resetSubjectForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save subject.");
    } finally {
      setBusy(false);
    }
  }
  async function removeSubject(subject: PlatformSubject) {
    if (!window.confirm(`Delete "${subject.name}" and all of its chapters?`)) return;
    setBusy(true);
    setActionError("");
    try {
      await onDeleteSubject(subject.id);
      if (editingSubject?.id === subject.id) resetSubjectForm();
      if (selectedSubjectId === subject.id) setSelectedSubjectId("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete subject.");
    } finally {
      setBusy(false);
    }
  }
  async function submitChapter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSubject) return;
    setBusy(true);
    setActionError("");
    try {
      await onSaveChapter({ subjectId: selectedSubject.id, name: chapterName }, editingChapter?.id);
      resetChapterForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save chapter.");
    } finally {
      setBusy(false);
    }
  }
  async function removeChapter(chapter: PlatformChapter) {
    if (!window.confirm(`Delete the "${chapter.name}" chapter?`)) return;
    setBusy(true);
    setActionError("");
    try {
      await onDeleteChapter(chapter.id);
      if (editingChapter?.id === chapter.id) resetChapterForm();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete chapter.");
    } finally {
      setBusy(false);
    }
  }

  const selectedExam = exams.find((exam) => exam.id === selectedExamId);
  const subjectChapters = chapters.filter((chapter) => chapter.subjectId === selectedSubjectId);
  return <div className="page-stack admin-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><Layers3 size={14} /> CONTENT MANAGEMENT</span><h1>Subjects &amp; Chapters</h1><p>Organize each exam into dynamic subjects and chapters for students.</p></div></section>
    {(error || actionError) && <div className="login-error" role="alert"><CircleHelp size={17} />{actionError || error}{error && !actionError && <button className="button button-outline" onClick={onRetry}>Try again</button>}</div>}
    <section className="question-stat-panel subject-admin-panel">
      <label className="form-label">Exam<select value={selectedExamId} onChange={(event) => {
        onSelectExam(event.target.value);
        setSelectedSubjectId("");
        resetSubjectForm();
        resetChapterForm();
      }} required>
        <option value="" disabled>Select an exam</option>
        {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
      </select></label>
      {!exams.length && <p className="table-empty">Create an exam before adding subjects.</p>}
    </section>
    {selectedExam && <>
      <form className="question-stat-panel editor-form category-editor-form" onSubmit={(event) => void submitSubject(event)}>
        <div className="section-heading"><div><h2>{editingSubject ? "Edit subject" : "Add subject"}</h2><p>Subjects belong to {selectedExam.name}.</p></div></div>
        <label className="form-label">Subject name<input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} minLength={2} maxLength={100} required placeholder="e.g. Mathematics" /></label>
        <div className="category-form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editingSubject ? "Save changes" : "Add subject"}</button>{editingSubject && <button className="button button-outline" type="button" onClick={resetSubjectForm} disabled={busy}>Cancel</button>}</div>
      </form>
      <section className="question-stat-panel subject-admin-panel">
        <div className="section-heading"><div><h2>{selectedExam.name} subjects</h2><p>{subjects.length} configured</p></div></div>
        {loading ? <div className="category-loading" role="status">Loading subjects and chapters…</div> : <div className="table-wrap"><table><thead><tr><th>Subject</th><th>Chapters</th><th>Actions</th></tr></thead><tbody>
          {subjects.map((subject) => <tr key={subject.id} className={subject.id === selectedSubjectId ? "subject-admin-selected" : ""}>
            <td><button className="subject-admin-select" type="button" onClick={() => { setSelectedSubjectId(subject.id); resetChapterForm(); }}>{subject.name}</button></td>
            <td>{chapters.filter((chapter) => chapter.subjectId === subject.id).length}</td>
            <td><div className="table-actions">
              <button type="button" disabled={busy} onClick={() => { setSelectedSubjectId(subject.id); setEditingSubject(subject); setSubjectName(subject.name); }}>Edit</button>
              <button type="button" disabled={busy} onClick={() => { setSelectedSubjectId(subject.id); resetChapterForm(); }}>Manage chapters</button>
              <button type="button" className="delete-action" disabled={busy} aria-label={`Delete ${subject.name}`} onClick={() => void removeSubject(subject)}><Trash2 size={16} /></button>
            </div></td>
          </tr>)}
          {!subjects.length && <tr><td colSpan={3} className="table-empty">No subjects have been created for this exam.</td></tr>}
        </tbody></table></div>}
      </section>
      {selectedSubject && <section className="question-stat-panel subject-admin-panel">
        <div className="section-heading"><div><h2>{selectedSubject.name} chapters</h2><p>Chapters are scoped to this subject.</p></div></div>
        <form className="chapter-admin-form" onSubmit={(event) => void submitChapter(event)}>
          <label className="form-label">Chapter name<input value={chapterName} onChange={(event) => setChapterName(event.target.value)} minLength={2} maxLength={100} required placeholder="e.g. Number Systems" /></label>
          <div className="category-form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editingChapter ? "Save changes" : "Add chapter"}</button>{editingChapter && <button className="button button-outline" type="button" onClick={resetChapterForm} disabled={busy}>Cancel</button>}</div>
        </form>
        <div className="table-wrap"><table><thead><tr><th>Chapter</th><th>Actions</th></tr></thead><tbody>
          {subjectChapters.map((chapter) => <tr key={chapter.id}>
            <td><b>{chapter.name}</b></td><td><div className="table-actions">
              <button type="button" disabled={busy} onClick={() => { setEditingChapter(chapter); setChapterName(chapter.name); }}>Edit</button>
              <button type="button" className="delete-action" disabled={busy} aria-label={`Delete ${chapter.name}`} onClick={() => void removeChapter(chapter)}><Trash2 size={16} /></button>
            </div></td>
          </tr>)}
          {!subjectChapters.length && <tr><td colSpan={2} className="table-empty">No chapters have been created for this subject.</td></tr>}
        </tbody></table></div>
      </section>}
    </>}
  </div>;
}

function CreateStudentPanel({ onCreate }: { onCreate: (input: StudentAccountInput) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{ name: string; studentId: string; password: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const input: StudentAccountInput = {
      name: String(data.get("name")).trim(),
      studentId: String(data.get("studentId")).trim(),
      password: String(data.get("password")),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
    };
    setSaving(true);
    setError("");
    try {
      await onCreate(input);
      setCredentials({ name: input.name, studentId: input.studentId, password: input.password ?? "" });
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create student account.");
    } finally {
      setSaving(false);
    }
  }
  return <div className="page-stack admin-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><UserRound size={14} /> STUDENT ACCESS</span><h1>Create Student Account</h1><p>Create an individual account, then share its ID and password directly with the student.</p></div></section>
    {credentials && <section className="created-credentials"><div><Check size={19} /><b>Student account created</b></div><p>Copy these credentials now. The password is not saved in the student list and cannot be retrieved later.</p><dl><dt>Student Name</dt><dd>{credentials.name}</dd><dt>Student ID</dt><dd>{credentials.studentId}</dd><dt>Password</dt><dd>{credentials.password}</dd></dl><button className="text-button" onClick={() => setCredentials(null)}>Dismiss credentials</button></section>}
    {error && <div className="login-error">{error}</div>}
    <form className="question-stat-panel editor-form student-create-form" onSubmit={(event) => void submit(event)}>
      <h2>Account details</h2>
      <Field label="Student Name" name="name" placeholder="e.g. Rahul Kumar" required />
      <Field label="Student ID" name="studentId" placeholder="e.g. MBA001" required />
      <Field label="Password" name="password" type="password" placeholder="At least 8 characters" minLength={8} required autoComplete="new-password" />
      <Field label="Email (optional)" name="email" type="email" placeholder="student@example.com" />
      <Field label="Phone Number (optional)" name="phone" type="tel" placeholder="+91 98765 43210" />
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Creating account…" : "Create Student Account"}</button>
    </form>
  </div>;
}

function StudentsPanel({ students, attempts, exams, questions, onUpdate, onResetPassword, onSetDisabled, onDelete }: {
  students: UserProfile[];
  attempts: (Attempt & { userId: string })[];
  exams: Exam[];
  questions: Question[];
  onUpdate: (uid: string, input: StudentAccountInput) => Promise<void>;
  onResetPassword: (uid: string, password: string) => Promise<void>;
  onSetDisabled: (uid: string, disabled: boolean) => Promise<void>;
  onDelete: (uid: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<{ student: UserProfile; mode: "edit" | "reset" } | null>(null);
  const [error, setError] = useState("");
  const [busyUid, setBusyUid] = useState("");
  const [search, setSearch] = useState("");
  const activeCount = students.filter((student) => student.status !== "disabled" && dateValue(student.lastLogin) !== null
    && Date.now() - (dateValue(student.lastLogin)?.getTime() ?? 0) < 30 * 24 * 60 * 60 * 1000).length;
  const shown = students.filter((student) => `${student.name} ${student.studentId ?? ""} ${student.email}`.toLowerCase().includes(search.toLowerCase()));
  async function runAction(uid: string, action: () => Promise<void>): Promise<boolean> {
    setBusyUid(uid);
    setError("");
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The student account action failed.");
      return false;
    } finally {
      setBusyUid("");
    }
  }
  return <div className="page-stack admin-page">
    <section className="section-heading page-title"><div><span className="eyebrow"><Users size={14} /> ACCOUNT OVERVIEW</span><h1>Manage Students</h1><p>Manage admin-created accounts. Passwords are never displayed in this list.</p></div><span className="soft-badge">{students.length} registered</span></section>
    <div className="admin-stat-grid"><StatCard icon={<Users />} label="Total students" value={students.length} caption="student accounts" tone="purple" /><StatCard icon={<UserRound />} label="Active students" value={activeCount} caption="logged in within 30 days" tone="blue" /><StatCard icon={<ClipboardList />} label="Questions attempted" value={attempts.length} caption="recorded answers" tone="orange" /><StatCard icon={<Check />} label="Correct answers" value={attempts.filter((attempt) => attempt.isCorrect).length} caption={`${attempts.filter((attempt) => !attempt.isCorrect).length} wrong`} tone="green" /></div>
    {error && <div className="login-error">{error}</div>}
    <SearchBox value={search} onChange={setSearch} placeholder="Search students by name, ID or email…" />
    <div className="table-wrap student-table"><table><thead><tr><th>Student</th><th>Email</th><th>Created</th><th>Last login</th><th>Attempted</th><th>Correct</th><th>Wrong</th><th>Accuracy</th><th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map((student) => {
      const activity = attempts.filter((attempt) => attempt.userId === student.uid);
      const right = activity.filter((attempt) => attempt.isCorrect).length;
      const wrong = activity.length - right;
      return <tr key={student.uid}>
        <td><b>{student.name || "Student"}</b><small>ID: {student.studentId || "Not assigned"}</small>{exams.map((exam) => {
          const examQuestions = questions.filter((question) => question.examId === exam.id);
          const attempted = new Set(activity.filter((attempt) => attempt.examId === exam.id).map((attempt) => attempt.questionId)).size;
          return <small key={exam.id}>{exam.name}: {percent(attempted, examQuestions.length)}% complete</small>;
        })}</td>
        <td>{student.email || "—"}{student.phone && <small>{student.phone}</small>}</td><td>{dateText(student.createdAt)}</td><td>{dateText(student.lastLogin)}</td>
        <td>{activity.length}</td><td>{right}</td><td>{wrong}</td><td>{percent(right, activity.length)}%</td>
        <td><span className={`status-pill ${student.status === "disabled" ? "status-wrong" : "status-correct"}`}>{student.status === "disabled" ? "Disabled" : "Active"}</span></td>
        <td><div className="student-actions">
          <button disabled={Boolean(busyUid)} onClick={() => setSelected({ student, mode: "edit" })}>Edit</button>
          <button disabled={Boolean(busyUid)} onClick={() => setSelected({ student, mode: "reset" })}>Reset password</button>
          <button disabled={Boolean(busyUid)} onClick={() => void runAction(student.uid, () => onSetDisabled(student.uid, student.status !== "disabled"))}>{student.status === "disabled" ? "Enable" : "Disable"}</button>
          <button className="delete-action" disabled={Boolean(busyUid)} onClick={() => {
            if (window.confirm(`Delete ${student.name}'s account and all saved progress? This cannot be undone.`)) {
              void runAction(student.uid, () => onDelete(student.uid));
            }
          }}>Delete</button>
        </div></td>
      </tr>;
    })}{!shown.length && <tr><td colSpan={10} className="table-empty">No student accounts match this search.</td></tr>}</tbody></table></div>
    {selected && <StudentAccountModal key={`${selected.student.uid}-${selected.mode}`} student={selected.student} mode={selected.mode}
      onClose={() => setSelected(null)}
      onSave={async (input) => {
       if (selected.mode === "edit") await onUpdate(selected.student.uid, input);
       else await onResetPassword(selected.student.uid, input.password ?? "");
       setSelected(null);
      }} />}
  </div>;
}

function StudentAccountModal({ student, mode, onClose, onSave }: {
  student: UserProfile; mode: "edit" | "reset"; onClose: () => void; onSave: (input: StudentAccountInput) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input: StudentAccountInput = mode === "edit" ? {
      name: String(values.get("name")).trim(),
      studentId: String(values.get("studentId")).trim(),
      email: String(values.get("email") ?? "").trim(),
      phone: String(values.get("phone") ?? "").trim(),
    } : {
      name: student.name,
      studentId: student.studentId ?? "",
      email: student.email ?? "",
      phone: student.phone ?? "",
      password: String(values.get("password")),
    };
    setSaving(true);
    setError("");
    try {
      await onSave(input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save student account.");
    } finally {
      setSaving(false);
    }
  }
  return <Modal onClose={onClose}><div className="editor-modal"><div className="modal-title"><div><span className="eyebrow">STUDENT ACCOUNT</span><h2>{mode === "edit" ? "Edit Student" : "Reset Password"}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    {error && <div className="login-error">{error}</div>}
    <form className="editor-form" onSubmit={(event) => void submit(event)}>
      {mode === "edit" ? <>
        <Field label="Student Name" name="name" value={student.name} required />
        <Field label="Student ID" name="studentId" value={student.studentId ?? ""} required />
        <Field label="Email (optional)" name="email" type="email" value={student.email ?? ""} />
        <Field label="Phone Number (optional)" name="phone" type="tel" value={student.phone ?? ""} />
        <p className="form-hint">Leave credentials out of this form; use Reset password to set a new password.</p>
      </> : <><p>Set a new password for {student.name}. The old password cannot be viewed.</p><Field label="New Password" name="password" type="password" placeholder="At least 8 characters" minLength={8} required autoComplete="new-password" /></>}
      <div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : mode === "edit" ? "Save changes" : "Reset password"}</button></div>
    </form>
  </div></Modal>;
}

function SettingsPanel({ settings, exams, sections, onSave }: {
  settings: SiteSettings; exams: Exam[]; sections: Section[]; onSave: (settings: SiteSettings) => void;
}) {
  const [activeTab, setActiveTab] = useState<"general" | "api-keys">("general");
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const toggle = (key: "hiddenExamIds" | "hiddenSectionIds", id: string) => setDraft((current) => ({
    ...current,
    [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id],
  }));

  return <div className="page-stack settings-page">
    <section className="section-heading page-title">
      <div>
        <span className="eyebrow"><Settings size={14} /> ADMIN SETTINGS</span>
        <h1>Customize Website &amp; AI Keys</h1>
        <p>Manage general website settings, AI providers, and encrypted API keys.</p>
      </div>
      {activeTab === "general" && (
        <button className="button button-primary" type="button" onClick={() => onSave(draft)}>
          Save settings
        </button>
      )}
    </section>

    <div className="settings-tabs-bar">
      <button
        type="button"
        className={`settings-tab-btn ${activeTab === "general" ? "tab-active" : ""}`}
        onClick={() => setActiveTab("general")}
      >
        <Settings size={16} /> General &amp; Visibility
      </button>
      <button
        type="button"
        className={`settings-tab-btn ${activeTab === "api-keys" ? "tab-active" : ""}`}
        onClick={() => setActiveTab("api-keys")}
      >
        <Key size={16} /> AI Providers &amp; Encrypted API Keys
      </button>
    </div>

    {activeTab === "general" ? (
      <form className="settings-content-stack" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
        <section className="settings-card">
          <h2>Brand and welcome</h2>
          <p>These choices only affect the presentation shown to students.</p>
          <Field label="Website name" name="siteTitle" value={draft.title} onChange={(title) => setDraft({ ...draft, title: title.slice(0, 60) })} required />
          <label className="form-label">Welcome message<textarea rows={3} maxLength={240} value={draft.welcomeMessage} onChange={(event) => setDraft({ ...draft, welcomeMessage: event.target.value })} /></label>
          <Field label="Logo image URL (HTTPS)" name="logoUrl" value={draft.logoUrl} placeholder="https://example.com/logo.png" onChange={(logoUrl) => setDraft({ ...draft, logoUrl })} />
          {draft.logoUrl && <img className="settings-logo-preview" src={draft.logoUrl} alt="Logo preview" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
          <label className="form-label">Theme color<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as SiteSettings["theme"] })}>{["violet", "blue", "green", "orange"].map((theme) => <option key={theme}>{theme}</option>)}</select></label>
        </section>
        <section className="settings-card">
          <h2>Exam visibility</h2>
          <p>Hidden exams remain stored and editable by the admin; they are simply removed from the student exam picker.</p>
          <div className="visibility-list">{exams.map((exam) => <label key={exam.id}><input type="checkbox" checked={!draft.hiddenExamIds.includes(exam.id)} onChange={() => toggle("hiddenExamIds", exam.id)} /><span><b>{exam.name}</b><small>{exam.tagline}</small></span><span className={`visibility-tag ${draft.hiddenExamIds.includes(exam.id) ? "visibility-hidden" : ""}`}>{draft.hiddenExamIds.includes(exam.id) ? "Hidden" : "Visible"}</span></label>)}</div>
        </section>
        <section className="settings-card">
          <h2>Subject / section visibility</h2>
          <p>Hide a section from student navigation without deleting its chapters, questions or progress.</p>
          <div className="visibility-list">{sections.map((section) => <label key={section.id}><input type="checkbox" checked={!draft.hiddenSectionIds.includes(section.id)} onChange={() => toggle("hiddenSectionIds", section.id)} /><span><b>{section.name}</b><small>{exams.find((exam) => exam.id === section.examId)?.name}</small></span><span className={`visibility-tag ${draft.hiddenSectionIds.includes(section.id) ? "visibility-hidden" : ""}`}>{draft.hiddenSectionIds.includes(section.id) ? "Hidden" : "Visible"}</span></label>)}</div>
        </section>
        <button className="button button-primary settings-save-bottom" type="submit">Save settings</button>
      </form>
    ) : (
      <div className="settings-content-stack">
        <ApiKeyManager />
      </div>
    )}
  </div>;
}

function DeleteQuestionsPanel({
  exams,
  sections,
  questions,
  onDeleteQuestion,
  onDeleteBatch,
  onDeleteAllGlobal,
}: {
  exams: Exam[];
  sections: Section[];
  questions: Question[];
  onDeleteQuestion: (questionId: string) => Promise<void>;
  onDeleteBatch: (questionIds: string[]) => Promise<void>;
  onDeleteAllGlobal: () => Promise<void>;
}) {
  const [selectedExamId, setSelectedExamId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    count: number;
    action: () => Promise<void>;
  } | null>(null);

  const filteredExams = useMemo(() => {
    return selectedExamId === "all" ? exams : exams.filter((e) => e.id === selectedExamId);
  }, [exams, selectedExamId]);

  const getSectionQuestions = useCallback(
    (section: Section) => {
      return questions.filter((q) => {
        const matchesSection = q.sectionId === section.id || (!q.sectionId && q.examId === section.examId);
        if (!matchesSection) return false;
        if (!search.trim()) return true;
        const lower = search.toLowerCase();
        return (
          q.question.toLowerCase().includes(lower) ||
          (q.topic && q.topic.toLowerCase().includes(lower)) ||
          (q.subTopic && q.subTopic.toLowerCase().includes(lower)) ||
          (q.year && String(q.year).includes(lower))
        );
      });
    },
    [questions, search]
  );

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const isCollapsed = (sectionId: string) => Boolean(collapsedSections[sectionId]);

  const toggleSelectAll = (sectionId: string, sectionQuestions: Question[]) => {
    const current = selectedQuestionIds[sectionId] || [];
    if (current.length === sectionQuestions.length) {
      setSelectedQuestionIds((prev) => ({ ...prev, [sectionId]: [] }));
    } else {
      setSelectedQuestionIds((prev) => ({ ...prev, [sectionId]: sectionQuestions.map((q) => q.id) }));
    }
  };

  const toggleQuestionSelection = (sectionId: string, qId: string) => {
    const current = selectedQuestionIds[sectionId] || [];
    if (current.includes(qId)) {
      setSelectedQuestionIds((prev) => ({ ...prev, [sectionId]: current.filter((id) => id !== qId) }));
    } else {
      setSelectedQuestionIds((prev) => ({ ...prev, [sectionId]: [...current, qId] }));
    }
  };

  const handleDeleteSingle = (q: Question, sectionName: string) => {
    setConfirmDialog({
      open: true,
      title: "Delete this question?",
      description: `Are you sure you want to permanently delete Question #${q.question_number || ""} from "${sectionName}"? This will remove it from the question bank and Firestore.`,
      count: 1,
      action: async () => {
        setBusy(true);
        try {
          await onDeleteQuestion(q.id);
        } finally {
          setBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleDeleteSelected = (section: Section) => {
    const ids = selectedQuestionIds[section.id] || [];
    if (!ids.length) return;
    setConfirmDialog({
      open: true,
      title: `Delete ${ids.length} selected question(s)?`,
      description: `Are you sure you want to permanently delete the ${ids.length} selected question(s) from "${section.name}"? This action cannot be undone.`,
      count: ids.length,
      action: async () => {
        setBusy(true);
        try {
          await onDeleteBatch(ids);
          setSelectedQuestionIds((prev) => ({ ...prev, [section.id]: [] }));
        } finally {
          setBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleDeleteAll = (section: Section, sectionQuestions: Question[]) => {
    if (!sectionQuestions.length) return;
    setConfirmDialog({
      open: true,
      title: `Delete ALL ${sectionQuestions.length} questions in ${section.name}?`,
      description: `WARNING: This will permanently delete all ${sectionQuestions.length} questions in "${section.name}" (${section.examId.toUpperCase()}) from the database and question bank. This cannot be undone.`,
      count: sectionQuestions.length,
      action: async () => {
        setBusy(true);
        try {
          await onDeleteBatch(sectionQuestions.map((q) => q.id));
          setSelectedQuestionIds((prev) => ({ ...prev, [section.id]: [] }));
        } finally {
          setBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const handleDeleteGlobalAll = () => {
    if (!questions.length) return;
    setConfirmDialog({
      open: true,
      title: "PERMANENT GLOBAL WIPE: Delete ALL questions from EVERYWHERE?",
      description: `EXTREME WARNING: This will permanently delete ALL ${questions.length} questions across ALL exams (CAT, CMAT, MAT, XAT) and categories from Firebase Firestore, extracted papers, browser storage, and student portals. This cannot be undone!`,
      count: questions.length,
      action: async () => {
        setBusy(true);
        try {
          await onDeleteAllGlobal();
          setSelectedQuestionIds({});
        } finally {
          setBusy(false);
          setConfirmDialog(null);
        }
      },
    });
  };

  const totalFilteredQuestions = useMemo(() => {
    let count = 0;
    for (const exam of filteredExams) {
      const examSecs = sections.filter((s) => s.examId === exam.id);
      for (const s of examSecs) {
        count += getSectionQuestions(s).length;
      }
    }
    return count;
  }, [filteredExams, sections, getSectionQuestions]);

  return (
    <div className="page-stack admin-page delete-questions-manager">
      <section className="section-heading page-title">
        <div>
          <span className="eyebrow text-red-500 flex items-center gap-1.5">
            <Trash2 size={13} /> DANGER ZONE &amp; CLEANUP
          </span>
          <h1>Section-Wise Question Manager</h1>
          <p>
            Browse all questions grouped by section. Delete questions one-by-one, select multiple questions in bulk, or wipe entire sections permanently.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="soft-badge">
            <b>{totalFilteredQuestions}</b> questions shown
          </span>
          {questions.length > 0 && (
            <button
              type="button"
              className="button button-danger flex items-center gap-1.5 text-xs py-2 px-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-sm transition-all"
              onClick={handleDeleteGlobalAll}
            >
              <Trash2 size={13} /> Delete All Questions Everywhere
            </button>
          )}
        </div>
      </section>

      {/* Exam filter tabs & Search */}
      <div className="delete-manager-controls flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedExamId === "all"
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
            onClick={() => setSelectedExamId("all")}
          >
            All Exams ({questions.length})
          </button>
          {exams.map((exam) => {
            const examQCount = questions.filter((q) => q.examId === exam.id).length;
            const isSelected = selectedExamId === exam.id;
            return (
              <button
                key={exam.id}
                type="button"
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isSelected
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
                onClick={() => setSelectedExamId(exam.id)}
              >
                {exam.name} ({examQCount})
              </button>
            );
          })}
        </div>

        <div className="w-full sm:w-72">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search questions by text or chapter…"
          />
        </div>
      </div>

      {/* Sections List */}
      <div className="space-y-6 mt-4">
        {filteredExams.map((exam) => {
          const examSectionsList = sections.filter((s) => s.examId === exam.id);
          const examQuestionsTotal = questions.filter((q) => q.examId === exam.id).length;

          return (
            <div key={exam.id} className="space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                <span className={`mini-exam-icon mini-${exam.color} text-xs font-bold`}>
                  {exam.name.slice(0, 1)}
                </span>
                <h2 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 m-0">
                  {exam.name} Exam
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  ({examQuestionsTotal} questions total across {examSectionsList.length} sections)
                </span>
              </div>

              <div className="space-y-4">
                {examSectionsList.map((section) => {
                  const sectionQuestions = getSectionQuestions(section);
                  const selectedIds = selectedQuestionIds[section.id] || [];
                  const allSelected = sectionQuestions.length > 0 && selectedIds.length === sectionQuestions.length;
                  const someSelected = selectedIds.length > 0;
                  const collapsed = isCollapsed(section.id);

                  return (
                    <article
                      key={section.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-sm overflow-hidden transition-colors"
                    >
                      {/* Section Card Header */}
                      <div className="p-4 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800/80">
                        <div
                          className="flex items-center gap-3 cursor-pointer select-none"
                          onClick={() => toggleSection(section.id)}
                        >
                          <button
                            type="button"
                            className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            aria-label={collapsed ? "Expand section" : "Collapse section"}
                          >
                            <ChevronDown
                              size={18}
                              className={`transition-transform duration-200 ${collapsed ? "-rotate-90" : "rotate-0"}`}
                            />
                          </button>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 m-0">
                                {section.name}
                              </h3>
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50">
                                {exam.name}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {sectionQuestions.length} question{sectionQuestions.length !== 1 ? "s" : ""}
                              {someSelected ? ` · ${selectedIds.length} selected` : ""}
                            </span>
                          </div>
                        </div>

                        {/* Section Action Controls */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {sectionQuestions.length > 0 && (
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer px-2.5 py-1 rounded hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => toggleSelectAll(section.id, sectionQuestions)}
                                className="rounded text-indigo-600 focus:ring-indigo-500"
                              />
                              <span>Select All ({sectionQuestions.length})</span>
                            </label>
                          )}

                          {someSelected && (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors flex items-center gap-1.5"
                              disabled={busy}
                              onClick={() => handleDeleteSelected(section)}
                            >
                              <Trash2 size={13} />
                              Delete Selected ({selectedIds.length})
                            </button>
                          )}

                          {sectionQuestions.length > 0 && (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 shadow-sm transition-colors flex items-center gap-1.5"
                              disabled={busy}
                              onClick={() => handleDeleteAll(section, sectionQuestions)}
                              title="Delete all questions in this section permanently"
                            >
                              <Trash2 size={13} />
                              Delete All ({sectionQuestions.length})
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Section Questions Body */}
                      {!collapsed && (
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 p-0">
                          {sectionQuestions.length === 0 ? (
                            <div className="p-8 text-center text-xs text-slate-400 dark:text-slate-500">
                              No questions found in this section{search ? " matching your search" : ""}.
                            </div>
                          ) : (
                            sectionQuestions.map((question, qIdx) => {
                              const isChecked = selectedIds.includes(question.id);
                              return (
                                <div
                                  key={question.id}
                                  className={`p-4 transition-colors flex items-start gap-3.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${
                                    isChecked ? "bg-indigo-50/30 dark:bg-indigo-950/20" : ""
                                  }`}
                                >
                                  {/* Checkbox */}
                                  <div className="pt-1">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => toggleQuestionSelection(section.id, question.id)}
                                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                                      aria-label={`Select question ${question.question_number || qIdx + 1}`}
                                    />
                                  </div>

                                  {/* Number Badge */}
                                  <span className="flex-none text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 mt-0.5">
                                    #{question.question_number || qIdx + 1}
                                  </span>

                                  {/* Question Content */}
                                  <div className="flex-1 min-w-0 space-y-2">
                                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                                      <MathContent text={question.question} />
                                    </div>

                                    {/* Graph / Diagram Viewer */}
                                    {question.imageUrl && (
                                      <div className="max-w-xs mt-1.5">
                                        <QuestionGraphViewer imageUrl={question.imageUrl} alt={question.imageAlt || "Question Graph"} />
                                      </div>
                                    )}

                                    {/* Options Preview */}
                                    {question.answerMode === "choice" && question.options && (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
                                        {(["A", "B", "C", "D", "E"] as const).map((optKey) => {
                                          const optText = (question.options as Record<string, string>)?.[optKey];
                                          if (!optText) return null;
                                          const isCorrect = question.correctAnswer?.toUpperCase() === optKey;
                                          return (
                                            <div
                                              key={optKey}
                                              className={`flex items-start gap-1.5 p-1.5 rounded border ${
                                                isCorrect
                                                  ? "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-semibold"
                                                  : "border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40"
                                              }`}
                                            >
                                              <span className="font-bold flex-none">{optKey}.</span>
                                              <span className="truncate"><MathContent text={optText} /></span>
                                              {isCorrect && <Check size={13} className="ml-auto text-emerald-500 flex-none" />}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Question Metadata Tags */}
                                    <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px] text-slate-400 dark:text-slate-500">
                                      {question.topic && (
                                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
                                          {question.topic}
                                        </span>
                                      )}
                                      {question.difficulty && (
                                        <span className={`px-2 py-0.5 rounded font-medium ${
                                          question.difficulty === "Easy"
                                            ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400"
                                            : question.difficulty === "Hard"
                                            ? "bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400"
                                            : "bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"
                                        }`}>
                                          {question.difficulty}
                                        </span>
                                      )}
                                      {question.year && (
                                        <span>
                                          Year: <b>{question.year}</b> {question.slot ? `(${question.slot})` : ""}
                                        </span>
                                      )}
                                      {question.paperTitle && (
                                        <span className="truncate max-w-[200px]" title={question.paperTitle}>
                                          Paper: {question.paperTitle}
                                        </span>
                                      )}
                                      {question.id.startsWith("firestore-") && (
                                        <span className="text-[10px] text-indigo-500 font-semibold">
                                          Firestore Cloud
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Individual Delete Action */}
                                  <div className="flex-none pt-0.5">
                                    <button
                                      type="button"
                                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                      title="Delete this question"
                                      disabled={busy}
                                      onClick={() => handleDeleteSingle(question, section.name)}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <Modal onClose={() => !busy && setConfirmDialog(null)}>
          <div className="editor-modal p-6 max-w-md w-full">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/60 flex items-center justify-center flex-none">
                <Trash2 size={20} />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 m-0">
                {confirmDialog.title}
              </h2>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
              {confirmDialog.description}
            </p>

            <div className="flex justify-end items-center gap-3">
              <button
                type="button"
                className="button button-quiet"
                disabled={busy}
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button bg-red-600 hover:bg-red-700 text-white font-bold"
                disabled={busy}
                onClick={() => void confirmDialog.action()}
              >
                {busy ? "Deleting…" : `Yes, Delete ${confirmDialog.count > 1 ? `(${confirmDialog.count})` : ""}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmptyState({ text, icon }: { text: string; icon?: ReactNode }) {
  return <div className="empty-state"><div>{icon ?? <BookOpen size={26} />}</div><p>{text}</p></div>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-box"><Search size={17} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function RandomSetup({ exams, currentExam, sections, questions, onBack, onStart }: {
  exams: Exam[]; currentExam: string; sections: Section[]; questions: Question[];
  onBack: () => void;
  onStart: (examId: string, section: string, count: number) => void;
}) {
  const [examId, setExamId] = useState(currentExam);
  const [section, setSection] = useState("");
  const [count, setCount] = useState(10);
  const examSections = sections.filter((item) => item.examId === examId);
  const questionCount = questions.filter((question) => question.examId === examId).length;
  const selectionCount = questions.filter((question) => question.examId === examId && (!section || question.sectionId === section)).length;
  const firestoreExam = ["cat", "cmat", "xat"].includes(examId);
  const selectionAvailable = Math.min(count, selectionCount);
  return <div className="random-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to exam dashboard</button>
    <section className="random-intro"><div className="random-illustration"><div className="random-ring" /><div className="random-icon"><Shuffle size={39} /></div><span>✦</span></div><span className="eyebrow">MIX IT UP</span><h1>Build a random quiz</h1><p>Sharpen your skills with a fresh mix of questions from your question bank.</p></section>
    <div className="random-setup-card"><div className="setup-header"><div><span className="step-number">01</span><h2>Customize your session</h2></div><span className="soft-badge">{questionCount ? `${questionCount} available` : firestoreExam ? "Loads from Firestore" : "0 available"}</span></div>
      <label className="form-label">Choose an exam <select value={examId} onChange={(event) => { setExamId(event.target.value); setSection(""); }}>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name} — {exam.tagline}</option>)}</select></label>
      <label className="form-label">Choose a section <select value={section} onChange={(event) => setSection(event.target.value)}><option value="">Any section</option>{examSections.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <div className="form-label">Number of questions <div className="count-options">{[10, 20, 30, 50].map((value) => <button key={value} className={count === value ? "count-selected" : ""} onClick={() => setCount(value)}>{value}</button>)}</div></div>
      <div className="quiz-summary"><div><ClipboardList size={17} /><span>Questions in this quiz</span><b>{selectionAvailable}</b></div><div><Clock3 size={17} /><span>Estimated time</span><b>~{Math.max(1, Math.ceil(selectionAvailable * 1.2))} min</b></div></div>
      <button className="button button-primary button-full" disabled={!selectionCount && !firestoreExam} onClick={() => onStart(examId, section, count)}><Shuffle size={16} /> Start random quiz <ArrowRight size={16} /></button>
    </div>
  </div>;
}

function QuizResult({ result, backLabel, onAgain, onWrong, onDashboard, onBack }: {
  result: QuizState; backLabel: string; onAgain: () => void; onWrong: () => void; onDashboard: () => void; onBack: () => void;
}) {
  const answered = result.questions.filter((question) => result.answers[question.id] !== undefined && result.answers[question.id] !== null);
  const correct = answered.filter((question) => isCorrectAnswer(question, result.answers[question.id] ?? "")).length;
  const wrong = answered.length - correct;
  const missed = result.questions.length - answered.length;
  const accuracy = percent(correct, answered.length);
  const incorrectQuestions = result.questions.filter((question) => result.answers[question.id] !== null && result.answers[question.id] !== undefined && !isCorrectAnswer(question, result.answers[question.id] ?? ""));
  return <div className="result-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button>
    <section className="result-hero"><div className="result-medal"><Award size={40} /></div><span className="eyebrow">SESSION COMPLETE</span><h1>Quiz results</h1><p>Nice work showing up for your preparation.</p><div className="score-circle"><div><b>{correct}<small>/{result.questions.length}</small></b><span>SCORE</span></div></div><div className="result-meter"><div><span style={{ width: `${accuracy}%` }} /></div><b>{accuracy}% accuracy</b></div></section>
    <div className="result-stats"><MiniStat label="Total questions" value={result.questions.length} /><MiniStat label="Attempted" value={answered.length} /><MiniStat label="Correct" value={correct} /><MiniStat label="Wrong" value={wrong} /><MiniStat label="Unattempted" value={missed} /><MiniStat label="Percentage" value={`${accuracy}%`} /></div>
    <section className="result-review"><div className="section-heading"><div><h2>Question review</h2><p>See the answer and outcome for every question.</p></div></div>{result.questions.map((question, index) => {
      const answer = result.answers[question.id];
      const isCorrect = answer !== null && answer !== undefined && isCorrectAnswer(question, answer);
      return <article className="review-row" key={`${question.id}-${index}`}><span className={`review-status ${answer === undefined || answer === null ? "review-skip" : isCorrect ? "review-good" : "review-bad"}`}>{answer === undefined || answer === null ? "—" : isCorrect ? <Check size={15} /> : <X size={15} />}</span><div><h3><MathContent text={question.question} /></h3>{question.imageUrl && <QuestionGraphViewer imageUrl={question.imageUrl} alt={question.imageAlt || "Question Graph"} />}<p>{answer === undefined || answer === null ? "Unattempted" : `Your answer: ${answer} · Correct answer: ${question.correctAnswer}`}</p>{question.explanation && <MathContent className="solution-content" text={question.explanation} />}</div><span className="status-pill">{answer === undefined || answer === null ? "Skipped" : isCorrect ? "Correct" : "Wrong"}</span></article>;
    })}</section>
    <div className="result-actions"><button className="button button-primary" onClick={onAgain}><Shuffle size={16} /> Practice again</button>{incorrectQuestions.length > 0 && <button className="button button-outline" onClick={onWrong}><Target size={16} /> Review wrong questions</button>}<button className="button button-quiet" onClick={onDashboard}>Back to exam dashboard</button></div>
  </div>;
}

function AdminPanel({ type, types, rows, exams, sections, chapters, questions, adminAttempts, students, search, setSearch, onTab, onAdd, onEdit, onDelete, onSeed, onAutoCategorize, onExit }: {
  type: EntityType; types: EntityType[]; rows: Entity[]; exams: Exam[]; sections: Section[]; chapters: Chapter[]; questions: Question[];
  adminAttempts: (Attempt & { userId: string })[]; students: UserProfile[];
  search: string; setSearch: (value: string) => void; onTab: (value: EntityType) => void; onAdd: () => void;
  onEdit: (item: Entity) => void; onDelete: (item: Entity) => void; onSeed: () => void;
  onAutoCategorize: (recategorizeAll: boolean) => void; onExit?: () => void;
}) {
  const [examFilter, setExamFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [chapterFilter, setChapterFilter] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const studentAttempts = adminAttempts.filter((attempt) => students.some((student) => student.uid === attempt.userId));
  const correctStudentAttempts = studentAttempts.filter((attempt) => attempt.isCorrect).length;
  const filtered = rows.filter((item) => {
    const label = type === "question" ? (item as Question).question : (item as Exam | Section | Chapter).name;
    if (!label.toLowerCase().includes(search.toLowerCase())) return false;
    if (type !== "question") return true;
    const q = item as Question;
    return (!examFilter || q.examId === examFilter)
      && (!sectionFilter || q.sectionId === sectionFilter)
      && (!chapterFilter || q.chapterId === chapterFilter)
      && (!difficulty || q.difficulty === difficulty);
  });
  return <div className="page-stack admin-page">
    {onExit && <button className="back-link" onClick={onExit}><ArrowLeft size={16} /> Back to exam selection</button>}
    <section className="section-heading page-title"><div><span className="eyebrow"><ShieldCheck size={13} /> CONTENT MANAGEMENT</span><h1>Admin dashboard</h1><p>Manage the exam catalog, sections, chapters and question bank.</p></div><button className="button button-primary" onClick={onAdd}>+ Add {type}</button></section>
    <div className="admin-welcome"><ShieldCheck size={18} /><span>Admin tools are available after signing in. Questions and settings are stored in this browser.</span><button className="text-button" onClick={onSeed}>Load sample bank</button></div>
    {type === "question" && <div className="classification-toolbar">
      <div><b>Question classification</b><p>Review automatic suggestions before saving them. Existing classifications are preserved unless you re-categorize all.</p></div>
      <div><button className="button button-outline" onClick={() => onAutoCategorize(false)}>Auto-Categorize Questions</button><button className="button button-quiet" onClick={() => {
        if (window.confirm("Re-categorize every question? Existing exam, section and topic assignments may change. You can review all suggestions before saving.")) onAutoCategorize(true);
      }}>Re-Categorize All Questions</button></div>
    </div>}
    <section className="admin-stat-grid">
      <StatCard icon={<UserRound />} label="Students" value={students.length} caption="registered accounts" tone="purple" />
      <StatCard icon={<ClipboardList />} label="Student answers" value={studentAttempts.length} caption="latest saved answer per question" tone="blue" />
      <StatCard icon={<Check />} label="Correct answers" value={correctStudentAttempts} caption={`${percent(correctStudentAttempts, studentAttempts.length)}% of attempts`} tone="green" />
      <StatCard icon={<Target />} label="Questions" value={questions.length} caption="in the question bank" tone="orange" />
    </section>
    <section className="question-stat-panel"><div className="section-heading"><div><h2>Question statistics</h2><p>Attempt and accuracy data across all student accounts.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Question</th><th>Exam</th><th>Attempts</th><th>Correct</th><th>Accuracy</th></tr></thead><tbody>{questions.map((question) => {
        const related = studentAttempts.filter((attempt) => attempt.questionId === question.id);
        const correct = related.filter((attempt) => attempt.isCorrect).length;
        return <tr key={question.id}><td className="question-cell"><MathContent text={question.question} /></td><td>{exams.find((exam) => exam.id === question.examId)?.name}</td><td>{related.length}</td><td>{correct}</td><td>{percent(correct, related.length)}%</td></tr>;
      })}{!questions.length && <tr><td colSpan={5} className="table-empty">Question statistics will appear as students answer questions.</td></tr>}</tbody></table></div>
    </section>
    <div className="admin-tabs">{types.map((item) => <button key={item} className={item === type ? "admin-tab-active" : ""} onClick={() => onTab(item)}>{titleCase(item)}s <span>{item === "exam" ? exams.length : item === "section" ? sections.length : item === "chapter" ? chapters.length : rows.length}</span></button>)}</div>
    <div className="admin-toolbar"><SearchBox value={search} onChange={setSearch} placeholder={`Search ${type}s…`} />
      {type === "question" && <div className="filters"><Filter size={16} /><select value={examFilter} onChange={(event) => { setExamFilter(event.target.value); setSectionFilter(""); setChapterFilter(""); }}><option value="">All exams</option>{exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.name}</option>)}</select><select value={sectionFilter} onChange={(event) => { setSectionFilter(event.target.value); setChapterFilter(""); }}><option value="">All sections</option>{sections.filter((section) => !examFilter || section.examId === examFilter).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select><select value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)}><option value="">All chapters</option>{chapters.filter((chapter) => !sectionFilter || chapter.sectionId === sectionFilter).filter((chapter) => !examFilter || chapter.examId === examFilter).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select><select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">All difficulty</option>{["Easy", "Medium", "Hard"].map((level) => <option key={level}>{level}</option>)}</select></div>}
    </div>
    <div className="table-wrap"><table><thead><tr>{type === "question" ? <><th>Question</th><th>Exam / Section</th><th>Correct answer</th><th>Difficulty</th></> : type === "exam" ? <><th>Exam</th><th>Sections</th><th>Questions</th></> : type === "section" ? <><th>Section</th><th>Exam</th><th>Chapters</th></> : <><th>Chapter</th><th>Section</th><th>Exam</th></>}<th>Actions</th></tr></thead><tbody>{filtered.map((item) => {
      const examId = (item as Question | Section | Chapter).examId;
      const exam = exams.find((entry) => entry.id === examId);
      return <tr key={item.id}>
        {type === "question" ? (() => { const q = item as Question; return <><td className="question-cell"><MathContent text={q.question} /><small>{q.topic ?? chapters.find((entry) => entry.id === q.chapterId)?.name ?? "Topic not set"}{q.subTopic ? ` · ${q.subTopic}` : " · Sub-topic not set"}</small></td><td>{exam?.name} · {sections.find((entry) => entry.id === q.sectionId)?.name}</td><td><span className="correct-answer-pill">{q.correctAnswer}</span></td><td><span className={`difficulty difficulty-${q.difficulty.toLowerCase()}`}>{q.difficulty}</span></td></>; })()
          : type === "exam" ? <><td><b>{(item as Exam).name}</b><small>{(item as Exam).tagline}</small></td><td>{sections.filter((entry) => entry.examId === item.id).length}</td><td>{questions.filter((entry) => entry.examId === item.id).length}</td></>
            : type === "section" ? <><td><b>{(item as Section).name}</b></td><td>{exam?.name}</td><td>{chapters.filter((entry) => entry.sectionId === item.id).length}</td></>
              : <><td><b>{(item as Chapter).name}</b></td><td>{sections.find((entry) => entry.id === (item as Chapter).sectionId)?.name}</td><td>{exam?.name}</td></>}
        <td><div className="table-actions"><button onClick={() => onEdit(item)}>Edit</button><button className="delete-action" onClick={() => onDelete(item)} aria-label={`Delete ${type}`}><Trash2 size={16} /></button></div></td>
      </tr>;
    })}{!filtered.length && <tr><td colSpan={5} className="table-empty">Nothing here yet. Add your first {type}.</td></tr>}</tbody></table></div>
  </div>;
}

function Field({ label, name, value, onChange, placeholder, required, type = "text", minLength, autoComplete }: {
  label: string; name: string; value?: string; onChange?: (value: string) => void; placeholder?: string; required?: boolean; type?: string; minLength?: number; autoComplete?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <label className="form-label">
      <span>{label}</span>
      <div className="relative flex items-center">
        <input
          name={name}
          type={inputType}
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className="w-full pr-10"
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            className="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </label>
  );
}

function AnswerCheckNotice({ check, acknowledged, onAcknowledge }: {
  check: Exclude<AnswerCheck, null>;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}) {
  if (check.kind === "mismatch") return <div className="answer-validation answer-validation-error" role="alert">
    <b>⚠️ Possible Answer Error</b><p>{check.message} Correct the selected option or explanation before publishing.</p>
  </div>;
  return <div className="answer-validation answer-validation-review" role="alert">
    <b>⚠️ Manual answer review required</b><p>{check.message}</p>
    <label><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} /> I reviewed the solution and confirmed the selected correct option.</label>
  </div>;
}

function EntityEditor({ type, item, exams, sections, chapters, onClose, onSave, classify }: {
  type: EntityType; item?: Entity; exams: Exam[]; sections: Section[]; chapters: Chapter[];
  onClose: () => void; onSave: (entity: Entity) => void; classify: (text: string) => QuestionClassification;
}) {
  const examDefault = exams[0]?.id ?? "";
  const [examId, setExamId] = useState((item as Section | Chapter | Question | undefined)?.examId ?? examDefault);
  const validSections = sections.filter((section) => section.examId === examId);
  const [sectionId, setSectionId] = useState((item as Chapter | Question | undefined)?.sectionId ?? validSections[0]?.id ?? "");
  const validChapters = chapters.filter((chapter) => chapter.sectionId === sectionId);
  const [chapterId, setChapterId] = useState((item as Question | undefined)?.chapterId ?? validChapters[0]?.id ?? "");
  const question = item as Question | undefined;
  const [options, setOptions] = useState<Record<string, string>>({
    A: question?.options?.A ?? "",
    B: question?.options?.B ?? "",
    C: question?.options?.C ?? "",
    D: question?.options?.D ?? "",
    E: question?.options?.E ?? "",
  });
  const [liveQuestion, setLiveQuestion] = useState(question?.question ?? "");
  const [liveExplanation, setLiveExplanation] = useState(question?.explanation ?? "");
  const [answer, setAnswer] = useState(question?.answerMode === "text" ? "A" : question?.correctAnswer ?? (question?.hasAnswerKey === false ? "" : "A"));
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? "Medium");
  const [subTopic, setSubTopic] = useState(question?.subTopic ?? "");
  const [suggestion, setSuggestion] = useState<QuestionClassification | null>(null);
  const [draft, setDraft] = useState<Question | null>(null);
  const [editingClassification, setEditingClassification] = useState(false);
  const [answerCheck, setAnswerCheck] = useState<AnswerCheck>(null);
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const id = item?.id ?? makeId(type);
    const name = String(fields.get("name") ?? "");
    if (type === "exam") onSave({ id, name: String(fields.get("examName")), tagline: String(fields.get("tagline")), color: String(fields.get("color") || "violet") });
    else if (type === "section") onSave({ id, examId, name } as Section);
    else if (type === "chapter") onSave({ id, examId, sectionId, name } as Chapter);
    else if (!item) {
      const questionText = String(fields.get("question"));
      const cleanedOptions: Record<string, string> = {
        A: options.A,
        B: options.B,
        C: options.C,
        D: options.D,
      };
      if (options.E && options.E.trim()) {
        cleanedOptions.E = options.E.trim();
      }
      const questionDraft: Question = {
        id,
        examId: "",
        sectionId: "",
        chapterId: "",
        question: questionText,
        options: cleanedOptions as Question["options"],
        correctAnswer: answer || undefined,
        hasAnswerKey: Boolean(answer),
        explanation: String(fields.get("explanation")),
        difficulty,
      };
      setLiveQuestion(questionText);
      setLiveExplanation(questionDraft.explanation ?? "");
      setAnswerCheck(checkMathAnswer(questionDraft));
      setReviewAcknowledged(false);
      const classification = classify(`${questionText}\n${Object.values(cleanedOptions).join("\n")}\n${questionDraft.explanation}`);
      setDraft(questionDraft);
      setSuggestion(classification);
    } else {
      const cleanedOptions: Record<string, string> = {
        A: options.A,
        B: options.B,
        C: options.C,
        D: options.D,
      };
      if (options.E && options.E.trim()) {
        cleanedOptions.E = options.E.trim();
      }
      const updated: Question = {
        ...(question ?? {}),
        id, examId, sectionId, chapterId, topic: validChapters.find((chapter) => chapter.id === chapterId)?.name ?? "",
        subTopic: subTopic.trim(), question: String(fields.get("question")),
        options: cleanedOptions as Question["options"], correctAnswer: answer || undefined, hasAnswerKey: Boolean(answer), explanation: String(fields.get("explanation")), difficulty,
      };
      const check = checkMathAnswer(updated);
      setAnswerCheck(check);
      if (check?.kind === "mismatch" || (check?.kind === "review" && !reviewAcknowledged)) return;
      onSave(updated);
    }
  }
  const title = `${item ? "Edit" : "Add"} ${type}`;
  if (suggestion && draft) {
    const suggestionSections = sections.filter((section) => section.examId === suggestion.examId);
    const suggestionChapters = chapters.filter((chapter) => chapter.examId === suggestion.examId && chapter.sectionId === suggestion.sectionId);
    const selectExam = (nextExamId: string) => {
      const nextSection = sections.find((section) => section.examId === nextExamId);
      setSuggestion({ ...suggestion, examId: nextExamId, sectionId: nextSection?.id ?? "", chapterId: "", topic: "" });
    };
    const selectSection = (nextSectionId: string) => setSuggestion({ ...suggestion, sectionId: nextSectionId, chapterId: "", topic: "" });
    const selectTopic = (nextTopic: string) => {
      const match = suggestionChapters.find((chapter) => chapter.name.toLowerCase() === nextTopic.trim().toLowerCase());
      setSuggestion({ ...suggestion, topic: nextTopic, chapterId: match?.id ?? "" });
    };
    const saveSuggestedQuestion = () => {
      if (!suggestion.examId || !suggestion.sectionId || !suggestion.topic.trim() || !suggestion.subTopic.trim()) return;
      const check = checkMathAnswer(draft);
      if (check?.kind === "mismatch" || (check?.kind === "review" && !reviewAcknowledged)) {
        setAnswerCheck(check);
        return;
      }
      onSave({
        ...draft,
        examId: suggestion.examId,
        sectionId: suggestion.sectionId,
        chapterId: suggestion.chapterId,
        topic: suggestion.topic.trim(),
        subTopic: suggestion.subTopic.trim(),
      });
    };
    return <Modal onClose={onClose}><div className="editor-modal classification-review">
      <div className="modal-title"><div><span className="eyebrow">AI CLASSIFICATION</span><h2>Review suggested classification</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
      <MathPreview label="Question preview" text={draft.question} className="editor-math-preview" />
      <div className="editor-option-previews">{getQuestionOptionKeys(draft).map((key) => <div key={key}><b>{key}</b><MathContent text={draft.options[key] ?? ""} /></div>)}</div>
      {draft.explanation && <MathPreview label="Solution preview" text={draft.explanation} className="editor-math-preview" />}
      {answerCheck && <AnswerCheckNotice check={answerCheck} acknowledged={reviewAcknowledged} onAcknowledge={setReviewAcknowledged} />}
      <div className={`classification-confidence confidence-${suggestion.confidence.toLowerCase()}`}>{suggestion.confidence} confidence · {suggestion.reason}</div>
      {editingClassification ? <div className="classification-fields">
        <label className="form-label">Exam<select value={suggestion.examId} onChange={(event) => selectExam(event.target.value)}>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}</select></label>
        <label className="form-label">Section<select value={suggestion.sectionId} onChange={(event) => selectSection(event.target.value)}>{suggestionSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
        <label className="form-label">Topic<input list="question-topic-options" value={suggestion.topic} onChange={(event) => selectTopic(event.target.value)} placeholder="Enter or select a topic" required /><datalist id="question-topic-options">{suggestionChapters.map((chapter) => <option key={chapter.id} value={chapter.name} />)}</datalist><small>A new topic will be added if it does not already exist in this section.</small></label>
        <Field label="Sub-topic" name="subTopic" value={suggestion.subTopic} onChange={(value) => setSuggestion({ ...suggestion, subTopic: value })} required />
      </div> : <dl className="classification-summary">
        <dt>Exam</dt><dd>{exams.find((exam) => exam.id === suggestion.examId)?.name ?? "Select exam"}</dd>
        <dt>Section</dt><dd>{sections.find((section) => section.id === suggestion.sectionId)?.name ?? "Select section"}</dd>
        <dt>Topic</dt><dd>{suggestion.topic || "Not classified"}</dd>
        <dt>Sub-topic</dt><dd>{suggestion.subTopic || "Not classified"}</dd>
      </dl>}
      <div className="modal-actions"><button className="button button-quiet" onClick={() => setSuggestion(null)}>Edit Question</button>{editingClassification && <button className="button button-outline" onClick={() => setEditingClassification(false)}>Done editing</button>}<button className="button button-outline" onClick={() => setEditingClassification(true)}>Edit Classification</button><button className="button button-primary" onClick={saveSuggestedQuestion} disabled={!suggestion.topic.trim() || !suggestion.subTopic.trim() || !suggestion.sectionId || answerCheck?.kind === "mismatch" || (answerCheck?.kind === "review" && !reviewAcknowledged)}>Confirm &amp; Save</button></div>
    </div></Modal>;
  }
  return <Modal onClose={onClose}><div className="editor-modal"><div className="modal-title"><div><span className="eyebrow">QUESTION BANK</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <form className="editor-form" onSubmit={submit}>
      {type === "exam" && <><Field label="Exam name" name="examName" value={(item as Exam | undefined)?.name} placeholder="e.g. CAT" required /><Field label="Full exam name" name="tagline" value={(item as Exam | undefined)?.tagline} placeholder="e.g. Common Admission Test" required /><label className="form-label">Card color<select name="color" defaultValue={(item as Exam | undefined)?.color ?? "violet"}>{["violet", "blue", "green", "orange"].map((color) => <option key={color}>{color}</option>)}</select></label></>}
      {(type === "section" || type === "chapter" || (type === "question" && Boolean(item))) && <label className="form-label">Exam<select value={examId} onChange={(event) => { setExamId(event.target.value); setSectionId(""); setChapterId(""); }} required disabled={Boolean(item && type !== "question")}>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}</select></label>}
      {(type === "chapter" || (type === "question" && Boolean(item))) && <label className="form-label">Section / subject<select value={sectionId} onChange={(event) => { setSectionId(event.target.value); setChapterId(""); }} required disabled={Boolean(item && type === "chapter")}>{validSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>}
      {(type === "section" || type === "chapter") && <Field label={type === "section" ? "Section name" : "Chapter name"} name="name" value={(item as Section | Chapter | undefined)?.name} placeholder={type === "section" ? "e.g. Quantitative Aptitude" : "e.g. Arithmetic"} required />}
      {type === "question" && <>
        {item && <label className="form-label">Chapter / topic<select value={chapterId} onChange={(event) => setChapterId(event.target.value)} required>{validChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></label>}
        <label className="form-label">Question<textarea name="question" value={liveQuestion} onChange={(event) => { setLiveQuestion(event.target.value); setAnswerCheck(null); setReviewAcknowledged(false); }} placeholder="Enter the question… Use $...$ or \\(...\\) for LaTeX." required rows={3} /></label>
        <MathPreview label="Live question preview" text={liveQuestion} className="editor-math-preview" />
        <div className="option-editor">{answerOptions.map((key) => <label key={key} className="form-label"><span>Option {key} {key === "E" ? <span className="optional">(optional)</span> : null}</span><input value={options[key]} onChange={(event) => { setOptions({ ...options, [key]: event.target.value }); setAnswerCheck(null); setReviewAcknowledged(false); }} required={key !== "E"} placeholder={`Enter option ${key}${key === "E" ? " (leave blank if 4 options)" : ""}`} /><MathPreview label={`Option ${key} preview`} text={options[key]} className="editor-option-preview" /></label>)}</div>
        <div className="two-fields"><label className="form-label">Correct answer<select value={answer} onChange={(event) => { setAnswer(event.target.value as Answer | ""); setAnswerCheck(null); setReviewAcknowledged(false); }}>{!answer && <option value="">Not Available</option>}{answerOptions.map((key) => <option key={key}>{key}</option>)}</select></label><label className="form-label">Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>{["Easy", "Medium", "Hard"].map((level) => <option key={level}>{level}</option>)}</select></label></div>
        {item && <Field label="Sub-topic" name="subTopic" value={subTopic} onChange={setSubTopic} placeholder="e.g. Linear Equations" />}
        <label className="form-label">Explanation <span className="optional">(optional)</span><textarea name="explanation" value={liveExplanation} onChange={(event) => { setLiveExplanation(event.target.value); setAnswerCheck(null); setReviewAcknowledged(false); }} rows={5} placeholder="Write each step on a new line. Use **bold** or $...$ for math." /></label>
        <MathPreview label="Live solution preview" text={liveExplanation} className="editor-math-preview editor-solution-preview" />
        {answerCheck && <AnswerCheckNotice check={answerCheck} acknowledged={reviewAcknowledged} onAcknowledge={setReviewAcknowledged} />}
      </>}
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={Boolean(answerCheck && (answerCheck.kind === "mismatch" || !reviewAcknowledged))}>{type === "question" && !item ? "Review Classification" : item ? "Save changes" : `Add ${type}`}</button></div>
    </form>
  </div></Modal>;
}

function BulkClassificationReview({ questions, exams, sections, chapters, onClose, onSave }: {
  questions: Question[];
  exams: Exam[];
  sections: Section[];
  chapters: Chapter[];
  onClose: () => void;
  onSave: (questions: Question[]) => Promise<void>;
}) {
  const [items, setItems] = useState(questions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function updateQuestion(id: string, update: Partial<Question>) {
    setItems((current) => current.map((question) => question.id === id ? { ...question, ...update } : question));
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save question classifications.");
    } finally {
      setSaving(false);
    }
  }
  return <Modal onClose={onClose}><div className="editor-modal bulk-classification-review">
    <div className="modal-title"><div><span className="eyebrow">ADMIN REVIEW</span><h2>Review question classifications</h2></div><button className="icon-button" onClick={onClose} disabled={saving}><X size={18} /></button></div>
    <p>Review or edit every proposed exam, section, topic and sub-topic. Nothing is saved until you confirm.</p>
    {error && <div className="login-error">{error}</div>}
    <div className="bulk-classification-list">{items.map((question, index) => {
      const rowSections = sections.filter((section) => section.examId === question.examId);
      const rowChapters = chapters.filter((chapter) => chapter.examId === question.examId && chapter.sectionId === question.sectionId);
      return <article className="bulk-classification-row" key={question.id}>
        <div className="bulk-classification-question"><b>{index + 1}. <MathContent text={question.question} /></b><span>{question.subTopic}</span></div>
        <div className="classification-fields">
          <label className="form-label">Exam<select value={question.examId} onChange={(event) => {
            const examId = event.target.value;
            const section = sections.find((entry) => entry.examId === examId);
            updateQuestion(question.id, { examId, sectionId: section?.id ?? "", chapterId: "", topic: "" });
          }}>{exams.map((exam) => <option value={exam.id} key={exam.id}>{exam.name}</option>)}</select></label>
          <label className="form-label">Section<select value={question.sectionId} onChange={(event) => updateQuestion(question.id, { sectionId: event.target.value, chapterId: "", topic: "" })}>{rowSections.map((section) => <option value={section.id} key={section.id}>{section.name}</option>)}</select></label>
          <label className="form-label">Topic<input list={`bulk-topics-${question.id}`} value={question.topic ?? ""} onChange={(event) => {
            const topic = event.target.value;
            const chapter = rowChapters.find((entry) => entry.name.trim().toLowerCase() === topic.trim().toLowerCase());
            updateQuestion(question.id, { topic, chapterId: chapter?.id ?? "" });
          }} required /><datalist id={`bulk-topics-${question.id}`}>{rowChapters.map((chapter) => <option value={chapter.name} key={chapter.id} />)}</datalist></label>
          <Field label="Sub-topic" name={`subTopic-${question.id}`} value={question.subTopic ?? ""} onChange={(subTopic) => updateQuestion(question.id, { subTopic })} required />
        </div>
      </article>;
    })}</div>
    <div className="modal-actions"><button className="button button-quiet" onClick={onClose} disabled={saving}>Cancel</button><button className="button button-primary" onClick={() => void save()} disabled={saving || items.some((question) => !question.examId || !question.sectionId || !question.topic?.trim() || !question.subTopic?.trim())}>{saving ? "Saving classifications…" : `Confirm & Save ${items.length} Questions`}</button></div>
  </div></Modal>;
}

function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card">{children}</div></div>;
}
