import test from 'node:test';
import assert from 'node:assert/strict';

// Import modules to test
import {
  ALL_ANSWER_OPTIONS,
  normalizeOptionKey,
  getQuestionOptionKeys,
  validateQuestionForImport,
  evaluateStudentAnswer,
  checkQuestionNeedsReview,
  isOptionLine,
  questionChunks,
} from '../src/questionValidation.ts';

test('ALL_ANSWER_OPTIONS contains all 5 options: A, B, C, D, E', () => {
  assert.deepEqual(ALL_ANSWER_OPTIONS, ['A', 'B', 'C', 'D', 'E']);
});

test('normalizeOptionKey maps numeric and letter choices correctly', () => {
  assert.equal(normalizeOptionKey('1'), 'A');
  assert.equal(normalizeOptionKey('2'), 'B');
  assert.equal(normalizeOptionKey('3'), 'C');
  assert.equal(normalizeOptionKey('4'), 'D');
  assert.equal(normalizeOptionKey('5'), 'E');

  assert.equal(normalizeOptionKey('A'), 'A');
  assert.equal(normalizeOptionKey('b'), 'B');
  assert.equal(normalizeOptionKey('E'), 'E');
  assert.equal(normalizeOptionKey('e'), 'E');

  assert.equal(normalizeOptionKey('Option 5'), 'E');
  assert.equal(normalizeOptionKey('Choice E'), 'E');
  assert.equal(normalizeOptionKey('6'), undefined);
});

test('getQuestionOptionKeys returns 5 options when 5th option is present', () => {
  const q5 = {
    options: {
      A: '45 students',
      B: '60 students',
      C: '75 students',
      D: '90 students',
      E: 'None of the remaining options is correct',
    },
  };

  const keys = getQuestionOptionKeys(q5);
  assert.deepEqual(keys, ['A', 'B', 'C', 'D', 'E']);
});

test('getQuestionOptionKeys returns only 4 options for a 4-option question (no phantom 5th option)', () => {
  const q4 = {
    options: {
      A: '12',
      B: '15',
      C: '18',
      D: '24',
    },
  };

  const keys = getQuestionOptionKeys(q4);
  assert.deepEqual(keys, ['A', 'B', 'C', 'D']);
  assert.equal(keys.includes('E'), false);
});

test('getQuestionOptionKeys ignores empty or whitespace-only 5th option', () => {
  const qBlank5 = {
    options: {
      A: 'Apple',
      B: 'Banana',
      C: 'Cherry',
      D: 'Date',
      E: '   ',
    },
  };

  const keys = getQuestionOptionKeys(qBlank5);
  assert.deepEqual(keys, ['A', 'B', 'C', 'D']);
});

test('Bug 1: Full multi-paragraph question stem with student-switching conditions is preserved and validated', () => {
  const fullMultiParagraphStem = 
`In a prestigious university, 300 undergraduate students are enrolled across three academic streams: Science, Arts, and MatEco (Mathematical Economics). Initially, 120 students are in Science, 100 in Arts, and 80 in MatEco.

At the beginning of the second semester, students are permitted to switch streams subject to the following conditions:
1. Exactly 20% of the Science students switch to MatEco, and 10% switch to Arts.
2. From Arts, 15 students switch to Science and 25 students switch to MatEco.
3. From MatEco, half of the students switch equally between Science and Arts, while the remaining half stay in MatEco.

Furthermore, among students in MatEco after all switches, 60% decide to specialize in Economics while the remaining specialize in Mathematics.

How many students in total are taking Economics in the second semester?`;

  const validQuestion = {
    question: fullMultiParagraphStem,
    type: 'MCQ',
    options: {
      A: '42',
      B: '54',
      C: '66',
      D: '78',
      E: 'None of the remaining options is correct',
    },
    correctAnswer: 'E',
  };

  const result = validateQuestionForImport(validQuestion);
  assert.equal(result.isValid, true);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);

  // Verify that paragraphs remain intact
  const paragraphs = fullMultiParagraphStem.split(/\n\s*\n/);
  assert.equal(paragraphs.length, 4);
  assert.ok(paragraphs[0].includes('Science, Arts, and MatEco'));
  assert.ok(paragraphs[1].includes('switch streams'));
  assert.ok(paragraphs[2].includes('specialize in Economics'));
  assert.ok(paragraphs[3].includes('How many students in total are taking Economics'));
});

test('Bug 2: 5-option question evaluation allows selecting Option 5 / E', () => {
  const q5 = {
    id: 'mat_specialization_q1',
    question: 'How many students in total are taking Economics?',
    options: {
      A: '42',
      B: '54',
      C: '66',
      D: '78',
      E: 'None of the remaining options is correct',
    },
    correctAnswer: 'E',
  };

  // Student selects 'E'
  assert.equal(evaluateStudentAnswer(q5, 'E'), true);
  assert.equal(evaluateStudentAnswer(q5, 'e'), true);

  // Student selects '5'
  assert.equal(evaluateStudentAnswer(q5, '5'), true);

  // Student clicks exact text of option E
  assert.equal(evaluateStudentAnswer(q5, 'None of the remaining options is correct'), true);
  assert.equal(evaluateStudentAnswer(q5, 'none of the remaining options is correct.'), true);

  // Incorrect answers
  assert.equal(evaluateStudentAnswer(q5, 'A'), false);
  assert.equal(evaluateStudentAnswer(q5, '1'), false);
  assert.equal(evaluateStudentAnswer(q5, '42'), false);
  assert.equal(evaluateStudentAnswer(q5, 'D'), false);
});

test('Option 5 with numeric correctAnswer "5" evaluates correctly', () => {
  const q = {
    id: 'xat_q1',
    question: 'Which of the following statements must be true?',
    options: {
      A: 'Statement I only',
      B: 'Statement II only',
      C: 'Statements I and II',
      D: 'Statements II and III',
      E: 'None of the above',
    },
    correctAnswer: '5',
  };

  assert.equal(evaluateStudentAnswer(q, 'E'), true);
  assert.equal(evaluateStudentAnswer(q, '5'), true);
  assert.equal(evaluateStudentAnswer(q, 'None of the above'), true);
  assert.equal(evaluateStudentAnswer(q, 'A'), false);
});

test('Option 5 with text-based correctAnswer evaluates correctly', () => {
  const q = {
    id: 'mat_q2',
    question: 'Identify the odd one out.',
    options: {
      A: 'Cat',
      B: 'Dog',
      C: 'Elephant',
      D: 'Lion',
      E: 'None of the remaining options is correct',
    },
    correctAnswer: 'None of the remaining options is correct',
  };

  assert.equal(evaluateStudentAnswer(q, 'E'), true);
  assert.equal(evaluateStudentAnswer(q, '5'), true);
  assert.equal(evaluateStudentAnswer(q, 'None of the remaining options is correct'), true);
  assert.equal(evaluateStudentAnswer(q, 'A'), false);
});

test('Four-option questions evaluate correctly', () => {
  const q4 = {
    id: 'cat_q1',
    question: 'Find the value of x.',
    options: {
      A: '10',
      B: '20',
      C: '30',
      D: '40',
    },
    correctAnswer: 'C',
  };

  assert.equal(evaluateStudentAnswer(q4, 'C'), true);
  assert.equal(evaluateStudentAnswer(q4, '3'), true);
  assert.equal(evaluateStudentAnswer(q4, '30'), true);
  assert.equal(evaluateStudentAnswer(q4, 'A'), false);
  assert.equal(evaluateStudentAnswer(q4, 'E'), false);
});

test('TITA numerical evaluation with tolerances and fractions', () => {
  const titaQ = {
    id: 'cat_tita_1',
    question: 'Enter the value of 3/4 as a decimal or fraction.',
    options: { A: '', B: '', C: '', D: '' },
    questionType: 'TITA',
    correctAnswer: '0.75',
  };

  assert.equal(evaluateStudentAnswer(titaQ, '0.75'), true);
  assert.equal(evaluateStudentAnswer(titaQ, '.75'), true);
  assert.equal(evaluateStudentAnswer(titaQ, '3/4'), true);
  assert.equal(evaluateStudentAnswer(titaQ, '0.750'), true);
  assert.equal(evaluateStudentAnswer(titaQ, '0.80'), false);
});

test('Validation detects empty and missing question text', () => {
  const emptyQ = {
    question: '',
    type: 'MCQ',
    options: { A: '1', B: '2', C: '3', D: '4' },
    correctAnswer: 'A',
  };

  const res = validateQuestionForImport(emptyQ);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((err) => err.includes('missing or empty')));
});

test('Validation detects missing options (< 2 options)', () => {
  const singleOptQ = {
    question: 'What is the capital of France?',
    type: 'MCQ',
    options: { A: 'Paris', B: '', C: '', D: '' },
    correctAnswer: 'A',
  };

  const res = validateQuestionForImport(singleOptQ);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((err) => err.includes('at least 2 valid options')));
});

test('Validation detects missing 5th option when answer points to Option E', () => {
  const missing5th = {
    question: 'What is the sum of angles in a triangle?',
    type: 'MCQ',
    options: { A: '90', B: '180', C: '270', D: '360' },
    correctAnswer: 'E',
  };

  const res = validateQuestionForImport(missing5th);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((err) => err.includes('Option E/5, but the 5th option content is missing')));
});

test('Validation detects missing gap in options (e.g. Option B blank while Option C exists)', () => {
  const gappedQ = {
    question: 'Solve for x: 2x = 10',
    type: 'MCQ',
    options: { A: '5', B: '', C: '10', D: '15' },
    correctAnswer: 'A',
  };

  const res = validateQuestionForImport(gappedQ);
  assert.equal(res.isValid, false);
  assert.ok(res.errors.some((err) => err.includes('Option B is missing or empty while later options are present')));
});

test('checkQuestionNeedsReview returns needsReview: false for valid question with matched section and answer', () => {
  const sections = [{ id: 'sec-qa', examId: 'cat', name: 'Quantitative Aptitude' }];
  const item = {
    id: 'item-1',
    value: {
      questionNumber: 1,
      question: 'What is the sum of interior angles of a pentagon?',
      type: 'MCQ',
      options: ['360 degrees', '540 degrees', '720 degrees', '900 degrees'],
      correctAnswer: 'B',
      explanation: 'Formula is (n-2)*180 = 3*180 = 540 degrees.',
      examId: 'cat',
      subject: 'Quantitative Aptitude',
      section: 'Quantitative Aptitude',
      chapter: 'Geometry',
      topic: 'Polygons',
      difficulty: 'Medium',
      tags: ['geometry'],
      confidence: 'High',
      confidenceReason: 'Clear text and answer key found in source',
    },
    status: 'pending',
    duplicate: false,
    edited: false,
    createChapter: false,
  };

  const result = checkQuestionNeedsReview(item, sections);
  assert.equal(result.needsReview, false);
});

test('checkQuestionNeedsReview returns needsReview: true for low confidence question', () => {
  const sections = [{ id: 'sec-qa', examId: 'cat', name: 'Quantitative Aptitude' }];
  const item = {
    id: 'item-2',
    value: {
      questionNumber: 2,
      question: 'What is the value of x if 3x + 4 = 19?',
      type: 'MCQ',
      options: ['3', '5', '7', '9'],
      correctAnswer: 'B',
      explanation: '3x = 15 => x = 5',
      examId: 'cat',
      subject: 'Quantitative Aptitude',
      section: 'Quantitative Aptitude',
      chapter: 'Algebra',
      topic: 'Equations',
      difficulty: 'Easy',
      tags: [],
      confidence: 'Low',
      confidenceReason: 'OCR was blurry on page 4',
    },
    status: 'pending',
    duplicate: false,
    edited: false,
    createChapter: false,
  };

  const result = checkQuestionNeedsReview(item, sections);
  assert.equal(result.needsReview, true);
  assert.ok(result.reason.includes('OCR was blurry'));
});

test('checkQuestionNeedsReview returns needsReview: true when diagram is needed but snippet is not attached', () => {
  const sections = [{ id: 'sec-dilr', examId: 'cat', name: 'Data Interpretation' }];
  const item = {
    id: 'item-3',
    value: {
      questionNumber: 3,
      question: 'Based on the bar chart shown below, which year had the highest sales?',
      type: 'MCQ',
      options: ['2021', '2022', '2023', '2024'],
      correctAnswer: 'C',
      explanation: 'Refer to peak bar in 2023',
      examId: 'cat',
      subject: 'Data Interpretation',
      section: 'Data Interpretation',
      chapter: 'Bar Charts',
      topic: 'Sales Trends',
      difficulty: 'Medium',
      tags: [],
      confidence: 'High',
      confidenceReason: '',
      hasDiagram: true,
      imageUrl: undefined, // Missing snippet
    },
    status: 'pending',
    duplicate: false,
    edited: false,
    createChapter: false,
  };

  const result = checkQuestionNeedsReview(item, sections);
  assert.equal(result.needsReview, true);
  assert.ok(result.reason.includes('Diagram / graph snippet needed'));
});

test('checkQuestionNeedsReview returns needsReview: true for unmatched section', () => {
  const sections = [{ id: 'sec-qa', examId: 'cat', name: 'Quantitative Aptitude' }];
  const item = {
    id: 'item-4',
    value: {
      questionNumber: 4,
      question: 'Which of the following words is a synonym for ephemerality?',
      type: 'MCQ',
      options: ['Transience', 'Permanence', 'Eternity', 'Stability'],
      correctAnswer: 'A',
      explanation: 'Ephemerality means lasting a very short time.',
      examId: 'cat',
      subject: 'VARC',
      section: 'Verbal Ability & Reading Comprehension',
      chapter: 'Vocabulary',
      topic: 'Synonyms',
      difficulty: 'Medium',
      tags: [],
      confidence: 'High',
      confidenceReason: '',
    },
    status: 'pending',
    duplicate: false,
    edited: false,
    createChapter: false,
  };

  const result = checkQuestionNeedsReview(item, sections);
  assert.equal(result.needsReview, true);
  assert.ok(result.reason.includes('Unmatched section'));
});

test('checkQuestionNeedsReview returns needsReview: true for duplicate question', () => {
  const sections = [{ id: 'sec-qa', examId: 'cat', name: 'Quantitative Aptitude' }];
  const item = {
    id: 'item-5',
    value: {
      questionNumber: 5,
      question: 'What is 15% of 200?',
      type: 'MCQ',
      options: ['20', '25', '30', '35'],
      correctAnswer: 'C',
      explanation: '15/100 * 200 = 30',
      examId: 'cat',
      subject: 'Quantitative Aptitude',
      section: 'Quantitative Aptitude',
      chapter: 'Arithmetic',
      topic: 'Percentages',
      difficulty: 'Easy',
      tags: [],
      confidence: 'High',
      confidenceReason: '',
    },
    status: 'pending',
    duplicate: true,
    edited: false,
    createChapter: false,
  };

  const result = checkQuestionNeedsReview(item, sections);
  assert.equal(result.needsReview, true);
  assert.ok(result.reason.includes('duplicate'));
});

test('isOptionLine correctly identifies options and ignores questions', () => {
  // Option patterns
  assert.equal(isOptionLine('(1) 45 students'), true);
  assert.equal(isOptionLine('(2) 60 students'), true);
  assert.equal(isOptionLine('(3) 75 students'), true);
  assert.equal(isOptionLine('(4) 90 students'), true);
  assert.equal(isOptionLine('(5) None of the remaining options is correct'), true);

  assert.equal(isOptionLine('(A) 12'), true);
  assert.equal(isOptionLine('(B) 24'), true);
  assert.equal(isOptionLine('(c) 36'), true);
  assert.equal(isOptionLine('(D) 48'), true);
  assert.equal(isOptionLine('(E) 60'), true);

  assert.equal(isOptionLine('1) First option'), true);
  assert.equal(isOptionLine('2) Second option'), true);
  assert.equal(isOptionLine('A) Option A text'), true);
  assert.equal(isOptionLine('B. Option B text'), true);

  assert.equal(isOptionLine('[1] Bracket 1'), true);
  assert.equal(isOptionLine('[A] Bracket A'), true);

  assert.equal(isOptionLine('Option 1: 50%'), true);
  assert.equal(isOptionLine('Option (A): 100%'), true);
  assert.equal(isOptionLine('Choice C: Rs. 400'), true);

  // Non-option lines (questions, stems, general text)
  assert.equal(isOptionLine('Question 1: What is the sum of angles?'), false);
  assert.equal(isOptionLine('Q1. Find the value of x in the diagram.'), false);
  assert.equal(isOptionLine('Prob 2: Solve the quadratic equation.'), false);
  assert.equal(isOptionLine('In a university, 300 undergraduate students are enrolled.'), false);
  assert.equal(isOptionLine('120 students are in Science, 100 in Arts.'), false);
  assert.equal(isOptionLine(''), false);
});

test('questionChunks does not split numbered options (1)-(4) into separate questions or shift options', () => {
  const paperText = `
Question 1.
In a class of 60 students, 40 like cricket and 30 like football.
How many students like both sports?
(1) 10
(2) 15
(3) 20
(4) 25

Question 2.
A train travelling at 72 km/h crosses a platform of length 200 m in 20 seconds.
What is the length of the train?
(1) 150 m
(2) 200 m
(3) 250 m
(4) 300 m
`;

  const chunks = questionChunks(paperText, 2);
  assert.equal(chunks.length, 1); // 2 questions fit in maxPerChunk = 2

  const singleChunk = chunks[0];
  // Verify Question 1 has all 4 of its options
  assert.ok(singleChunk.includes('(1) 10'));
  assert.ok(singleChunk.includes('(2) 15'));
  assert.ok(singleChunk.includes('(3) 20'));
  assert.ok(singleChunk.includes('(4) 25'));

  // Verify Question 2 has all 4 of its options
  assert.ok(singleChunk.includes('(1) 150 m'));
  assert.ok(singleChunk.includes('(2) 200 m'));
  assert.ok(singleChunk.includes('(3) 250 m'));
  assert.ok(singleChunk.includes('(4) 300 m'));

  // Now test chunking with maxPerChunk = 1 (each question in its own chunk)
  const individualChunks = questionChunks(paperText, 1);
  assert.equal(individualChunks.length, 2);

  const chunk1 = individualChunks[0];
  const chunk2 = individualChunks[1];

  // Chunk 1 should contain Question 1 and all of Question 1's options
  assert.ok(chunk1.includes('In a class of 60 students'));
  assert.ok(chunk1.includes('(1) 10'));
  assert.ok(chunk1.includes('(2) 15'));
  assert.ok(chunk1.includes('(3) 20'));
  assert.ok(chunk1.includes('(4) 25'));
  // Chunk 1 must NOT contain Question 2's options
  assert.ok(!chunk1.includes('150 m'));

  // Chunk 2 should contain Question 2 and all of Question 2's options
  assert.ok(chunk2.includes('A train travelling at 72 km/h'));
  assert.ok(chunk2.includes('(1) 150 m'));
  assert.ok(chunk2.includes('(2) 200 m'));
  assert.ok(chunk2.includes('(3) 250 m'));
  assert.ok(chunk2.includes('(4) 300 m'));
  // Chunk 2 must NOT contain Question 1's options
  assert.ok(!chunk2.includes('40 like cricket'));
});

test('questionChunks handles questions formatted with Q1., Q2., etc., without splitting options', () => {
  const paperText = `
Q1. What is the value of 2 + 2?
A) 3
B) 4
C) 5
D) 6

Q2. What is the capital of India?
A) Mumbai
B) Kolkata
C) New Delhi
D) Chennai
`;

  const chunks = questionChunks(paperText, 1);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].includes('A) 3') && chunks[0].includes('D) 6'));
  assert.ok(chunks[1].includes('A) Mumbai') && chunks[1].includes('D) Chennai'));
});

