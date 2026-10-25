export type Difficulty = "Easy" | "Medium" | "Hard";
export type Answer = "A" | "B" | "C" | "D";

export type Exam = { id: string; name: string; tagline: string; color: string };
export type Section = { id: string; examId: string; name: string };
export type Chapter = { id: string; examId: string; sectionId: string; name: string };
export type Question = {
  id: string;
  examId: string;
  sectionId: string;
  chapterId: string;
  topic?: string;
  subTopic?: string;
  question: string;
  options: Record<Answer, string>;
  correctAnswer?: string;
  answerMode?: "choice" | "text";
  hasAnswerKey?: boolean;
  explanation?: string;
  difficulty: Difficulty;
  sourceYear?: number;
  sourceSlot?: string;
  sourceSection?: string;
  sourceUrl?: string;
  exam?: string;
  year?: number;
  slot?: number | string;
  subject?: string;
  question_number?: number;
  correct_answer?: string;
  source?: string;
  confidence?: string;
  optionsList?: string[];
  questionType?: string;
  tags?: string[];
  aiConfidence?: "High" | "Medium" | "Low";
  aiConfidenceReason?: string;
  paperId?: string;
  paperTitle?: string;
  imageUrl?: string;
  imageAlt?: string;
  hasDiagram?: boolean;
};

export type ExtractedPaper = {
  id: string;
  fileName: string;
  paperTitle: string;
  examId: string;
  examName: string;
  year: number;
  slot: string;
  extractedAt: string;
  extractedBy: string;
  totalQuestions: number;
  approvedCount: number;
  rejectedCount: number;
  status: "Completed" | "In Review" | "Partially Approved";
  extractedQuestions?: unknown[];
};
export type Attempt = {
  questionId: string;
  examId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  attemptedAt: string;
  sessionId: string;
};
export type QuestionReportStatus = "Pending Review" | "Under Review" | "Accepted" | "Rejected" | "Resolved";
export type QuestionReport = {
  id: string;
  questionId: string;
  questionText: string;
  examId: string;
  examName: string;
  sectionId: string;
  sectionName: string;
  chapterId: string;
  chapterName: string;
  studentUid: string;
  studentId: string;
  studentName: string;
  reason: string;
  studentExplanation: string;
  evidencePath: string;
  status: QuestionReportStatus;
  adminResponse: string;
  submittedAt?: unknown;
  updatedAt?: unknown;
  evidenceDataUrl?: string;
};
export type QuestionChange = {
  id: string;
  questionId: string;
  relatedReportId: string;
  previous: Pick<Question, "question" | "options" | "topic" | "subTopic"> & { correctAnswer: string; explanation: string };
  next: Pick<Question, "question" | "options" | "topic" | "subTopic"> & { correctAnswer: string; explanation: string };
  adminUid: string;
  adminName: string;
  changedAt: string;
};
export type UserProfile = {
  uid: string;
  name: string;
  email: string;
  role: "student" | "admin";
  studentId?: string;
  phone?: string;
  status?: "active" | "disabled";
  createdAt?: string;
  lastLogin?: string;
};

export type StudentAccountInput = {
  name: string;
  studentId: string;
  password?: string;
  email: string;
  phone: string;
};

export type SiteSettings = {
  id: "public";
  title: string;
  welcomeMessage: string;
  logoUrl: string;
  theme: "violet" | "blue" | "green" | "orange";
  hiddenExamIds: string[];
  hiddenSectionIds: string[];
};

export const EXAM_IDS = ["cat", "cmat", "mat", "xat"] as const;

export type CbtQuestionStatus =
  | "not_visited"
  | "not_answered"
  | "answered"
  | "marked_for_review"
  | "answered_and_marked";

export type CbtExamResult = {
  paperId: string;
  paperTitle: string;
  examId: string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  rawScore: number;
  maxScore: number;
  accuracy: number;
  estimatedPercentile: number;
  totalTimeSeconds: number;
  answers: Record<string, string>;
  timeSpent: Record<string, number>;
  sectionScores: Record<string, { name: string; total: number; attempted: number; correct: number; incorrect: number; score: number }>;
  submittedAt: string;
};
