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

type Example = { text: string; options: [string, string, string, string] };
const examples: Record<string, Example[]> = {
  "Mathematical Skills": [
    { text: "If 3x + 5 = 20, what is x?", options: ["3", "4", "5", "6"] },
    { text: "A car travels 150 km in 3 hours. Its average speed is:", options: ["30 km/h", "45 km/h", "50 km/h", "60 km/h"] },
  ],
  "Intelligence & Critical Reasoning": [
    { text: "Find the odd one out: 16, 25, 36, 48, 64.", options: ["16", "25", "48", "64"] },
    { text: "If all managers are graduates and some graduates are analysts, which statement must be true?", options: ["All analysts are managers", "Some managers are analysts", "All managers are graduates", "No graduates are managers"] },
  ],
  "Data Analysis & Sufficiency": [
    { text: "A value rises from 120 to 150. What is the percentage rise?", options: ["20%", "25%", "30%", "35%"] },
    { text: "The ratio of two values is 2:3 and their sum is 45. The smaller value is:", options: ["15", "18", "20", "27"] },
  ],
  "Language Comprehension": [
    { text: "Choose the antonym of 'abundant'.", options: ["Plentiful", "Scarce", "Sufficient", "Numerous"] },
    { text: "Complete the sentence: The committee ___ its report yesterday.", options: ["submit", "submits", "submitted", "submitting"] },
  ],
  "Economic & Business Environment": [
    { text: "Inflation refers to:", options: ["A sustained rise in the general price level", "A fall in employment only", "A rise in exports only", "A decrease in money supply"] },
    { text: "Which is a fiscal policy instrument?", options: ["Repo rate", "Government taxation", "Open market operations", "Cash reserve ratio"] },
  ],
};

export const initialQuestions: Question[] = initialSections.flatMap((section) => {
  if (section.examId !== "mat") return [];
  const chapterList = initialChapters.filter((chapter) => chapter.sectionId === section.id);
  const rows = examples[section.name] ?? [];
  return rows.map((row, index) => ({
    id: `${section.id}-q${index + 1}`,
    examId: section.examId,
    sectionId: section.id,
    chapterId: chapterList[index % chapterList.length].id,
    question: row.text,
    options: { A: row.options[0], B: row.options[1], C: row.options[2], D: row.options[3] },
    difficulty: index === 0 ? "Easy" : "Medium",
  }));
});