import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Award, BookOpen, Check, ChevronDown, CircleHelp, ClipboardList,
  Clock3, Filter, Flag, GraduationCap, Image as ImageIcon, LayoutDashboard, LogIn, LogOut, Menu, Moon, Search, ShieldCheck, Sun,
  Shuffle, Sparkles, Target, Trash2, UserRound, X, Zap, Users, Settings, Layers3,
} from "lucide-react";
import { initialChapters, initialExams, initialQuestions, initialSections } from "./data";
import { applyClassification, classifyQuestion, type QuestionClassification } from "./classifier";
import { demoAnswerKeys } from "./demoAnswerKeys";
import { findCat2024Slot3Solution } from "./cat2024Slot3Solutions";
import { MathContent, MathPreview } from "./MathContent";
import { AiPdfImport } from "./AiPdfImport";
import { firestore, isFirebaseConfigured } from "./firebase";
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import {
  clearLocalSession, createLocalStudent, deleteLocalStudent, loginLocalAccount, logoutAdminSession, readLocalAttemptEvents,
  readLocalStudents, recordLocalAttempt, resetLocalStudentPassword, restoreLocalSession as restoreAccountSession,
  setLocalStudentDisabled, updateLocalStudent, verifyAdminSession,
} from "./localAuth";
import type { Answer, Attempt, Chapter, Difficulty, Exam, Question, QuestionChange, QuestionReport, QuestionReportStatus, Section, SiteSettings, StudentAccountInput, UserProfile } from "./model";

type View = "dashboard" | "practice" | "random" | "wrong" | "progress" | "reports" | "admin";
type QuizState = { questions: Question[]; index: number; answers: Record<string, string | null>; title: string; origin: View; sessionId: string };
type EntityType = "exam" | "section" | "chapter" | "question";
type Entity = Exam | Section | Chapter | Question;
type LoginKind = "student" | "admin";
type AdminArea = "dashboard" | "students" | "create-student" | "questions" | "sections" | "chapters" | "statistics" | "settings" | "reports" | "ai-import";
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
const answerOptions: Answer[] = ["A", "B", "C", "D"];

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
function normalizedAnswer(value: string) {
  return value.trim().replace(/,/g, "").replace(/\s+/g, " ").toLowerCase();
}
function numericAnswer(value: string): number | undefined {
  const cleaned = value.trim().replace(/,/g, "").replace(/\s/g, "");
  const fraction = cleaned.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : undefined;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}
function isCorrectAnswer(question: Question, submitted: string) {
  if (question.answerMode !== "text") return normalizedAnswer(submitted) === normalizedAnswer(question.correctAnswer ?? "");
  const expectedNumber = numericAnswer(question.correctAnswer ?? "");
  const submittedNumber = numericAnswer(submitted);
  return expectedNumber !== undefined && submittedNumber !== undefined
    ? Math.abs(expectedNumber - submittedNumber) < 1e-9
    : normalizedAnswer(submitted) === normalizedAnswer(question.correctAnswer ?? "");
}
function mapFirestoreQuestion(id: string, row: Record<string, unknown>, examId: string, sections: Section[], chapters: Chapter[]): Question {
  const questionText = typeof row.question === "string" ? row.question : "";
  const pdfSolution = examId === "cat" ? findCat2024Slot3Solution(questionText) : undefined;
  const category = typeof row.category === "string" ? row.category.trim() : "";
  const section = sections.find((item) => item.examId === examId && item.name.trim().toLowerCase() === category.toLowerCase())
    ?? sections.find((item) => item.examId === examId);
  const chapter = section && chapters.find((item) => item.sectionId === section.id);
  const options = {
    A: typeof row.optionA === "string" ? row.optionA : "",
    B: typeof row.optionB === "string" ? row.optionB : "",
    C: typeof row.optionC === "string" ? row.optionC : "",
    D: typeof row.optionD === "string" ? row.optionD : "",
  };
  const answer = pdfSolution?.answer ?? (typeof row.answer === "string" ? row.answer.trim() : "");
  const noOptions = Object.values(options).every((option) => !option.trim());
  const answerLetter = (["A", "B", "C", "D"] as const).find((letter) => letter === answer.toUpperCase())
    ?? (["A", "B", "C", "D"] as const).find((letter) => options[letter].trim().toLowerCase() === answer.toLowerCase());
  return {
    id: `firestore-${id}`,
    examId,
    sectionId: section?.id ?? `${examId}-uncategorized`,
    chapterId: chapter?.id ?? `${examId}-uncategorized-chapter`,
    topic: category || undefined,
    question: questionText,
    options,
    answerMode: noOptions ? "text" : "choice",
    correctAnswer: noOptions ? answer || undefined : answerLetter,
    hasAnswerKey: Boolean(noOptions ? answer : answerLetter),
    explanation: pdfSolution?.explanation ?? (typeof row.explanation === "string" ? row.explanation : ""),
    difficulty: "Medium",
  };
}
async function fetchFirestoreExamQuestions(examId: string, sections: Section[], chapters: Chapter[]): Promise<Question[]> {
  if (!firestore) throw new Error("Firebase is not configured. Add your Firebase Web App values to .env.local and restart the app.");
  const examCode = examId.toUpperCase();
  const examQuery = query(collection(firestore, "examQuestions"), where("exam", "==", examCode));
  const snapshot = await getDocs(examQuery);
  return snapshot.docs.map((document) => mapFirestoreQuestion(document.id, document.data(), examId, sections, chapters))
    .filter((question) => question.question.trim()
      && (question.answerMode === "text"
        ? Object.values(question.options).every((option) => !option.trim())
        : Object.values(question.options).every((option) => option.trim())));
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

  const optionAnswer = explanation.match(/\b(?:correct\s+answer|final\s+answer|answer)\s*(?:is|=|:)?\s*(?:option\s*)?([A-D])\b|\boption\s+([A-D])\s+is\s+(?:the\s+)?correct\b/i);
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
  const [adminAttempts, setAdminAttempts] = useState<(Attempt & { userId: string })[]>([]);
  const [questionReports, setQuestionReports] = useState<QuestionReport[]>([]);
  const [questionHistoryRevision, setQuestionHistoryRevision] = useState(0);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(() => readLocal("mba-settings", defaultSettings));
  const [profile, setProfile] = useState<UserProfile | null>(() => restoreAccountSession());
  const [darkMode, setDarkMode] = useState(() => readLocal("mba-dark-mode", false));
  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => profile?.role === "admin" ? "admin" : "dashboard");
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [result, setResult] = useState<QuizState | null>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [loginKind, setLoginKind] = useState<LoginKind | "choose">("choose");
  const [authBusy, setAuthBusy] = useState(false);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const answerLock = useRef(false);
  const [adminArea, setAdminArea] = useState<AdminArea>("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [editing, setEditing] = useState<{ type: EntityType; item?: Entity; reportId?: string } | null>(null);
  const [reportingQuestion, setReportingQuestion] = useState<Question | null>(null);
  const [bulkClassifications, setBulkClassifications] = useState<Question[] | null>(null);
  const isAdmin = profile?.role === "admin";
  const pendingReportCount = questionReports.filter((report) => report.status === "Pending Review").length;

  const showError = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError(""), 6000);
  }, []);

  useEffect(() => {
    if (!profile) {
      setAttempts([]);
      return;
    }
    setAttempts(readLocal(`mba-progress-${profile.uid}`, []));
  }, [profile]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    let active = true;
    void verifyAdminSession().then((session) => {
      if (!active || session) return;
      clearLocalSession();
      setProfile(null);
      setView("dashboard");
      setAdminArea("dashboard");
    });
    return () => { active = false; };
  }, [profile?.role, profile?.uid]);

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
    setQuestions((current) => current.filter((question) => !question.id.startsWith("firestore-")));
    if (!selectedExam || !["cat", "cmat", "xat"].includes(selectedExam)) {
      setExamQuestionsLoading(false);
      setExamQuestionsError("");
      return;
    }
    if (!isFirebaseConfigured || !firestore) {
      setExamQuestionsLoading(false);
      setExamQuestionsError("Firebase is not configured yet. Add your Firebase Web App values to .env.local and restart the app.");
      return;
    }

    setExamQuestionsLoading(true);
    setExamQuestionsError("");
    const examCode = selectedExam.toUpperCase();
    const examQuery = query(collection(firestore, "examQuestions"), where("exam", "==", examCode));
    return onSnapshot(examQuery, (snapshot) => {
      const remoteIds = new Set(snapshot.docs.map((document) => document.id));
      const nextQuestions = snapshot.docs.map((document) => mapFirestoreQuestion(document.id, document.data(), selectedExam, sections, chapters))
        .filter((question) => question.question.trim()
          && (question.answerMode === "text"
            ? Object.values(question.options).every((option) => !option.trim())
            : Object.values(question.options).every((option) => option.trim())));
      setQuestions((current) => [
        ...current.filter((question) => question.examId !== selectedExam || (!question.id.startsWith("firestore-") && !remoteIds.has(question.id))),
        ...nextQuestions,
      ]);
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
      console.error(`Firestore question listener failed for ${examCode}:`, reason);
      setExamQuestionsLoading(false);
      setExamQuestionsError(`Could not load ${examCode} questions. Check your Firebase configuration, Firestore rules, and internet connection, then try again.`);
    });
  }, [selectedExam, sections, chapters, questionLoadRevision]);

  useEffect(() => {
    localStorage.setItem("mba-dark-mode", JSON.stringify(darkMode));
  }, [darkMode]);

  const activeExam = exams.find((exam) => exam.id === selectedExam);
  const examSections = sections.filter((section) => section.examId === selectedExam && !settings.hiddenSectionIds.includes(section.id));
  const examQuestions = questions.filter((question) => question.examId === selectedExam && examSections.some((section) => section.id === question.sectionId));
  const byId = useMemo(() => new Map(attempts.map((attempt) => [attempt.questionId, attempt])), [attempts]);
  useEffect(() => {
    if (!isAdmin) {
      setAdminAttempts([]);
      setUserProfiles([]);
      return;
    }
    setAdminAttempts(readLocalAttemptEvents() as (Attempt & { userId: string })[]);
    setUserProfiles(readLocalStudents());
  }, [isAdmin]);

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
    recordLocalAttempt(profile.uid, attempt);
    if (isAdmin) setAdminAttempts(readLocalAttemptEvents() as (Attempt & { userId: string })[]);
    setAttempts((current) => {
      const next = [...current.filter((item) => item.questionId !== question.id), attempt];
      localStorage.setItem(`mba-progress-${profile.uid}`, JSON.stringify(next));
      return next;
    });
    return attempt;
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
    }
  }
  function startChapter(section: Section, chapter: Chapter) {
    setSectionId(section.id);
    beginQuiz(questions.filter((question) => question.chapterId === chapter.id), `${section.name} · ${chapter.name}`, "practice");
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
        setQuestions((current) => [...current.filter((entry) => entry.id !== question.id), question]);
        if (previous && relatedReportId) {
          const history = readLocal<QuestionChange[]>("mba-question-change-history", []);
          history.unshift({
            id: makeId("change"),
            questionId: question.id,
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
    if (createChapter && !chapters.some((chapter) => chapter.sectionId === question.sectionId && chapter.name.trim().toLowerCase() === (question.topic ?? "").trim().toLowerCase())) {
      const chapter: Chapter = { id: makeId("chapter"), examId: question.examId, sectionId: question.sectionId, name: (question.topic ?? "Suggested chapter").trim() };
      setChapters((current) => [...current, chapter]);
      question = { ...question, chapterId: chapter.id, topic: chapter.name };
      await saveApprovedQuestionToFirestore(question);
      setQuestions((current) => current.some((entry) => entry.id === question.id) ? current : [...current, question]);
      setToast("Question and approved chapter added to the question bank");
      window.setTimeout(() => setToast(""), 2500);
      return;
    }
    const saved = await persistClassifiedQuestion(question, [...chapters]);
    await saveApprovedQuestionToFirestore(saved);
    setQuestions((current) => current.some((entry) => entry.id === saved.id) ? current : [...current, saved]);
    setToast("Question added to the question bank");
    window.setTimeout(() => setToast(""), 2500);
  }
  async function saveApprovedQuestionToFirestore(question: Question) {
    if (!["cat", "cmat", "xat"].includes(question.examId)) return;
    if (!isFirebaseConfigured || !firestore) {
      throw new Error("Firebase is not configured. Add the existing Firebase Web App values to .env.local and restart the app.");
    }
    const section = sections.find((entry) => entry.id === question.sectionId);
    if (!section) throw new Error("Choose a valid section before approving this question.");
    const options = question.options;
    await setDoc(doc(firestore, "examQuestions", question.id), {
      exam: question.examId.toUpperCase(),
      question: question.question,
      optionA: options.A ?? "",
      optionB: options.B ?? "",
      optionC: options.C ?? "",
      optionD: options.D ?? "",
      answer: question.correctAnswer ?? "",
      category: section.name,
      explanation: question.explanation ?? "",
    });
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
        saved.push(result);
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
        setQuestions((all) => all.filter((entry) => entry.id !== item.id));
      }
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Delete failed.");
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
  function chooseLogin(kind: LoginKind) {
    setLoginKind(kind);
    setError("");
  }
  async function createManagedStudent(input: StudentAccountInput) {
    if (!isAdmin) throw new Error("Only an authenticated administrator can create student accounts.");
    await createLocalStudent(input);
    setUserProfiles(readLocalStudents());
    setToast(`Student account ${input.studentId} created.`);
    window.setTimeout(() => setToast(""), 4000);
  }
  async function updateManagedStudent(uid: string, input: StudentAccountInput) {
    if (!isAdmin) throw new Error("Administrator access is required.");
    await updateLocalStudent(uid, input);
    setUserProfiles(readLocalStudents());
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
    setLocalStudentDisabled(uid, disabled);
    setUserProfiles(readLocalStudents());
    setToast(disabled ? "Student account disabled." : "Student account enabled.");
    window.setTimeout(() => setToast(""), 3000);
  }
  async function deleteManagedStudent(uid: string) {
    if (!isAdmin) throw new Error("Administrator access is required.");
    deleteLocalStudent(uid);
    setUserProfiles(readLocalStudents());
    setAdminAttempts(readLocalAttemptEvents() as (Attempt & { userId: string })[]);
    setQuestionReports(readLocal<QuestionReport[]>("mba-question-reports", []));
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
      setLoginKind("choose");
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
    const list = attempts.filter((item) => item.examId === examId && availableIds.has(item.questionId));
    const correct = list.filter((item) => item.isCorrect).length;
    const total = questions.filter((question) => question.examId === examId).length;
    return { total, attempted: list.length, correct, wrong: list.length - correct, accuracy: percent(correct, list.length), completion: percent(list.length, total) };
  };

  function renderDashboard() {
    if (!activeExam) return null;
    const stats = currentAttemptStats(activeExam.id);
    return <div className="page-stack">
      <section className={`hero hero-${activeExam.color}`}>
        <div>
          <span className="eyebrow"><Sparkles size={14} /> YOUR PREPARATION SPACE</span>
          <h1>{activeExam.name} Preparation</h1>
          <p>{settings.welcomeMessage}</p>
          <button className="button button-light" onClick={() => visit("random")}><Zap size={16} /> Start a quick quiz <ArrowRight size={16} /></button>
        </div>
        <div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-icon"><GraduationCap size={78} strokeWidth={1.3} /></div><span className="art-star">✦</span><span className="art-dot" /></div>
      </section>
      <section className="stat-grid">
        <StatCard icon={<BookOpen />} label="Question bank" value={stats.total} caption="questions available" tone="purple" />
        <StatCard icon={<ClipboardList />} label="Attempted" value={stats.attempted} caption={`${stats.completion}% of question bank`} tone="blue" />
        <StatCard icon={<Check />} label="Correct answers" value={stats.correct} caption={`${stats.wrong} incorrect`} tone="green" />
        <StatCard icon={<Target />} label="Accuracy" value={`${stats.accuracy}%`} caption="on attempted questions" tone="orange" />
      </section>
      <section className="section-heading"><div><h2>Choose a section</h2><p>Pick a subject to explore its chapters and practice.</p></div><span className="soft-badge">{examSections.length} sections</span></section>
      {examQuestionsLoading && <div className="loading-state" role="status"><div className="spinner" /> Loading {activeExam.name} questions from Firebase…</div>}
      {!!examQuestionsError && <div className="empty-state"><div><CircleHelp size={26} /></div><p>{examQuestionsError}</p><button className="button button-outline" onClick={() => setQuestionLoadRevision((revision) => revision + 1)}>Retry loading</button></div>}
      {!examQuestionsLoading && !examQuestionsError && ["cat", "cmat", "xat"].includes(activeExam.id) && examQuestions.length === 0 && <EmptyState text={`No ${activeExam.name} questions were found in the Firestore examQuestions collection yet.`} />}
      {(!["cat", "cmat", "xat"].includes(activeExam.id) || (!examQuestionsLoading && !examQuestionsError && examQuestions.length > 0)) && <section className="section-grid">
        {examSections.map((section, index) => {
          const list = examQuestions.filter((question) => question.sectionId === section.id);
          const done = list.filter((question) => byId.has(question.id)).length;
          const progress = percent(done, list.length);
          const chapterCount = chapters.filter((chapter) => chapter.sectionId === section.id).length;
          return <button key={section.id} className="section-card" onClick={() => setSectionId(section.id)}>
            <div className={`section-icon section-icon-${index % 4}`}><SectionIcon index={index} /></div>
            <div className="section-card-content"><span className="section-count">SECTION {String(index + 1).padStart(2, "0")}</span><h3>{section.name}</h3><p>{chapterCount} chapters <span>·</span> {list.length} {list.length === 1 ? "question" : "questions"}</p></div>
            <ArrowRight className="section-arrow" size={18} />
            <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>
            <div className="section-progress"><span>Section progress</span><b>{progress}%</b></div>
          </button>;
        })}
      </section>}
      {search.trim() && <section className="search-results-panel">
        <div className="section-heading"><div><h2>Question search</h2><p>Matching questions in {activeExam.name}.</p></div><span className="soft-badge">{examQuestions.filter((question) => question.question.toLowerCase().includes(search.trim().toLowerCase())).length} matches</span></div>
        <div className="status-list">{examQuestions.filter((question) => question.question.toLowerCase().includes(search.trim().toLowerCase())).map((question) => <button className="search-result-row" key={question.id} onClick={() => { setSectionId(question.sectionId); beginQuiz([question], `${activeExam.name} · Search practice`, "practice"); }}><div><b><MathContent text={question.question} /></b><small>{sections.find((item) => item.id === question.sectionId)?.name} · {chapters.find((item) => item.id === question.chapterId)?.name}</small></div><ArrowRight size={16} /></button>)}</div>
      </section>}
      <section className="tip-banner"><div className="tip-icon"><Sparkles size={18} /></div><div><b>Small steps add up.</b><p>Practice a few questions daily to build a consistent preparation habit.</p></div><button className="text-button" onClick={() => visit("progress")}>View my progress <ArrowRight size={15} /></button></section>
    </div>;
  }

  function renderSectionPicker() {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) return renderDashboard();
    const chapterRows = chapters.filter((chapter) => chapter.sectionId === section.id);
    return <div className="page-stack">
      <button className="back-link" onClick={() => setSectionId(null)}><ArrowLeft size={16} /> Back to {activeExam?.name} dashboard</button>
      <section className="section-heading page-title"><div><span className="eyebrow">SECTION</span><h1>{section.name}</h1><p>Choose a chapter to begin practicing.</p></div></section>
      <div className="chapter-grid">{chapterRows.map((chapter, index) => {
        const pool = questions.filter((question) => question.chapterId === chapter.id);
        const attempted = pool.filter((question) => byId.has(question.id)).length;
        return <article className="chapter-card" key={chapter.id}>
          <div className="chapter-top"><div className={`chapter-icon chapter-icon-${index % 4}`}><BookOpen size={20} /></div><span className="soft-badge">{pool.length} {pool.length === 1 ? "question" : "questions"}</span></div>
          <h3>{chapter.name}</h3><p>{attempted} of {pool.length} attempted · {percent(attempted, pool.length)}% complete</p>
          <div className="progress-track"><span style={{ width: `${percent(attempted, pool.length)}%` }} /></div>
          <button className="button button-primary button-full" onClick={() => startChapter(section, chapter)}>Start practice <ArrowRight size={16} /></button>
        </article>;
      })}{!chapterRows.length && <EmptyState text="No chapters have been added for this section yet." />}</div>
    </div>;
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
      <div className="quiz-topline"><button className="back-link" onClick={() => { setQuiz(null); setView("dashboard"); }}><ArrowLeft size={16} /> Exit practice</button><span><Clock3 size={15} /> {quiz.title}</span></div>
      <div className="quiz-progress"><div><span>QUESTION {quiz.index + 1} <i>of {quiz.questions.length}</i></span><b>{percent(quiz.index + 1, quiz.questions.length)}%</b></div><div className="progress-track"><span style={{ width: `${percent(quiz.index + 1, quiz.questions.length)}%` }} /></div></div>
      <article className="question-card">
        <div className="question-meta"><span className="soft-badge">{activeExam?.name ?? exams.find((exam) => exam.id === q.examId)?.name} · {section?.name}</span><span className={`difficulty difficulty-${q.difficulty.toLowerCase()}`}>{q.difficulty}</span></div>
        <p className="question-number">Question {quiz.index + 1}</p><h2><MathContent text={q.question} /></h2>
        {q.answerMode === "text" ? <div className="text-answer-entry">
          <label htmlFor="typed-answer">Your answer</label>
          <div><input id="typed-answer" value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && typedAnswer.trim() && !answered) void chooseAnswer(typedAnswer); }} disabled={answered || savingQuestionId === q.id} placeholder="Type your answer" />
            {!answered && <button className="button button-primary" disabled={!typedAnswer.trim() || savingQuestionId === q.id} onClick={() => void chooseAnswer(typedAnswer)}>Submit answer <ArrowRight size={16} /></button>}</div>
        </div> : <div className="answer-list">{answerOptions.map((key) => {
          const isCorrect = key === q.correctAnswer;
          const isSelected = key === selected;
          const stateClass = answered && isCorrect ? "answer-correct" : answered && isSelected ? "answer-wrong" : "";
          const pending = savingQuestionId === q.id;
          return <button key={key} className={`answer-option ${stateClass} ${answered || pending ? "answer-disabled" : ""}`} disabled={answered || pending} onClick={() => void chooseAnswer(key)}>
            <span className="answer-letter">{answered && isCorrect ? <Check size={17} /> : key}</span><span><MathContent text={q.options[key]} /></span>
            {answered && isCorrect && <span className="answer-mark">Correct answer</span>}
            {answered && isSelected && !isCorrect && <span className="answer-mark">Your answer</span>}
          </button>;
        })}</div>}
        {answered && <div className={`feedback ${answeredCorrectly ? "feedback-correct" : "feedback-wrong"}`}>
          <b>{answeredCorrectly ? "✓  Correct answer!" : "✕  Not quite — that's incorrect."}</b>
          <p><strong>Correct answer: {q.correctAnswer}</strong></p>
          {q.explanation && <MathContent className="solution-content" text={q.explanation} />}
        </div>}
        <div className="quiz-controls">{!answered && <button className="text-button skip-button" disabled={savingQuestionId === q.id} onClick={() => advance(true)}>Skip question</button>}
          <button className="button button-primary next-button" disabled={!answered && countDone <= quiz.index} onClick={() => advance()}>{quiz.index === quiz.questions.length - 1 ? "See results" : "Next question"} <ArrowRight size={16} /></button>
        </div>
        {profile?.role === "student" && <button className="report-question-trigger" onClick={() => setReportingQuestion(q)}><Flag size={16} /> ⚠️ Report / Challenge Question</button>}
      </article>
      <p className="quiz-footnote"><ShieldCheck size={15} /> {savingQuestionId === q.id ? "Saving your answer…" : `Your answer is saved to your ${activeExam?.name ?? "exam"} progress as soon as you choose.`}</p>
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
    return <div className="page-stack">
      <section className="section-heading page-title"><div><span className="eyebrow">TARGETED PRACTICE</span><h1>Practice wrong questions</h1><p>Review your {activeExam?.name} questions that need another look.</p></div><span className="soft-badge">{wrong.length} to revisit</span></section>
      {!matching.length ? <EmptyState icon={<Target size={26} />} text={wrong.length ? "No questions match your search." : "No incorrect answers yet. Keep practicing and any misses will show up here."} /> : <>
        <SearchBox value={search} onChange={setSearch} placeholder="Search your incorrect questions…" />
        <div className="wrong-list">{matching.map((question, index) => <article className="wrong-row" key={question.id}><div className="wrong-index">{String(index + 1).padStart(2, "0")}</div><div><h3><MathContent text={question.question} /></h3><p>{sections.find((item) => item.id === question.sectionId)?.name} · {chapters.find((item) => item.id === question.chapterId)?.name}</p></div><span className="status-pill status-wrong">Wrong</span></article>)}</div>
        <button className="button button-primary" onClick={() => beginQuiz(matching, `${activeExam?.name} · Wrong questions`, "wrong")}><Target size={16} /> Practice these questions</button>
      </>}
    </div>;
  }

  function renderProgress() {
    const statusQuestions = questions
      .filter((question) => !selectedExam || question.examId === selectedExam)
      .filter((question) => question.question.toLowerCase().includes(search.toLowerCase()));
    return <div className="page-stack">
      <section className="section-heading page-title"><div><span className="eyebrow">YOUR LEARNING JOURNEY</span><h1>My progress</h1><p>Your preparation stays separate for every exam.</p></div></section>
      {!profile && <div className="notice"><UserRound size={18} /> Sign in to save progress across devices. <button className="text-button" onClick={() => setAuthOpen(true)}>Sign in</button></div>}
      <div className="progress-exams">{exams.map((exam) => {
        const stats = currentAttemptStats(exam.id);
        const sectionsHere = sections.filter((section) => section.examId === exam.id);
        return <article className="exam-progress-card" key={exam.id}>
          <div className="exam-progress-top"><div className={`mini-exam-icon mini-${exam.color}`}>{exam.name.slice(0, 1)}</div><div><h2>{exam.name}</h2><p>{exam.tagline}</p></div><button className="text-button" onClick={() => openExam(exam.id)}>Open exam <ArrowRight size={15} /></button></div>
          <div className="progress-stat-row"><MiniStat label="Question bank" value={stats.total} /><MiniStat label="Attempted" value={stats.attempted} /><MiniStat label="Correct" value={stats.correct} /><MiniStat label="Wrong" value={stats.wrong} /><MiniStat label="Accuracy" value={`${stats.accuracy}%`} /></div>
          <div className="overall-progress"><div><span>Completion</span><b>{stats.completion}%</b></div><div className="progress-track"><span style={{ width: `${stats.completion}%` }} /></div></div>
          <div className="mini-section-list">{sectionsHere.map((section) => {
            const qlist = questions.filter((question) => question.sectionId === section.id);
            const done = qlist.filter((question) => byId.has(question.id)).length;
            return <div key={section.id}><div><span>{section.name}</span><b>{percent(done, qlist.length)}%</b></div><div className="progress-track"><span style={{ width: `${percent(done, qlist.length)}%` }} /></div></div>;
          })}</div>
        </article>;
      })}</div>
      <section className="status-panel">
        <div className="section-heading"><div><h2>Question status</h2><p>{selectedExam ? `${activeExam?.name} questions` : "Status is listed separately within each exam."}</p></div><span className="soft-badge">{statusQuestions.length} {statusQuestions.length === 1 ? "question" : "questions"}</span></div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search questions…" />
        <div className="status-list">{statusQuestions.map((question) => {
          const attempt = byId.get(question.id);
          const status = !attempt ? "Not attempted" : attempt.isCorrect ? "Correct" : "Wrong";
          return <div className="status-row" key={question.id}>
            <div><span className="status-exam">{exams.find((exam) => exam.id === question.examId)?.name}</span><b><MathContent text={question.question} /></b><small>{sections.find((section) => section.id === question.sectionId)?.name} · {chapters.find((chapter) => chapter.id === question.chapterId)?.name}</small></div>
            <span className={`status-pill ${status === "Wrong" ? "status-wrong" : status === "Correct" ? "status-correct" : "status-not-attempted"}`}>{status}</span>
          </div>;
        })}{!statusQuestions.length && <p className="status-empty">No questions match your search.</p>}</div>
      </section>
    </div>;
  }

  function renderAdmin() {
    if (!isAdmin) return null;
    const students = userProfiles.filter((user) => user.role === "student");
    if (adminArea === "ai-import") return <AiPdfImport exams={exams} sections={sections} chapters={chapters} questions={questions} importedBy={profile?.name ?? "Administrator"} onApprove={addImportedQuestion} />;
    if (adminArea === "settings") return <SettingsPanel settings={settings} exams={exams} sections={sections} onSave={(value) => void saveSiteSettings(value)} />;
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

  const appReady = true;
  const viewLabel = view === "dashboard" ? "Dashboard" : view === "practice" ? "Chapter practice" : view === "random" ? "Random quiz" : view === "wrong" ? "Wrong questions" : view === "progress" ? "My progress" : view === "reports" ? "My reports" : "Admin dashboard";

  if (appReady && !profile) return <div className={darkMode ? "mode-dark login-theme" : "login-theme"}>
    <LoginPortal
      darkMode={darkMode} onToggleTheme={() => setDarkMode((current) => !current)}
      kind={loginKind} busy={authBusy} error={error}
      onChoose={chooseLogin} onSubmit={(event) => void submitAuth(event)}
      onBack={() => { setLoginKind("choose"); setError(""); }}
      onDismissError={() => setError("")}
    />
    {toast && <div className="toast">{toast}<button onClick={() => setToast("")}><X size={16} /></button></div>}
  </div>;

  return <div className={`app-shell theme-${settings.theme}${darkMode ? " mode-dark" : ""}`}>
    <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark">{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <GraduationCap size={23} />}</div><div><b>{settings.title.split(/\s+/)[0]}<span>{settings.title.split(/\s+/).slice(1).join(" ") || "prep"}</span></b><small>{isAdmin ? "ADMIN WORKSPACE" : "EXAM PRACTICE"}</small></div><button className="mobile-close" onClick={() => setMobileMenu(false)}><X size={19} /></button></div>
      {isAdmin && view === "admin" ? <>
        <div className="side-label admin-side-heading">ADMIN WORKSPACE</div>
        <nav className="admin-nav">{([
          ["dashboard", "Dashboard", LayoutDashboard],
          ["students", "Students", Users],
          ["create-student", "Create Student Account", UserRound],
          ["questions", "Questions", CircleHelp],
          ["ai-import", "AI PDF Import", Sparkles],
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
      <header className="topbar"><div className="top-left"><button className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><i>/</i><b>{isAdmin ? "Admin" : activeExam?.name ?? "Select an exam"}</b><i>/</i><b>{isAdmin && view === "admin" ? titleCase(adminArea.replace("-", " ")) : viewLabel}</b></div></div>
        <div className="top-actions"><span className="demo-badge">Local storage · this browser only</span><label className="header-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions…" disabled={!selectedExam && view !== "progress"} /></label><ThemeToggle darkMode={darkMode} onToggle={() => setDarkMode((current) => !current)} /><button className="icon-button" onClick={() => profile ? (isAdmin ? setAdminArea("dashboard") : visit("progress")) : setAuthOpen(true)} aria-label={profile ? (isAdmin ? "Admin dashboard" : "My progress") : "Sign in"}><UserRound size={18} /></button></div>
      </header>
      <div className="content-area">
        {!appReady && <div className="loading-state"><div className="spinner" /> Loading your account…</div>}
        {appReady && isAdmin && view === "admin" && renderAdmin()}
        {appReady && !isAdmin && view === "reports" && <QuestionReportsPanel
        reports={questionReports} questions={questions}
        isAdmin={false} historyRevision={0} onReview={changeQuestionReport} onEditQuestion={() => undefined}
          onEvidence={openQuestionReportEvidence} onError={showError}
        onExit={() => { setSelectedExam(null); setView("dashboard"); }}
        />}
        {appReady && !isAdmin && !selectedExam && view === "progress" && renderProgress()}
        {appReady && !isAdmin && !selectedExam && view !== "progress" && view !== "reports" && <ExamPicker exams={exams.filter((exam) => !settings.hiddenExamIds.includes(exam.id))} onSelect={openExam} onProgress={() => visit("progress")} profile={profile} onAuth={() => setAuthOpen(true)} onAdmin={() => visit("admin")} title={settings.title} welcome={settings.welcomeMessage} logoUrl={settings.logoUrl} />}
        {appReady && !isAdmin && selectedExam && <>
          {view === "dashboard" && (sectionId ? renderSectionPicker() : renderDashboard())}
          {view === "practice" && renderQuiz()}
          {view === "random" && (quiz || result ? renderQuiz() : renderRandom())}
          {view === "wrong" && (quiz || result ? renderQuiz() : renderWrong())}
          {view === "progress" && renderProgress()}
        </>}
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
  return <article className="stat-card"><div className={`stat-icon tone-${tone}`}>{icon}</div><div><span>{label}</span><b>{value}</b><small>{caption}</small></div><div className="stat-sparkline"><i /><i /><i /><i /><i /><i /><i /></div></article>;
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return <div><small>{label}</small><b>{value}</b></div>;
}

function ExamPicker({ exams, onSelect, onProgress, profile, onAuth, onAdmin, title, welcome, logoUrl }: {
  exams: Exam[]; onSelect: (id: string) => void; onProgress: () => void; profile: UserProfile | null;
  onAuth: () => void; onAdmin: () => void; title: string; welcome: string; logoUrl: string;
}) {
  return <div className="picker-page">
    <header className="picker-header"><div className="brand"><div className="brand-mark">{logoUrl ? <img src={logoUrl} alt="" /> : <GraduationCap size={23} />}</div><div><b>{title}</b><small>EXAM PRACTICE</small></div></div><div className="picker-header-actions flex items-center">{profile && <button className="button button-quiet" onClick={onProgress}><Activity size={16} /> My progress</button>}{profile?.role === "admin" && <button className="button button-quiet" onClick={onAdmin}><ShieldCheck size={16} /> Admin</button>}<button className="button button-outline" onClick={profile ? onProgress : onAuth}>{profile ? <><UserRound size={16} /> {profile.name}</> : <><LogIn size={16} /> Sign in</>}</button></div></header>
    <div className="picker-body"><div className="picker-copy"><span className="eyebrow"><span className="eyebrow-dot" /> YOUR MBA JOURNEY STARTS HERE</span><h1>Which exam are<br />you preparing for?</h1><p>{welcome}</p><div className="picker-perks"><span><Check size={15} /> Exam-specific question bank</span><span><Check size={15} /> Progress saved by exam</span></div></div>
      <div className="exam-card-grid">{exams.map((exam, index) => <button key={exam.id} className={`exam-card exam-${exam.color}`} onClick={() => onSelect(exam.id)}>
        <div className="exam-card-top"><span className="exam-card-icon">{index === 0 ? <Target /> : index === 1 ? <Zap /> : index === 2 ? <BookOpen /> : <Award />}</span><span className="card-arrow"><ArrowRight size={17} /></span></div>
        <h2>{exam.name}</h2><p>{exam.tagline}</p><span className="exam-card-bottom">Explore exam <ArrowRight size={14} /></span><span className="exam-card-shape" />
      </button>)}</div>
    </div><div className="picker-footer"><span>Built for focused practice. Made for your next big step.</span><span><ShieldCheck size={14} /> Your progress stays yours</span></div>
  </div>;
}

function LoginPortal({ darkMode, onToggleTheme, kind, busy, error, onChoose, onSubmit, onBack, onDismissError }: {
  darkMode: boolean; onToggleTheme: () => void; kind: LoginKind | "choose"; busy: boolean; error: string;
  onChoose: (kind: LoginKind) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void; onDismissError: () => void;
}) {
  return <main className="login-page">
    <header className="login-header"><a className="login-brand" href="#" onClick={(event) => { event.preventDefault(); onChoose("student"); }}><span className="brand-mark"><GraduationCap size={23} /></span><span><b>MBA Prep</b><small>EXAM PRACTICE</small></span></a><div className="login-header-actions"><ThemeToggle darkMode={darkMode} onToggle={onToggleTheme} /><span className="login-header-note"><ShieldCheck size={16} /> Secure account access</span></div></header>
    {kind === "choose" ? <section className="account-choice">
      <span className="eyebrow"><span className="eyebrow-dot" /> WELCOME TO YOUR MBA JOURNEY</span>
      <h1>Choose your account</h1><p>Sign in to continue to your personalized preparation space.</p>
      <div className="account-choice-grid">
        <button type="button" className="account-choice-card student-choice" onClick={() => onChoose("student")}>
          <span className="account-choice-icon"><GraduationCap size={26} /></span><span className="account-choice-title">Student Login</span>
          <span className="account-choice-description">Practice CAT, CMAT, MAT and XAT, and track your personal progress.</span>
          <span className="account-choice-link">Student ID and password <ArrowRight size={16} /></span>
        </button>
        <button type="button" className="account-choice-card admin-choice" onClick={() => onChoose("admin")}>
          <span className="account-choice-icon"><ShieldCheck size={26} /></span><span className="account-choice-title">Admin Login</span>
          <span className="account-choice-description">Private access to question management, student records and site settings.</span>
          <span className="account-choice-link">Secure admin sign in <ArrowRight size={16} /></span>
          <span className="admin-only-badge">AUTHORIZED ADMIN ONLY</span>
        </button>
      </div>
      {error && <div className="login-error login-chooser-error"><CircleHelp size={17} />{error}<button onClick={onDismissError} aria-label="Dismiss message"><X size={15} /></button></div>}
      <div className="demo-login-note"><CircleHelp size={16} /> Accounts and progress are saved in this browser only.</div>
    </section> : <section className="login-form-card">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Change account type</button>
      <div className={`login-form-icon ${kind === "admin" ? "login-form-admin" : ""}`}>{kind === "admin" ? <ShieldCheck size={27} /> : <GraduationCap size={27} />}</div>
      <span className="eyebrow">{kind === "admin" ? "RESTRICTED ACCESS" : "YOUR PRACTICE, YOUR PROGRESS"}</span>
      <h1>{kind === "admin" ? "Admin Login" : "Student Login"}</h1>
      <p>{kind === "admin" ? "Sign in with the private Admin ID and password." : "Enter the Student ID and password provided by your administrator."}</p>
      {error && <div className="login-error"><CircleHelp size={17} />{error}</div>}
      <form className="editor-form login-form" onSubmit={onSubmit}>
          <Field label={kind === "admin" ? "Admin ID" : "Student ID"} name="studentId" placeholder={kind === "admin" ? "Enter your Admin ID" : "Enter your Student ID"} required autoComplete="username" />
          <Field label={kind === "admin" ? "Admin Password" : "Password"} name="password" type="password" placeholder="Enter your password" required autoComplete="current-password" />
          <button className="button button-primary button-full" disabled={busy}>{busy ? "Please wait…" : kind === "admin" ? "Login to Admin Dashboard" : "Login to Student Portal"}</button>
      </form>
      <div className="admin-login-security"><ShieldCheck size={16} /> Student accounts are created and managed by the administrator. Account data is stored in this browser.</div>
    </section>}
    <footer className="login-footer"><span>Focused practice for your next big step.</span><span><ShieldCheck size={14} /> Student progress is private to each account</span></footer>
  </main>;
}

function ThemeToggle({ darkMode, onToggle }: { darkMode: boolean; onToggle: () => void }) {
  return <button className="theme-toggle" type="button" onClick={onToggle} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} title={darkMode ? "Light mode" : "Dark mode"}>
    {darkMode ? <Sun size={17} /> : <Moon size={17} />}<span>{darkMode ? "Light" : "Dark"}</span>
  </button>;
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
            <h4>Current Options</h4><ol className="report-options">{(["A", "B", "C", "D"] as const).map((answer) => <li key={answer}><b>{answer}.</b> <MathContent text={currentOptions?.[answer] ?? "Unavailable"} /></li>)}</ol>
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
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const toggle = (key: "hiddenExamIds" | "hiddenSectionIds", id: string) => setDraft((current) => ({
    ...current,
    [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id],
  }));
  return <form className="page-stack settings-page" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
    <section className="section-heading page-title"><div><span className="eyebrow"><Settings size={14} /> ADMIN SETTINGS</span><h1>Customize website</h1><p>Safe display and visibility settings. Question data and navigation remain unchanged.</p></div><button className="button button-primary" type="submit">Save settings</button></section>
    <section className="settings-card"><h2>Brand and welcome</h2><p>These choices only affect the presentation shown to students.</p>
      <Field label="Website name" name="siteTitle" value={draft.title} onChange={(title) => setDraft({ ...draft, title: title.slice(0, 60) })} required />
      <label className="form-label">Welcome message<textarea rows={3} maxLength={240} value={draft.welcomeMessage} onChange={(event) => setDraft({ ...draft, welcomeMessage: event.target.value })} /></label>
      <Field label="Logo image URL (HTTPS)" name="logoUrl" value={draft.logoUrl} placeholder="https://example.com/logo.png" onChange={(logoUrl) => setDraft({ ...draft, logoUrl })} />
      {draft.logoUrl && <img className="settings-logo-preview" src={draft.logoUrl} alt="Logo preview" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      <label className="form-label">Theme color<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as SiteSettings["theme"] })}>{["violet", "blue", "green", "orange"].map((theme) => <option key={theme}>{theme}</option>)}</select></label>
    </section>
    <section className="settings-card"><h2>Exam visibility</h2><p>Hidden exams remain stored and editable by the admin; they are simply removed from the student exam picker.</p>
      <div className="visibility-list">{exams.map((exam) => <label key={exam.id}><input type="checkbox" checked={!draft.hiddenExamIds.includes(exam.id)} onChange={() => toggle("hiddenExamIds", exam.id)} /><span><b>{exam.name}</b><small>{exam.tagline}</small></span><span className={`visibility-tag ${draft.hiddenExamIds.includes(exam.id) ? "visibility-hidden" : ""}`}>{draft.hiddenExamIds.includes(exam.id) ? "Hidden" : "Visible"}</span></label>)}</div>
    </section>
    <section className="settings-card"><h2>Subject / section visibility</h2><p>Hide a section from student navigation without deleting its chapters, questions or progress.</p>
      <div className="visibility-list">{sections.map((section) => <label key={section.id}><input type="checkbox" checked={!draft.hiddenSectionIds.includes(section.id)} onChange={() => toggle("hiddenSectionIds", section.id)} /><span><b>{section.name}</b><small>{exams.find((exam) => exam.id === section.examId)?.name}</small></span><span className={`visibility-tag ${draft.hiddenSectionIds.includes(section.id) ? "visibility-hidden" : ""}`}>{draft.hiddenSectionIds.includes(section.id) ? "Hidden" : "Visible"}</span></label>)}</div>
    </section>
    <button className="button button-primary settings-save-bottom" type="submit">Save settings</button>
  </form>;
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
      return <article className="review-row" key={`${question.id}-${index}`}><span className={`review-status ${answer === undefined || answer === null ? "review-skip" : isCorrect ? "review-good" : "review-bad"}`}>{answer === undefined || answer === null ? "—" : isCorrect ? <Check size={15} /> : <X size={15} />}</span><div><h3><MathContent text={question.question} /></h3><p>{answer === undefined || answer === null ? "Unattempted" : `Your answer: ${answer} · Correct answer: ${question.correctAnswer}`}</p>{question.explanation && <MathContent className="solution-content" text={question.explanation} />}</div><span className="status-pill">{answer === undefined || answer === null ? "Skipped" : isCorrect ? "Correct" : "Wrong"}</span></article>;
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
  return <label className="form-label">{label}<input name={name} type={type} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} required={required} minLength={minLength} autoComplete={autoComplete} /></label>;
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
  const [options, setOptions] = useState<Record<Answer, string>>(question?.options ?? { A: "", B: "", C: "", D: "" });
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
      const questionDraft: Question = {
        id,
        examId: "",
        sectionId: "",
        chapterId: "",
        question: questionText,
        options,
        correctAnswer: answer || undefined,
        hasAnswerKey: Boolean(answer),
        explanation: String(fields.get("explanation")),
        difficulty,
      };
      setLiveQuestion(questionText);
      setLiveExplanation(questionDraft.explanation ?? "");
      setAnswerCheck(checkMathAnswer(questionDraft));
      setReviewAcknowledged(false);
      const classification = classify(`${questionText}\n${Object.values(options).join("\n")}\n${questionDraft.explanation}`);
      setDraft(questionDraft);
      setSuggestion(classification);
    } else {
      const updated: Question = {
        ...(question ?? {}),
        id, examId, sectionId, chapterId, topic: validChapters.find((chapter) => chapter.id === chapterId)?.name ?? "",
        subTopic: subTopic.trim(), question: String(fields.get("question")),
        options, correctAnswer: answer || undefined, hasAnswerKey: Boolean(answer), explanation: String(fields.get("explanation")), difficulty,
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
      <div className="editor-option-previews">{answerOptions.map((key) => <div key={key}><b>{key}</b><MathContent text={draft.options[key]} /></div>)}</div>
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
        <div className="option-editor">{answerOptions.map((key) => <label key={key} className="form-label"><span>Option {key}</span><input value={options[key]} onChange={(event) => { setOptions({ ...options, [key]: event.target.value }); setAnswerCheck(null); setReviewAcknowledged(false); }} required placeholder={`Enter option ${key}`} /><MathPreview label={`Option ${key} preview`} text={options[key]} className="editor-option-preview" /></label>)}</div>
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
