import test from 'node:test';
import assert from 'node:assert/strict';

// Import modules to test
import {
  ALL_ANSWER_OPTIONS,
  normalizeOptionKey,
  getQuestionOptionKeys,
  validateQuestionForImport,
  evaluateStudentAnswer,
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
