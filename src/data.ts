import type { Chapter, Exam, Question, Section } from "./model";

export const initialExams: Exam[] = [
  { id: "cat", name: "CAT", tagline: "Common Admission Test", color: "violet" },
  { id: "cmat", name: "CMAT", tagline: "Common Management Admission Test", color: "blue" },
  { id: "mat", name: "MAT", tagline: "Management Aptitude Test", color: "green" },
  { id: "xat", name: "XAT", tagline: "Xavier Aptitude Test", color: "orange" },
];

const sectionNames: Record<string, string[]> = {
  cat: ["Quantitative Aptitude", "Logical Reasoning", "Data Interpretation", "Verbal Ability & Reading Comprehension"],
  cmat: ["Quantitative Techniques", "Logical Reasoning", "Language Comprehension", "General Awareness", "Innovation & Entrepreneurship"],
  mat: ["Language Comprehension", "Intelligence & Critical Reasoning", "Mathematical Skills", "Data Analysis & Sufficiency", "Economic & Business Environment"],
  xat: ["Verbal Ability & Logical Reasoning", "Decision Making", "Quantitative Ability & Data Interpretation", "General Knowledge"],
};

const topics: Record<string, string[]> = {
  "Quantitative Aptitude": ["Arithmetic", "Algebra"],
  "Logical Reasoning": ["Arrangements", "Series & Coding"],
  "Data Interpretation": ["Tables & Charts", "Data Sufficiency"],
  "Verbal Ability & Reading Comprehension": ["Reading Comprehension", "Grammar & Vocabulary"],
  "Quantitative Techniques": ["Arithmetic", "Number Systems"],
  "Language Comprehension": ["Reading Comprehension", "Vocabulary"],
  "General Awareness": ["Business & Economy", "Current Affairs"],
  "Innovation & Entrepreneurship": ["Entrepreneurship Basics", "Innovation"],
  "Intelligence & Critical Reasoning": ["Arrangements", "Critical Reasoning"],
  "Mathematical Skills": ["Arithmetic", "Algebra"],
  "Data Analysis & Sufficiency": ["Tables & Charts", "Data Sufficiency"],
  "Economic & Business Environment": ["Business & Economy", "Indian Economy"],
  "Verbal Ability & Logical Reasoning": ["Reading Comprehension", "Critical Reasoning"],
  "Decision Making": ["Ethical Decisions", "Case Analysis"],
  "Quantitative Ability & Data Interpretation": ["Arithmetic", "Tables & Charts"],
  "General Knowledge": ["Business & Economy", "Current Affairs"],
};

export const initialSections: Section[] = initialExams.flatMap((exam) =>
  sectionNames[exam.id].map((name, index) => ({ id: `${exam.id}-s${index + 1}`, examId: exam.id, name })),
);

export const initialChapters: Chapter[] = initialSections.flatMap((section) =>
  (topics[section.name] ?? ["Fundamentals", "Practice"]).map((name, index) => ({
    id: `${section.id}-c${index + 1}`,
    examId: section.examId,
    sectionId: section.id,
    name,
  })),
);

export const initialQuestions: Question[] = [];