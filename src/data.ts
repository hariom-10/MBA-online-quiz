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
  "Quantitative Aptitude": [
    { text: "What is 20% of 250?", options: ["25", "40", "50", "60"] },
    { text: "A sum of ₹800 is divided in the ratio 3:5. What is the larger share?", options: ["₹300", "₹400", "₹500", "₹600"] },
  ],
  "Quantitative Techniques": [
    { text: "A product marked at ₹1,000 is sold at a 15% discount. What is its selling price?", options: ["₹750", "₹800", "₹850", "₹950"] },
    { text: "The average of 12, 18 and 24 is:", options: ["16", "18", "20", "22"] },
  ],
  "Mathematical Skills": [
    { text: "If 3x + 5 = 20, what is x?", options: ["3", "4", "5", "6"] },
    { text: "A car travels 150 km in 3 hours. Its average speed is:", options: ["30 km/h", "45 km/h", "50 km/h", "60 km/h"] },
  ],
  "Logical Reasoning": [
    { text: "Find the next number: 2, 6, 12, 20, 30, ?", options: ["36", "40", "42", "44"] },
    { text: "If each letter is replaced by the next letter in the alphabet, CAT becomes DBU. How is DOG written?", options: ["EPH", "EOG", "DPH", "FPH"] },
  ],
  "Intelligence & Critical Reasoning": [
    { text: "Find the odd one out: 16, 25, 36, 48, 64.", options: ["16", "25", "48", "64"] },
    { text: "If all managers are graduates and some graduates are analysts, which statement must be true?", options: ["All analysts are managers", "Some managers are analysts", "All managers are graduates", "No graduates are managers"] },
  ],
  "Data Interpretation": [
    { text: "A shop sold 40, 50 and 60 units over three days. What was the average daily sale?", options: ["45", "50", "55", "60"] },
    { text: "Revenue rose from ₹80 lakh to ₹100 lakh. What was the percentage increase?", options: ["20%", "25%", "30%", "40%"] },
  ],
  "Data Analysis & Sufficiency": [
    { text: "A value rises from 120 to 150. What is the percentage rise?", options: ["20%", "25%", "30%", "35%"] },
    { text: "The ratio of two values is 2:3 and their sum is 45. The smaller value is:", options: ["15", "18", "20", "27"] },
  ],
  "Verbal Ability & Reading Comprehension": [
    { text: "Choose the word closest in meaning to “prudent”.", options: ["Careless", "Wise", "Hasty", "Uncertain"] },
    { text: "Choose the grammatically correct sentence.", options: ["Neither answer are correct.", "Neither answer is correct.", "Neither answers is correct.", "Neither answer were correct."] },
  ],
  "Language Comprehension": [
    { text: "Choose the antonym of “abundant”.", options: ["Plentiful", "Scarce", "Sufficient", "Numerous"] },
    { text: "Complete the sentence: The committee ___ its report yesterday.", options: ["submit", "submits", "submitted", "submitting"] },
  ],
  "General Awareness": [
    { text: "Which institution is India's central bank?", options: ["SEBI", "NABARD", "Reserve Bank of India", "NITI Aayog"] },
    { text: "GDP is primarily a measure of:", options: ["A country's total output", "Income tax rates", "Population growth", "Exports only"] },
  ],
  "Innovation & Entrepreneurship": [
    { text: "A minimum viable product (MVP) is best described as:", options: ["A fully featured final product", "A basic product used to test assumptions", "A marketing campaign", "A business registration"] },
    { text: "Which is most useful for testing whether customers will pay for a new idea?", options: ["A validated pilot", "A longer mission statement", "A larger office", "A new logo"] },
  ],
  "Economic & Business Environment": [
    { text: "Inflation refers to:", options: ["A sustained rise in the general price level", "A fall in employment only", "A rise in exports only", "A decrease in money supply"] },
    { text: "Which is a fiscal policy instrument?", options: ["Repo rate", "Government taxation", "Open market operations", "Cash reserve ratio"] },
  ],
  "Decision Making": [
    { text: "A manager discovers a safety issue shortly before launch. What is the most responsible first step?", options: ["Ignore it to meet the deadline", "Assess risk and escalate it promptly", "Blame the supplier publicly", "Launch and fix it later"] },
    { text: "Two team members disagree on an evidence-based proposal. The best next step is to:", options: ["Choose the more senior person's view", "Compare evidence against shared criteria", "Delay indefinitely", "Let the team vote without discussion"] },
  ],
  "Verbal Ability & Logical Reasoning": [
    { text: "Choose the word closest in meaning to “concise”.", options: ["Brief", "Confusing", "Detailed", "Unrelated"] },
    { text: "All editors read carefully. Mira is an editor. What follows?", options: ["Mira writes novels", "Mira reads carefully", "Everyone who reads is an editor", "Mira edits every book"] },
  ],
  "Decision Making & Ethics": [
    { text: "A supplier offers a personal gift during a tender. What should you do?", options: ["Accept discreetly", "Decline and follow the conflict-of-interest policy", "Share it with the team", "Accept after the award"] },
  ],
  "Quantitative Ability & Data Interpretation": [
    { text: "If sales are 120 units in Q1 and 150 in Q2, the increase is:", options: ["20%", "25%", "30%", "35%"] },
    { text: "The mean of 5, 10, 15 and 20 is:", options: ["10", "12.5", "15", "17.5"] },
  ],
  "General Knowledge": [
    { text: "The headquarters of the World Trade Organization is in:", options: ["Paris", "Geneva", "New York", "Vienna"] },
    { text: "Which organization publishes the World Economic Outlook?", options: ["IMF", "WTO", "UNESCO", "ILO"] },
  ],
};

export const initialQuestions: Question[] = initialSections.flatMap((section) => {
  const chapterList = initialChapters.filter((chapter) => chapter.sectionId === section.id);
  const rows = examples[section.name] ?? examples["Logical Reasoning"];
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
