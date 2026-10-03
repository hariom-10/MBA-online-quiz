import pdfSolutions from "../firestore-import/cat-2024-slot-3.json";

type PdfSolution = { question: string; answer: string; explanation: string };

function normalizeQuestion(value: string) {
  return value.toLowerCase()
    .replace(/\\triangle|△/g, " triangle ")
    .replace(/\\sqrt|√/g, " sqrt ")
    .replace(/\\(?:max|min|log)\b/g, " $& ")
    .replace(/\\circ|°|degrees?/g, " degree ")
    .replace(/\\(?:left|right|begin|end|aligned|frac|mathrm|text|operatorname)\b/g, " ")
    .replace(/\b(?:sq\.?|square)\s*(?:centimeters?|centimetres?|cm)\^?2\b/g, " squarecm2 ")
    .replace(/\bcentimeters?\b|\bcentimetres?\b/g, "cm")
    .replace(/\bmeters?\b|\bmetres?\b/g, "meter")
    .replace(/\blitres?\b|\bliters?\b/g, "litre")
    .replace(/[^a-z0-9]/g, "");
}

const solutionsByQuestion = new Map<string, PdfSolution>();
for (const solution of pdfSolutions as PdfSolution[]) {
  const key = normalizeQuestion(solution.question);
  if (solutionsByQuestion.has(key)) solutionsByQuestion.delete(key);
  else solutionsByQuestion.set(key, solution);
}

export function findCat2024Slot3Solution(question: string): PdfSolution | undefined {
  return solutionsByQuestion.get(normalizeQuestion(question));
}
