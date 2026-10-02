import type { Chapter, Exam, Question, Section } from "./model";

export type QuestionClassification = {
  examId: string;
  sectionId: string;
  chapterId: string;
  topic: string;
  subTopic: string;
  confidence: "High" | "Medium" | "Low";
  reason: string;
};

type ClassificationCatalog = {
  exams: Exam[];
  sections: Section[];
  chapters: Chapter[];
};

type Category = "quant" | "verbal" | "reasoning" | "data" | "awareness" | "innovation" | "decision";

function matchSection(sections: Section[], category: Category): Section | undefined {
  const aliases: Record<typeof category, string[]> = {
    quant: ["quantitative", "mathematical skills", "math"],
    verbal: ["verbal", "language comprehension", "reading comprehension"],
    reasoning: ["logical reasoning", "critical reasoning", "intelligence"],
    data: ["data interpretation", "data analysis", "sufficiency"],
    awareness: ["general awareness", "general knowledge", "business environment"],
    innovation: ["innovation", "entrepreneurship"],
    decision: ["decision making"],
  };
  return sections.find((section) => aliases[category].some((name) => section.name.toLowerCase().includes(name)));
}

function classifyContent(rawText: string): { category: Category; topic: string; subTopic: string; reason: string; confidence: QuestionClassification["confidence"]; examHint: string } {
  const text = rawText.toLowerCase();
  const stem = rawText.split(/\r?\n/, 1)[0];
  const variables = new Set([
    ...(stem.match(/[a-z](?=\s*[+\-−=<>])/gi) ?? []),
    ...(stem.match(/(?:\d|[+\-−])\s*([a-z])\b/gi) ?? []).map((item) => item.slice(-1)),
  ].map((item) => item.toLowerCase()).filter((item) => item !== "i"));
  const equationLike = /(?:[a-z]\s*[+\-−=<>]|[+\-−]\s*[a-z])/.test(text)
    && (/\b(?:solve|equation|variable|find|value|system)\b/.test(text) || (text.match(/[=]/g) ?? []).length > 0);

  if (/\b(decision|manager|ethical|stakeholder|supplier|conflict of interest|best course of action|most appropriate action)\b/.test(text)) {
    const ethical = /ethic|conflict|responsib|fair|safety/.test(text);
    return { category: "decision", topic: ethical ? "Ethical Decisions" : "Case Analysis", subTopic: ethical ? "Ethical Decision Making" : "Business Case Analysis", reason: "The question asks for a judgment or action in a scenario.", confidence: "Medium", examHint: "xat" };
  }
  if (/\b(startup|entrepreneur|minimum viable product|business model|venture capital|innovation|market validation)\b/.test(text)) {
    return { category: "innovation", topic: "Entrepreneurship Basics", subTopic: /minimum viable|mvp|prototype|validation/.test(text) ? "Product Validation and MVP" : "Entrepreneurship", reason: "The concepts concern entrepreneurship, innovation, or validating a business idea.", confidence: "High", examHint: "cmat" };
  }
  if (/\b(gdp|inflation|central bank|reserve bank|fiscal policy|monetary policy|current affairs|headquarters|world trade organization|imf|sebi|niti aayog)\b/.test(text)) {
    return { category: "awareness", topic: "Business & Economy", subTopic: /inflation|gdp|fiscal|monetary|central bank/.test(text) ? "Economy and Public Policy" : "Institutions and Current Affairs", reason: "The question tests general or business awareness rather than a calculation method.", confidence: "High", examHint: "cmat" };
  }
  if (/\b(table|chart|graph|pie chart|bar graph|line graph|data set|following data|sales in|revenue in|quarter|q1|q2)\b/.test(text)) {
    return { category: "data", topic: "Tables & Charts", subTopic: /sufficient|statement i|statement ii|data sufficiency/.test(text) ? "Data Sufficiency" : "Tables, Charts & Graphs", reason: "The solution depends on interpreting a presented data set or visual.", confidence: "High", examHint: "cat" };
  }
  if (/\b(synonym|antonym|closest in meaning|meaning of|grammatically|grammar|sentence completion|passage|author's|main idea|inference from the passage|reading comprehension)\b/.test(text)) {
    return { category: "verbal", topic: /grammar|sentence/.test(text) ? "Grammar & Vocabulary" : "Reading Comprehension", subTopic: /synonym|antonym|meaning|vocabulary/.test(text) ? "Vocabulary" : /grammar|sentence/.test(text) ? "Grammar and Usage" : "Reading Comprehension", reason: "The task tests language, grammar, vocabulary, or comprehension.", confidence: "High", examHint: "cat" };
  }
  if (/\b(arrangement|seating|row|circular|left of|right of|north|south|east|west|direction|coding|coded|syllogism|odd one out|series|next number|sequence|conclusion|inference|premise|all .* are|some .* are)\b/.test(text) && !equationLike) {
    return { category: "reasoning", topic: /series|sequence|next number|odd one out/.test(text) ? "Series & Coding" : /seating|arrangement|row|circular/.test(text) ? "Arrangements" : "Critical Reasoning", subTopic: /series|sequence|next number/.test(text) ? "Number Series" : /seating|arrangement/.test(text) ? "Seating Arrangement" : /coding/.test(text) ? "Coding and Decoding" : "Logical Reasoning", reason: "The question requires pattern, ordering, or logical inference rather than numerical computation.", confidence: "Medium", examHint: "cat" };
  }
  if (/\b(circle|triangle|rectangle|polygon|perimeter|area|volume|angle|radius|diameter|surface area|coordinate geometry)\b/.test(text)) {
    return { category: "quant", topic: "Geometry", subTopic: /circle|radius|diameter|circumference/.test(text) ? "Circles" : /volume|surface area|3d|cylinder|cone|sphere/.test(text) ? "Mensuration" : "Plane Geometry", reason: "The required method uses geometric properties or measurement formulas.", confidence: "High", examHint: "cat" };
  }
  if (/\b(quadratic|roots of|discriminant|x\s*(?:\^|²|2)|polynomial)\b/.test(text)) {
    return { category: "quant", topic: "Algebra", subTopic: "Quadratic Equations", reason: "The question uses a polynomial or quadratic equation method.", confidence: "High", examHint: "cat" };
  }
  if (equationLike) {
    const count = variables.size;
    return {
      category: "quant",
      topic: "Algebra",
      subTopic: count >= 3 ? "Linear Equations in Three Variables" : count === 2 ? "Linear Equations in Two Variables" : "Linear Equations",
      reason: "The question expresses relationships with variables and requires manipulating a linear equation or system.",
      confidence: count >= 2 ? "High" : "Medium",
      examHint: "cat",
    };
  }
  if (/\b(divisib|remainder|factor|prime number|integer|multiple|gcd|lcm|highest common factor|least common multiple|modulo)\b/.test(text)) {
    return { category: "quant", topic: "Number Systems", subTopic: /remainder|modulo/.test(text) ? "Remainders" : /factor|gcd|lcm|common factor|common multiple/.test(text) ? "Factors and Multiples" : "Divisibility", reason: "The solution depends on integer properties, divisibility, or remainders.", confidence: "High", examHint: "cat" };
  }
  if (/\b(percentage|percent|profit|loss|discount|interest|ratio|proportion|average|mixture|work rate|speed|distance|time|selling price|marked price|cost price)\b/.test(text)) {
    const topic = /percentage|percent/.test(text) ? "Percentages" : /profit|loss|discount|selling price|marked price|cost price/.test(text) ? "Profit & Loss" : /ratio|proportion/.test(text) ? "Ratio & Proportion" : /average/.test(text) ? "Averages" : "Arithmetic";
    return { category: "quant", topic: topic === "Percentages" || topic === "Profit & Loss" || topic === "Ratio & Proportion" || topic === "Averages" ? "Arithmetic" : topic, subTopic: topic, reason: "The question's solution uses a specific arithmetic relationship or operation.", confidence: "Medium", examHint: "cat" };
  }
  if (/\d/.test(text) && /[+*/÷×%]/.test(text)) {
    return { category: "quant", topic: "Arithmetic", subTopic: "Numerical Operations", reason: "The question explicitly requires direct numerical operations; numbers alone are not treated as arithmetic.", confidence: "Low", examHint: "cat" };
  }
  return { category: "reasoning", topic: "Critical Reasoning", subTopic: "General Reasoning", reason: "No sufficiently specific subject method was detected. Review and adjust this low-confidence suggestion.", confidence: "Low", examHint: "cat" };
}

export function classifyQuestion(text: string, catalog: ClassificationCatalog): QuestionClassification {
  const inferred = classifyContent(text);
  const preferredExam = catalog.exams.find((exam) => exam.id === inferred.examHint) ?? catalog.exams[0];
  const preferredSections = catalog.sections.filter((section) => section.examId === preferredExam?.id);
  let section = matchSection(preferredSections, inferred.category);

  if (!section) {
    const compatible = catalog.exams.flatMap((exam) => {
      const candidate = matchSection(catalog.sections.filter((item) => item.examId === exam.id), inferred.category);
      return candidate ? [{ exam, section: candidate }] : [];
    });
    const match = compatible.find(({ exam }) => exam.id === inferred.examHint) ?? compatible[0];
    section = match?.section;
  }
  const exam = catalog.exams.find((item) => item.id === section?.examId) ?? preferredExam;
  const topicChapters = catalog.chapters.filter((chapter) => chapter.examId === exam?.id && chapter.sectionId === section?.id);
  const chapter = topicChapters.find((item) => item.name.toLowerCase() === inferred.topic.toLowerCase())
    ?? topicChapters.find((item) => inferred.topic === "Algebra" && /algebra/i.test(item.name))
    ?? topicChapters.find((item) => inferred.topic === "Arithmetic" && /arithmetic/i.test(item.name))
    ?? topicChapters.find((item) => inferred.topic === "Number Systems" && /number/i.test(item.name));
  const sectionConfidence = section ? inferred.confidence : "Low";
  return {
    examId: exam?.id ?? "",
    sectionId: section?.id ?? "",
    chapterId: chapter?.id ?? "",
    topic: inferred.topic,
    subTopic: inferred.subTopic,
    confidence: sectionConfidence,
    reason: inferred.reason,
  };
}

export function applyClassification(question: Question, classification: QuestionClassification, catalog: ClassificationCatalog, recategorize: boolean): Question {
  const validSection = catalog.sections.some((section) => section.id === question.sectionId && section.examId === question.examId);
  const sectionId = recategorize || !validSection ? classification.sectionId : question.sectionId;
  const examId = recategorize || !validSection ? classification.examId : question.examId;
  const validChapter = catalog.chapters.some((chapter) => chapter.id === question.chapterId && chapter.sectionId === sectionId && chapter.examId === examId);
  const chapterId = recategorize || !validChapter ? classification.chapterId : question.chapterId;
  const existingChapter = catalog.chapters.find((chapter) => chapter.id === question.chapterId
    && chapter.examId === question.examId && chapter.sectionId === question.sectionId);
  const topic = recategorize
    ? classification.topic
    : question.topic ?? existingChapter?.name ?? classification.topic;
  return {
    ...question,
    examId,
    sectionId,
    chapterId,
    topic,
    subTopic: recategorize || !question.subTopic ? classification.subTopic : question.subTopic,
  };
}
