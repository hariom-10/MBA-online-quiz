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
