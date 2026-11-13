import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { adminSessions, sessionCookie, studentSessionCookie, sessionLifetimeMs, json, parseCookies, cookieOptions, sameOrigin, currentAdmin, currentStudent, createAdminSession, createStudentSession, bodyBuffer } from "../utils.mjs";
import { extractPdfText, isUsablePdfText, recognizePdf, analyze, streamPdfOcr } from "./pdfHandler.mjs";
import { db, hasAdminCredentials } from "../adminFirebase.mjs";
import { defaultCatalogCategories, defaultCatalogExams, seedCatalogDefaults } from "../catalogDefaults.mjs";

const defaultExamCategories = [
  { id: "mba", name: "MBA", description: "CAT, CMAT, MAT, XAT and management entrance preparation" },
  { id: "ssc", name: "SSC", description: "Preparation for Staff Selection Commission exams" },
  { id: "railway", name: "Railway", description: "Preparation for Railway recruitment exams" },
  { id: "banking", name: "Banking", description: "Preparation for banking and financial services exams" },
  { id: "other-government-exams", name: "Other Government Exams", description: "Explore other government recruitment exams" },
];

const defaultPlatformExams = [
  { id: "mba-cat", categoryId: "mba", name: "CAT", description: "Common Admission Test", quizExamId: "cat" },
  { id: "mba-mat", categoryId: "mba", name: "MAT", description: "Management Aptitude Test", quizExamId: "mat" },
  { id: "mba-cmat", categoryId: "mba", name: "CMAT", description: "Common Management Admission Test", quizExamId: "cmat" },
  { id: "mba-xat", categoryId: "mba", name: "XAT", description: "Xavier Aptitude Test", quizExamId: "xat" },
  { id: "mba-mah-cet", categoryId: "mba", name: "MAH CET", description: "Maharashtra Common Entrance Test" },
  { id: "ssc-cgl", categoryId: "ssc", name: "SSC CGL", description: "Combined Graduate Level Examination" },
  { id: "ssc-chsl", categoryId: "ssc", name: "SSC CHSL", description: "Combined Higher Secondary Level Examination" },
  { id: "ssc-gd", categoryId: "ssc", name: "SSC GD", description: "General Duty Constable Examination" },
  { id: "ssc-mts", categoryId: "ssc", name: "SSC MTS", description: "Multi-Tasking Staff Examination" },
  { id: "ssc-cpo", categoryId: "ssc", name: "SSC CPO", description: "Central Police Organisations Examination" },
  { id: "railway-rrb-ntpc", categoryId: "railway", name: "RRB NTPC", description: "Non-Technical Popular Categories Examination" },
  { id: "railway-rrb-group-d", categoryId: "railway", name: "RRB Group D", description: "Railway Level 1 Examination" },
  { id: "banking-ibps-po", categoryId: "banking", name: "IBPS PO", description: "IBPS Probationary Officer Examination" },
  { id: "banking-ibps-clerk", categoryId: "banking", name: "IBPS Clerk", description: "IBPS Customer Service Associate Examination" },
  { id: "banking-sbi-po", categoryId: "banking", name: "SBI PO", description: "State Bank of India Probationary Officer Examination" },
  { id: "banking-sbi-clerk", categoryId: "banking", name: "SBI Clerk", description: "State Bank of India Junior Associate Examination" },
];

async function ensureExamCategories() {
  const collection = db.collection("examCategories");
  const initializationRef = db.collection("platformMetadata").doc("examCategories");
  const [snapshot, initialization] = await Promise.all([collection.get(), initializationRef.get()]);
  if (!initialization.exists) {
    const now = new Date().toISOString();
    const batch = db.batch();
    if (snapshot.empty) defaultExamCategories.forEach((category, order) => {
      batch.create(collection.doc(category.id), { ...category, active: true, order, createdAt: now, updatedAt: now });
    });
    batch.create(initializationRef, { initializedAt: now });
    try {
      await batch.commit();
    } catch (error) {
      const currentInitialization = await initializationRef.get();
      if (!currentInitialization.exists) throw error;
    }
  }
  await seedCatalogDefaults(db, "examCategories", "examCategoriesV2", defaultCatalogCategories);
  const current = await collection.get();
  return current.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

async function ensurePlatformExams() {
  const categories = await ensureExamCategories();
  const categoryIds = new Set(categories.map((category) => category.id));
  const collection = db.collection("platformExams");
  const initializationRef = db.collection("platformMetadata").doc("platformExams");
  const [snapshot, initialization] = await Promise.all([collection.get(), initializationRef.get()]);
  if (!initialization.exists) {
    const now = new Date().toISOString();
    const batch = db.batch();
    if (snapshot.empty) defaultPlatformExams.filter((exam) => categoryIds.has(exam.categoryId)).forEach((exam, order) => {
      batch.create(collection.doc(exam.id), { ...exam, active: true, order, createdAt: now, updatedAt: now });
    });
    batch.create(initializationRef, { initializedAt: now });
    try {
      await batch.commit();
    } catch (error) {
      const currentInitialization = await initializationRef.get();
      if (!currentInitialization.exists) throw error;
    }
  }
  const catalogCategoryIds = new Map(defaultCatalogCategories.map((category) => [
    category.id,
    categories.find((current) => String(current.name).toLowerCase() === category.name.toLowerCase())?.id ?? category.id,
  ]));
  await seedCatalogDefaults(db, "platformExams", "platformExamsV2", defaultCatalogExams, catalogCategoryIds);
  const current = await collection.get();
  return current.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

async function readJsonBody(req, maxBytes = 16_384) {
  const raw = await bodyBuffer(req, maxBytes);
  try {
    return raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    throw new Error("Request body must contain valid JSON.");
  }
}

function studentIdentityKey(kind, value) {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function publicStudentProfile(student) {
  return {
    uid: student.uid,
    name: student.name,
    email: student.email ?? "",
    phone: student.phone ?? "",
    studentId: student.studentId,
    role: "student",
    status: student.status,
    createdAt: student.createdAt,
    lastLogin: student.lastLogin ?? "",
  };
}

function validateStudentInput(input, requirePassword) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const studentId = typeof input?.studentId === "string" ? input.studentId.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  const phone = typeof input?.phone === "string" ? input.phone.trim() : "";
  if (!name || name.length > 100) throw new Error("Enter a student name (up to 100 characters).");
  if (!/^[a-z0-9_.-]{3,64}$/i.test(studentId)) throw new Error("Student IDs must be 3–64 letters, numbers, dots, underscores or hyphens.");
  if (requirePassword && (password.length < 8 || password.length > 128)) throw new Error("Student passwords must be 8–128 characters.");
  if (password && (password.length < 8 || password.length > 128)) throw new Error("Student passwords must be 8–128 characters.");
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Enter a valid email address.");
  if (phone.length > 32) throw new Error("Phone number must be 32 characters or fewer.");
  return { name, studentId, studentIdLower: studentId.toLowerCase(), password, email, emailLower: email.toLowerCase(), phone };
}

function hashStudentPassword(password, salt) {
  return pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("hex");
}

async function createStudentAccount(input) {
  const fields = validateStudentInput(input, true);
  const uid = `student-${randomUUID()}`;
  const salt = randomBytes(24).toString("hex");
  const student = {
    uid,
    name: fields.name,
    studentId: fields.studentId,
    studentIdLower: fields.studentIdLower,
    email: fields.email,
    emailLower: fields.emailLower,
    phone: fields.phone,
    role: "student",
    status: "active",
    authVersion: 1,
    createdAt: new Date().toISOString(),
    lastLogin: "",
    passwordSalt: salt,
    passwordHash: hashStudentPassword(fields.password, salt),
  };
  const idIndex = db.collection("studentLogins").doc(studentIdentityKey("id", fields.studentIdLower));
  const emailIndex = fields.emailLower
    ? db.collection("studentLogins").doc(studentIdentityKey("email", fields.emailLower))
    : null;
  const studentRef = db.collection("students").doc(uid);
  await db.runTransaction(async (transaction) => {
    const [existingId, existingEmail] = await Promise.all([
      transaction.get(idIndex),
      emailIndex ? transaction.get(emailIndex) : Promise.resolve(null),
    ]);
    if (existingId.exists || existingEmail?.exists) throw new Error("That Student ID or Email address is already registered.");
    transaction.create(studentRef, student);
    transaction.create(idIndex, { uid });
    if (emailIndex) transaction.create(emailIndex, { uid });
  });
  return publicStudentProfile(student);
}

function passwordMatches(password, student) {
  const actual = Buffer.from(hashStudentPassword(password, student.passwordSalt), "hex");
  const expected = Buffer.from(student.passwordHash ?? "", "hex");
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

async function studentForSession(profile) {
  if (!db || !hasAdminCredentials || !profile?.uid) return null;
  const snapshot = await db.collection("students").doc(profile.uid).get();
  const student = snapshot.exists ? snapshot.data() : null;
  return student?.role === "student" && student.status === "active"
    && (student.authVersion ?? 1) === (profile.authVersion ?? 1) ? student : null;
}

function correctAnswer(question, answer) {
  const normalized = (value) => String(value ?? "").trim().replace(/,/g, "").replace(/\s+/g, " ").toLowerCase();
  const expected = normalized(question.correctAnswer);
  const selected = normalized(answer);
  if (!expected || !selected) return false;
  if (question.answerMode === "text") {
    const numericValue = (value) => {
      const cleaned = String(value ?? "").trim().replace(/,/g, "").replace(/\s/g, "");
      const fraction = cleaned.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
      if (fraction) {
        const denominator = Number(fraction[2]);
        return denominator ? Number(fraction[1]) / denominator : undefined;
      }
      return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : undefined;
    };
    const expectedNumber = numericValue(question.correctAnswer);
    const selectedNumber = numericValue(answer);
    if (expectedNumber !== undefined && selectedNumber !== undefined) return Math.abs(expectedNumber - selectedNumber) < 1e-9;
  }
  if (selected === expected) return true;
  const options = question.options && typeof question.options === "object" ? question.options : {};
  const correctOption = options[expected.toUpperCase()];
  if (typeof correctOption === "string" && normalized(correctOption) === selected) return true;
  const selectedOption = options[selected.toUpperCase()];
  return typeof selectedOption === "string" && normalized(selectedOption) === expected;
}

function validateCompletedQuiz(input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const examId = typeof input?.examId === "string" ? input.examId.trim().slice(0, 100) : "";
  const scoringMode = input?.scoringMode === "cbt" ? "cbt" : "practice";
  const totalTimeSeconds = Number(input?.totalTimeSeconds);
  if (!title || title.length > 300 || !examId) throw new Error("Quiz title and exam are required.");
  if (!Number.isInteger(totalTimeSeconds) || totalTimeSeconds < 0 || totalTimeSeconds > 14_400) throw new Error("Quiz duration is invalid.");
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 400) throw new Error("A quiz must include between 1 and 400 questions.");
  const ids = new Set();
  const questions = input.questions.map((question, order) => {
    const id = typeof question?.id === "string" ? question.id.slice(0, 200) : "";
    const text = typeof question?.question === "string" ? question.question.trim() : "";
    const correct = typeof question?.correctAnswer === "string" ? question.correctAnswer.trim() : "";
    const selected = typeof question?.selectedAnswer === "string" ? question.selectedAnswer.trim() : "";
    const options = question?.options && typeof question.options === "object" && !Array.isArray(question.options) ? question.options : {};
    if (!id || ids.has(id) || !text || text.length > 20_000 || !correct || correct.length > 10_000 || selected.length > 10_000) {
      throw new Error("Quiz question data is invalid.");
    }
    ids.add(id);
    for (const [key, value] of Object.entries(options)) {
      if (key.length > 10 || typeof value !== "string" || value.length > 10_000) throw new Error("Quiz answer options are invalid.");
    }
    const answerMode = question.answerMode === "text" ? "text" : "choice";
    const isAttempted = Boolean(selected);
    const isCorrect = isAttempted && correctAnswer({ correctAnswer: correct, options, answerMode }, selected);
    return {
      id,
      question: text,
      options,
      selectedAnswer: selected,
      correctAnswer: correct,
      explanation: typeof question.explanation === "string" ? question.explanation.slice(0, 20_000) : "",
      answerMode,
      chapterId: typeof question.chapterId === "string" ? question.chapterId.slice(0, 150) : "",
      chapterName: typeof question.chapterName === "string" ? question.chapterName.slice(0, 150) : "",
      sectionName: typeof question.sectionName === "string" ? question.sectionName.slice(0, 150) : "",
      isAttempted,
      isCorrect,
      order,
    };
  });
  const attempted = questions.filter((question) => question.isAttempted).length;
  const correct = questions.filter((question) => question.isCorrect).length;
  const incorrect = attempted - correct;
  const rawScore = scoringMode === "cbt"
    ? questions.reduce((score, question) => score + (question.isCorrect ? 3 : question.isAttempted && question.answerMode !== "text" ? -1 : 0), 0)
    : correct;
  const maxScore = questions.length * (scoringMode === "cbt" ? 3 : 1);
  return {
    title,
    examId,
    scoringMode,
    totalQuestions: questions.length,
    attempted,
    correct,
    incorrect,
    unattempted: questions.length - attempted,
    rawScore,
    maxScore,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
    totalTimeSeconds,
    completedAt: new Date().toISOString(),
    questions,
  };
}

function validateExamCategory(input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  if (name.length < 2 || name.length > 80) throw new Error("Category name must be 2–80 characters.");
  if (description.length > 300) throw new Error("Category description must be 300 characters or fewer.");
  if (input?.active !== undefined && typeof input.active !== "boolean") throw new Error("Category active status must be true or false.");
  return { name, description, active: input?.active !== false };
}

function validatePlatformExam(input) {
  const categoryId = typeof input?.categoryId === "string" ? input.categoryId.trim() : "";
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  const quizExamId = typeof input?.quizExamId === "string" ? input.quizExamId.trim() : "";
  if (!categoryId) throw new Error("Choose a category for this exam.");
  if (name.length < 2 || name.length > 100) throw new Error("Exam name must be 2–100 characters.");
  if (description.length > 300) throw new Error("Exam description must be 300 characters or fewer.");
  if (quizExamId.length > 100) throw new Error("Linked quiz exam is invalid.");
  if (input?.active !== undefined && typeof input.active !== "boolean") throw new Error("Exam active status must be true or false.");
  return { categoryId, name, description, quizExamId, active: input?.active !== false };
}

function validateQuestion(input) {
  const examId = typeof input?.examId === "string" ? input.examId.trim().toLowerCase() : "";
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  const options = input?.options && typeof input.options === "object" && !Array.isArray(input.options) ? input.options : {
    A: input?.optionA ?? "", B: input?.optionB ?? "", C: input?.optionC ?? "",
    D: input?.optionD ?? "", E: input?.optionE ?? "",
  };
  const correctAnswer = typeof input?.correctAnswer === "string" ? input.correctAnswer.trim() : "";
  if (!examId || examId.length > 100) throw new Error("Question exam is required.");
  if (!question || question.length > 20_000) throw new Error("Question text must contain 1–20000 characters.");
  for (const key of ["A", "B", "C", "D", "E"]) {
    if (options[key] !== undefined && (typeof options[key] !== "string" || options[key].length > 10_000)) {
      throw new Error(`Answer option ${key} is invalid.`);
    }
  }
  if (correctAnswer.length > 10_000) throw new Error("Correct answer is too long.");
  if (input?.explanation !== undefined && (typeof input.explanation !== "string" || input.explanation.length > 20_000)) {
    throw new Error("Explanation must be 20000 characters or fewer.");
  }
  const safeId = (value) => typeof value === "string" && value.length <= 150 && !/[/.#?[\]]/.test(value) ? value : "";
  const optionsData = Object.fromEntries(["A", "B", "C", "D", "E"]
    .filter((key) => typeof options[key] === "string")
    .map((key) => [key, options[key]]));
  const sectionId = safeId(input.sectionId);
  const chapterId = safeId(input.chapterId);
  if (input.sectionId && !sectionId) throw new Error("Question subject is invalid.");
  if (input.chapterId && !chapterId) throw new Error("Question chapter is invalid.");
  const textField = (key, max = 500) => {
    const value = input[key] ?? "";
    if (typeof value !== "string" || value.length > max) throw new Error(`Question ${key} is invalid.`);
    return value;
  };
  const year = Number(input.year || input.sourceYear) || new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error("Question year is invalid.");
  return {
    exam: examId.toUpperCase(),
    examId,
    sectionId,
    chapterId,
    question,
    options: optionsData,
    optionA: optionsData.A ?? "",
    optionB: optionsData.B ?? "",
    optionC: optionsData.C ?? "",
    optionD: optionsData.D ?? "",
    ...(optionsData.E ? { optionE: optionsData.E } : {}),
    answer: correctAnswer,
    correctAnswer,
    category: textField("category"),
    subject: textField("subject"),
    chapter: textField("chapter"),
    topic: textField("topic"),
    subTopic: textField("subTopic"),
    explanation: input.explanation ?? "",
    difficulty: ["Easy", "Medium", "Hard"].includes(input.difficulty) ? input.difficulty : "Medium",
    questionType: textField("questionType", 100) || "MCQ",
    year,
    slot: String(input.slot ?? input.sourceSlot ?? "").slice(0, 100),
    paperId: textField("paperId", 200),
    paperTitle: textField("paperTitle", 300),
    source: textField("source", 1000),
    sourceYear: year,
    sourceSlot: String(input.slot ?? input.sourceSlot ?? "").slice(0, 100),
    imageUrl: textField("imageUrl", 5000),
    imageAlt: textField("imageAlt", 500),
    hasDiagram: Boolean(input.hasDiagram || input.imageUrl),
    question_number: Number(input.question_number || input.questionNumber) || null,
    updatedAt: new Date().toISOString(),
  };
}

function questionDocument(input) {
  const id = questionDocumentId(input.id);
  return { id, ...validateQuestion(input) };
}

function questionDocumentId(inputId) {
  const id = typeof inputId === "string" ? inputId.replace(/^firestore-/, "").trim() : "";
  if (!id || id.length > 150 || /[/.#?[\]]/.test(id)) throw new Error("A valid question ID is required.");
  return id;
}

function validateCatalogName(input, label) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (name.length < 2 || name.length > 100) throw new Error(`${label} name must be 2–100 characters.`);
  return name;
}

function sortCatalogItems(items) {
  return items.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

async function chaptersForSubjects(subjectIds) {
  const chapters = db.collection("platformChapters");
  const snapshots = [];
  for (let index = 0; index < subjectIds.length; index += 30) {
    const chunk = subjectIds.slice(index, index + 30);
    if (chunk.length === 1) snapshots.push(await chapters.where("subjectId", "==", chunk[0]).get());
    else if (chunk.length) snapshots.push(await chapters.where("subjectId", "in", chunk).get());
  }
  return sortCatalogItems(snapshots.flatMap((snapshot) => snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))));
}

async function deleteQueryDocuments(query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    if (snapshot.size < 400) return;
  }
}

async function deleteExamSubjects(examId) {
  const subjects = await db.collection("platformSubjects").where("examId", "==", examId).get();
  for (const subject of subjects.docs) {
    await deleteQueryDocuments(db.collection("platformChapters").where("subjectId", "==", subject.id));
  }
  await deleteQueryDocuments(db.collection("platformSubjects").where("examId", "==", examId));
}

async function activePlatformExam(examId) {
  const [categories, exams] = await Promise.all([ensureExamCategories(), ensurePlatformExams()]);
  const exam = exams.find((item) => item.id === examId && item.active === true);
  return exam && categories.some((category) => category.id === exam.categoryId && category.active === true) ? exam : null;
}

export async function handleApi(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!pathname.startsWith("/api/")) return false;
  if (req.method === "GET" && pathname === "/api/auth/session") {
    const adminProfile = currentAdmin(req);
    if (adminProfile) return json(res, 200, { profile: adminProfile }), true;
    const studentSession = currentStudent(req);
    if (!studentSession || !db || !hasAdminCredentials) {
      return json(res, 401, { error: "Sign in to continue." }), true;
    }
    try {
      const student = await studentForSession(studentSession);
      if (!student) return json(res, 401, { error: "Student session is no longer active." }), true;
      return json(res, 200, { profile: publicStudentProfile(student) }), true;
    } catch (error) {
      console.error("[api/auth/session] Student session lookup failed:", error);
      return json(res, 500, { error: "Could not verify student session." }), true;
    }
  }
  if (pathname === "/api/auth/student/register" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Registration request was rejected." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Student account storage is unavailable." }), true;
    try {
      const profile = await createStudentAccount(await readJsonBody(req, 8192));
      createStudentSession(req, res, { ...profile, authVersion: 1 });
      return json(res, 201, { profile }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create student account.";
      if (message.includes("already registered")) return json(res, 409, { error: message }), true;
      if (/Student |student name|passwords|email address|valid email|valid JSON/.test(message)) return json(res, 400, { error: message }), true;
      console.error("[api/auth/student/register] Registration failed:", error);
      return json(res, 500, { error: "Could not create student account." }), true;
    }
  }
  if (pathname === "/api/auth/student/login" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Sign in request was rejected." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Student account storage is unavailable." }), true;
    try {
      const input = await readJsonBody(req, 4096);
      const identifier = typeof input.studentId === "string" ? input.studentId.trim().toLowerCase() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (identifier.length < 3 || identifier.length > 254 || !password || password.length > 128) {
        return json(res, 401, { error: "Student ID or password is incorrect." }), true;
      }
      const kind = identifier.includes("@") ? "email" : "id";
      const indexRef = db.collection("studentLogins").doc(studentIdentityKey(kind, identifier));
      const index = await indexRef.get();
      if (!index.exists || typeof index.data()?.uid !== "string") {
        return json(res, 401, { error: "Student ID or password is incorrect." }), true;
      }
      const studentSnapshot = await db.collection("students").doc(index.data().uid).get();
      const student = studentSnapshot.exists ? studentSnapshot.data() : null;
      if (!student || student.role !== "student" || student.status !== "active"
        || !student.passwordSalt || !student.passwordHash || !passwordMatches(password, student)) {
        return json(res, 401, { error: "Student ID or password is incorrect." }), true;
      }
      const lastLogin = new Date().toISOString();
      await studentSnapshot.ref.update({ lastLogin });
      const profile = publicStudentProfile({ ...student, lastLogin });
      createStudentSession(req, res, { ...profile, authVersion: student.authVersion ?? 1 });
      return json(res, 200, { profile }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("valid JSON")) return json(res, 400, { error: message }), true;
      console.error("[api/auth/student/login] Authentication failed:", error);
      return json(res, 500, { error: "Student sign-in failed." }), true;
    }
  }
  if (pathname === "/api/auth/admin/login" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Sign in request was rejected." }), true;
    const expectedPassword = process.env.ADMIN_PASSWORD;
    if (!expectedPassword || expectedPassword.length < 12 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return json(res, 503, { error: "Admin authentication is not configured. Set ADMIN_PASSWORD and a 32-character SESSION_SECRET on the server." }), true;
    }
    try {
      let input;
      if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
        input = req.body;
      } else {
        const raw = (await bodyBuffer(req, 4096)).toString("utf8");
        input = raw ? JSON.parse(raw) : (req.body || {});
      }
      const id = typeof input.studentId === "string" ? input.studentId.trim().toLowerCase() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (id !== "admin" || !password || password.length > 128) return json(res, 401, { error: "Admin ID or password is incorrect." }), true;
      const submittedPassword = Buffer.from(password);
      const configuredPassword = Buffer.from(expectedPassword);
      const passwordMatches = submittedPassword.length === configuredPassword.length
        && timingSafeEqual(submittedPassword, configuredPassword);
      if (!passwordMatches) return json(res, 401, { error: "Admin ID or password is incorrect." }), true;
      return json(res, 200, { profile: createAdminSession(req, res) }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("JSON")) return json(res, 400, { error: "Sign in request was invalid." }), true;
      console.error("[api/auth/admin/login] Authentication failed:", error);
      return json(res, 500, { error: "Admin sign-in failed." }), true;
    }
  }
  if (pathname === "/api/auth/logout" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Sign out request was rejected." }), true;
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[sessionCookie]) adminSessions.delete(cookies[sessionCookie]);
    res.setHeader("Set-Cookie", [
      `${sessionCookie}=; ${cookieOptions(req, 0)}`,
      `${studentSessionCookie}=; ${cookieOptions(req, 0)}`,
    ]);
    return json(res, 200, { ok: true }), true;
  }

  if (pathname === "/api/student/attempts") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    const session = currentStudent(req);
    if (!session) return json(res, 401, { error: "Student session required." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Student performance storage is unavailable." }), true;
    try {
      const student = await studentForSession(session);
      if (!student) return json(res, 401, { error: "Student session is no longer active." }), true;
      const attemptsCollection = db.collection("studentAttempts");
      if (req.method === "GET") {
        const snapshot = await attemptsCollection.where("studentUid", "==", session.uid).get();
        const attempts = await Promise.all(snapshot.docs.map(async (document) => {
          const questions = await document.ref.collection("questions").orderBy("order").get();
          return { ...document.data(), id: document.id, questions: questions.docs.map((question) => question.data()) };
        }));
        attempts.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
        return json(res, 200, { attempts }), true;
      }
      if (req.method === "POST") {
        const input = await readJsonBody(req, 10 * 1024 * 1024);
        const attempt = validateCompletedQuiz(input);
        const reference = attemptsCollection.doc(randomUUID());
        const { questions, ...summary } = attempt;
        const batch = db.batch();
        batch.create(reference, { ...summary, studentUid: session.uid });
        questions.forEach((question) => {
          batch.create(reference.collection("questions").doc(String(question.order).padStart(4, "0")), question);
        });
        await batch.commit();
        return json(res, 201, { attempt: { ...summary, id: reference.id, questions } }), true;
      }
      return json(res, 405, { error: "Method not allowed." }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save quiz attempt.";
      if (/Quiz |question|options|duration|valid JSON|between 1/.test(message)) return json(res, 400, { error: message }), true;
      console.error("[api/student/attempts] Performance storage failed:", error);
      return json(res, 500, { error: "Could not load or save quiz attempts." }), true;
    }
  }

  if (pathname.startsWith("/api/admin/students") || pathname === "/api/admin/attempts") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Student storage is unavailable." }), true;
    try {
      if (pathname === "/api/admin/attempts" && req.method === "GET") {
        const snapshot = await db.collection("studentAttempts").get();
        const groupedAttempts = await Promise.all(snapshot.docs.map(async (document) => {
          const attempt = document.data();
          const questions = await document.ref.collection("questions").orderBy("order").get();
          return questions.docs.map((questionDocument) => {
            const question = questionDocument.data();
            return {
              questionId: question.id,
              examId: attempt.examId,
              selectedAnswer: question.selectedAnswer,
              isCorrect: question.isCorrect,
              attemptedAt: attempt.completedAt,
              sessionId: document.id,
              userId: attempt.studentUid,
            };
          });
        }));
        const attempts = groupedAttempts.flat();
        return json(res, 200, { attempts }), true;
      }
      const studentsCollection = db.collection("students");
      if (req.method === "GET") {
        const snapshot = await studentsCollection.get();
        const students = snapshot.docs.map((document) => publicStudentProfile(document.data()));
        students.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return json(res, 200, { students }), true;
      }
      if (req.method === "POST") {
        const profile = await createStudentAccount(await readJsonBody(req, 8192));
        return json(res, 201, { student: profile }), true;
      }
      const url = new URL(req.url, "http://localhost");
      const uid = url.searchParams.get("id")?.trim();
      if (!uid || !/^student-[a-f0-9-]{36}$/i.test(uid)) return json(res, 400, { error: "A valid student ID is required." }), true;
      const reference = studentsCollection.doc(uid);
      const existingSnapshot = await reference.get();
      if (!existingSnapshot.exists || existingSnapshot.data().role !== "student") return json(res, 404, { error: "Student account not found." }), true;
      const existing = existingSnapshot.data();
      if (req.method === "PUT") {
        const fields = validateStudentInput(await readJsonBody(req, 8192), false);
        const oldIdRef = db.collection("studentLogins").doc(studentIdentityKey("id", existing.studentIdLower));
        const newIdRef = db.collection("studentLogins").doc(studentIdentityKey("id", fields.studentIdLower));
        const oldEmailRef = existing.emailLower ? db.collection("studentLogins").doc(studentIdentityKey("email", existing.emailLower)) : null;
        const newEmailRef = fields.emailLower ? db.collection("studentLogins").doc(studentIdentityKey("email", fields.emailLower)) : null;
        await db.runTransaction(async (transaction) => {
          const refs = [...new Map([oldIdRef, newIdRef, oldEmailRef, newEmailRef]
            .filter(Boolean)
            .map((reference) => [reference.path, reference])).values()];
          const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
          refs.forEach((ref, index) => {
            if ((ref.path === newIdRef.path || (newEmailRef && ref.path === newEmailRef.path))
              && snapshots[index].exists && snapshots[index].data().uid !== uid) {
              throw new Error("That Student ID or Email address is already registered.");
            }
          });
          if (oldIdRef.path !== newIdRef.path) {
            transaction.delete(oldIdRef);
            transaction.set(newIdRef, { uid });
          }
          if (oldEmailRef?.path !== newEmailRef?.path) {
            if (oldEmailRef) transaction.delete(oldEmailRef);
            if (newEmailRef) transaction.set(newEmailRef, { uid });
          }
          transaction.update(reference, {
            name: fields.name,
            studentId: fields.studentId,
            studentIdLower: fields.studentIdLower,
            email: fields.email,
            emailLower: fields.emailLower,
            phone: fields.phone,
          });
        });
        return json(res, 200, { student: publicStudentProfile({ ...existing, ...fields }) }), true;
      }
      if (req.method === "PATCH") {
        const input = await readJsonBody(req);
        if (input.action === "status") {
          if (typeof input.disabled !== "boolean") return json(res, 400, { error: "Student status is invalid." }), true;
          const status = input.disabled ? "disabled" : "active";
          await reference.update({ status, authVersion: (existing.authVersion ?? 1) + 1 });
          return json(res, 200, { student: publicStudentProfile({ ...existing, status }) }), true;
        }
        if (input.action === "password") {
          if (typeof input.password !== "string" || input.password.length < 8 || input.password.length > 128) {
            return json(res, 400, { error: "Student passwords must be 8–128 characters." }), true;
          }
          const salt = randomBytes(24).toString("hex");
          await reference.update({
            passwordSalt: salt,
            passwordHash: hashStudentPassword(input.password, salt),
            authVersion: (existing.authVersion ?? 1) + 1,
          });
          return json(res, 200, { success: true }), true;
        }
        return json(res, 400, { error: "Student update action is invalid." }), true;
      }
      if (req.method === "DELETE") {
        const attempts = await db.collection("studentAttempts").where("studentUid", "==", uid).get();
        for (const document of attempts.docs) await deleteQueryDocuments(document.ref.collection("questions"));
        await deleteQueryDocuments(db.collection("studentAttempts").where("studentUid", "==", uid));
        const batch = db.batch();
        batch.delete(reference);
        batch.delete(db.collection("studentLogins").doc(studentIdentityKey("id", existing.studentIdLower)));
        if (existing.emailLower) batch.delete(db.collection("studentLogins").doc(studentIdentityKey("email", existing.emailLower)));
        await batch.commit();
        return json(res, 200, { success: true }), true;
      }
      return json(res, 405, { error: "Method not allowed." }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Student operation failed.";
      if (/Student |student name|passwords|email address|valid email|valid JSON|already registered/.test(message)) {
        return json(res, message.includes("already registered") ? 409 : 400, { error: message }), true;
      }
      console.error("[api/admin/students] Student management failed:", error);
      return json(res, 500, { error: "Could not complete student management action." }), true;
    }
  }

  if (pathname === "/api/categories" && req.method === "GET") {
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Category storage is unavailable." }), true;
    try {
      const categories = await ensureExamCategories();
      return json(res, 200, { categories: categories.filter((category) => category.active === true) }), true;
    } catch (error) {
      console.error("[api/categories] Firestore read error:", error);
      return json(res, 500, { error: "Could not load exam categories." }), true;
    }
  }

  if (pathname === "/api/admin/categories") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Category storage is unavailable." }), true;

    try {
      const collection = db.collection("examCategories");
      if (req.method === "GET") {
        return json(res, 200, { categories: await ensureExamCategories() }), true;
      }

      if (req.method === "POST" || req.method === "PUT") {
        const input = await readJsonBody(req);
        const category = validateExamCategory(input);
        const categories = await ensureExamCategories();
        const duplicate = categories.find((item) => item.name.toLowerCase() === category.name.toLowerCase() && item.id !== input.id);
        if (duplicate) return json(res, 409, { error: "A category with that name already exists." }), true;
        const now = new Date().toISOString();

        if (req.method === "POST") {
          const id = `category-${randomBytes(8).toString("hex")}`;
          const created = { id, ...category, order: categories.length, createdAt: now, updatedAt: now };
          await collection.doc(id).create(created);
          return json(res, 201, { category: created, categories: [...categories, created] }), true;
        }

        const id = typeof input.id === "string" ? input.id.trim() : "";
        if (!id) return json(res, 400, { error: "Category ID is required for updates." }), true;
        const reference = collection.doc(id);
        const existing = await reference.get();
        if (!existing.exists) return json(res, 404, { error: "Category not found." }), true;
        const updated = { id, ...category, order: existing.data().order ?? categories.length, createdAt: existing.data().createdAt ?? now, updatedAt: now };
        await reference.set(updated);
        const updatedCategories = categories.map((item) => item.id === id ? updated : item)
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
        return json(res, 200, { category: updated, categories: updatedCategories }), true;
      }

      if (req.method === "DELETE") {
        const id = new URL(req.url, "http://localhost").searchParams.get("id")?.trim();
        if (!id) return json(res, 400, { error: "Category ID is required for deletion." }), true;
        const reference = collection.doc(id);
        const existing = await reference.get();
        if (!existing.exists) return json(res, 404, { error: "Category not found." }), true;
        const assignedExams = await db.collection("platformExams").where("categoryId", "==", id).limit(1).get();
        if (!assignedExams.empty) return json(res, 409, { error: "Reassign or delete this category's exams before deleting it." }), true;
        await reference.delete();
        return json(res, 200, { categories: (await collection.get()).docs
          .map((document) => ({ id: document.id, ...document.data() }))
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name))) }), true;
      }

      return json(res, 405, { error: "Method not allowed." }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save exam categories.";
      if (message.includes("Category name") || message.includes("Category description") || message.includes("active status") || message.includes("valid JSON")) {
        return json(res, 400, { error: message }), true;
      }
      console.error("[api/admin/categories] Firestore operation failed:", error);
      return json(res, 500, { error: "Could not save exam categories." }), true;
    }
  }

      if (pathname === "/api/exams" && req.method === "GET") {
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Exam storage is unavailable." }), true;
        try {
          const categoryId = new URL(req.url, "http://localhost").searchParams.get("categoryId")?.trim();
          if (!categoryId) return json(res, 400, { error: "A category ID is required." }), true;
          const [categories, exams] = await Promise.all([ensureExamCategories(), ensurePlatformExams()]);
          const category = categories.find((item) => item.id === categoryId && item.active === true);
          return json(res, 200, { exams: category ? exams.filter((exam) => exam.categoryId === categoryId && exam.active === true) : [] }), true;
        } catch (error) {
          console.error("[api/exams] Firestore read error:", error);
          return json(res, 500, { error: "Could not load exams." }), true;
        }
      }

      if (pathname === "/api/exam-subjects" && req.method === "GET") {
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Subject storage is unavailable." }), true;
        try {
          const examId = new URL(req.url, "http://localhost").searchParams.get("examId")?.trim();
          if (!examId) return json(res, 400, { error: "An exam ID is required." }), true;
          if (!await activePlatformExam(examId)) return json(res, 200, { subjects: [] }), true;
          const snapshot = await db.collection("platformSubjects").where("examId", "==", examId).get();
          return json(res, 200, { subjects: sortCatalogItems(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))) }), true;
        } catch (error) {
          console.error("[api/exam-subjects] Firestore read error:", error);
          return json(res, 500, { error: "Could not load subjects." }), true;
        }
      }

      if (pathname === "/api/exam-chapters" && req.method === "GET") {
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Chapter storage is unavailable." }), true;
        try {
          const subjectId = new URL(req.url, "http://localhost").searchParams.get("subjectId")?.trim();
          if (!subjectId) return json(res, 400, { error: "A subject ID is required." }), true;
          const subjectSnapshot = await db.collection("platformSubjects").doc(subjectId).get();
          const subject = subjectSnapshot.exists ? subjectSnapshot.data() : null;
          if (!subject || !await activePlatformExam(subject.examId)) return json(res, 200, { chapters: [] }), true;
          const snapshot = await db.collection("platformChapters").where("subjectId", "==", subjectId).get();
          return json(res, 200, { chapters: sortCatalogItems(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))) }), true;
        } catch (error) {
          console.error("[api/exam-chapters] Firestore read error:", error);
          return json(res, 500, { error: "Could not load chapters." }), true;
        }
      }

      if (pathname === "/api/admin/exams") {
        if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
        if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Exam storage is unavailable." }), true;

        try {
          const collection = db.collection("platformExams");
          if (req.method === "GET") {
            await ensureExamCategories();
            return json(res, 200, { exams: await ensurePlatformExams() }), true;
          }

          if (req.method === "POST" || req.method === "PUT") {
            const input = await readJsonBody(req);
            const exam = validatePlatformExam(input);
            const [categories, exams] = await Promise.all([ensureExamCategories(), ensurePlatformExams()]);
            if (!categories.some((category) => category.id === exam.categoryId)) return json(res, 404, { error: "Selected category was not found." }), true;
            const duplicate = exams.find((item) => item.categoryId === exam.categoryId
              && item.name.toLowerCase() === exam.name.toLowerCase() && item.id !== input.id);
            if (duplicate) return json(res, 409, { error: "An exam with that name already exists in this category." }), true;
            const now = new Date().toISOString();

            if (req.method === "POST") {
              const id = `exam-${randomBytes(8).toString("hex")}`;
              const created = { id, ...exam, order: exams.filter((item) => item.categoryId === exam.categoryId).length, createdAt: now, updatedAt: now };
              await collection.doc(id).create(created);
              return json(res, 201, { exam: created, exams: [...exams, created] }), true;
            }

            const id = typeof input.id === "string" ? input.id.trim() : "";
            if (!id) return json(res, 400, { error: "Exam ID is required for updates." }), true;
            const reference = collection.doc(id);
            const existing = await reference.get();
            if (!existing.exists) return json(res, 404, { error: "Exam not found." }), true;
            const updated = {
              id, ...exam, order: existing.data().order ?? exams.filter((item) => item.categoryId === exam.categoryId).length,
              createdAt: existing.data().createdAt ?? now, updatedAt: now,
            };
            await reference.set(updated);
            const updatedExams = exams.map((item) => item.id === id ? updated : item)
              .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
            return json(res, 200, { exam: updated, exams: updatedExams }), true;
          }

          if (req.method === "DELETE") {
            const id = new URL(req.url, "http://localhost").searchParams.get("id")?.trim();
            if (!id) return json(res, 400, { error: "Exam ID is required for deletion." }), true;
            const reference = collection.doc(id);
            const existing = await reference.get();
            if (!existing.exists) return json(res, 404, { error: "Exam not found." }), true;
            await deleteExamSubjects(id);
            await reference.delete();
            return json(res, 200, { exams: (await collection.get()).docs
              .map((document) => ({ id: document.id, ...document.data() }))
              .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0) || String(a.name).localeCompare(String(b.name))) }), true;
          }

          return json(res, 405, { error: "Method not allowed." }), true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save exam.";
          if (message.includes("Choose a category") || message.includes("Exam name") || message.includes("Exam description") || message.includes("Linked quiz exam") || message.includes("active status") || message.includes("valid JSON")) {
            return json(res, 400, { error: message }), true;
          }
          console.error("[api/admin/exams] Firestore operation failed:", error);
          return json(res, 500, { error: "Could not save exam." }), true;
        }
      }

      if (pathname === "/api/admin/subjects") {
        if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
        if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Subject storage is unavailable." }), true;

        try {
          const collection = db.collection("platformSubjects");
          const url = new URL(req.url, "http://localhost");
          if (req.method === "GET") {
            const examId = url.searchParams.get("examId")?.trim();
            if (!examId) return json(res, 400, { error: "An exam ID is required." }), true;
            const subjectsSnapshot = await collection.where("examId", "==", examId).get();
            const subjects = sortCatalogItems(subjectsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
            const chapters = await chaptersForSubjects(subjects.map((subject) => subject.id));
            return json(res, 200, { subjects, chapters }), true;
          }

          if (req.method === "POST" || req.method === "PUT") {
            const input = await readJsonBody(req);
            const examId = typeof input?.examId === "string" ? input.examId.trim() : "";
            const name = validateCatalogName(input, "Subject");
            if (!examId) return json(res, 400, { error: "An exam ID is required." }), true;
            if (!await db.collection("platformExams").doc(examId).get().then((snapshot) => snapshot.exists)) {
              return json(res, 404, { error: "Selected exam was not found." }), true;
            }
            const snapshot = await collection.where("examId", "==", examId).get();
            const subjects = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
            const duplicate = subjects.find((subject) => subject.name.toLowerCase() === name.toLowerCase() && subject.id !== input.id);
            if (duplicate) return json(res, 409, { error: "A subject with that name already exists for this exam." }), true;
            const now = new Date().toISOString();

            if (req.method === "POST") {
              const id = `subject-${randomBytes(8).toString("hex")}`;
              const created = { id, examId, name, order: subjects.length, createdAt: now, updatedAt: now };
              await collection.doc(id).create(created);
              return json(res, 201, { subject: created }), true;
            }

            const id = typeof input.id === "string" ? input.id.trim() : "";
            if (!id) return json(res, 400, { error: "Subject ID is required for updates." }), true;
            const reference = collection.doc(id);
            const existing = await reference.get();
            if (!existing.exists) return json(res, 404, { error: "Subject not found." }), true;
            if (existing.data().examId !== examId) return json(res, 400, { error: "A subject cannot be moved to another exam." }), true;
            const updated = { id, examId, name, order: existing.data().order ?? subjects.length, createdAt: existing.data().createdAt ?? now, updatedAt: now };
            await reference.set(updated);
            return json(res, 200, { subject: updated }), true;
          }

          if (req.method === "DELETE") {
            const id = url.searchParams.get("id")?.trim();
            if (!id) return json(res, 400, { error: "Subject ID is required for deletion." }), true;
            const reference = collection.doc(id);
            const existing = await reference.get();
            if (!existing.exists) return json(res, 404, { error: "Subject not found." }), true;
            await deleteQueryDocuments(db.collection("platformChapters").where("subjectId", "==", id));
            await reference.delete();
            const subjects = await collection.where("examId", "==", existing.data().examId).get();
            const subjectItems = sortCatalogItems(subjects.docs.map((document) => ({ id: document.id, ...document.data() })));
            return json(res, 200, {
              subjects: subjectItems,
              chapters: await chaptersForSubjects(subjectItems.map((subject) => subject.id)),
            }), true;
          }

          return json(res, 405, { error: "Method not allowed." }), true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save subject.";
          if (message.includes("Subject name") || message.includes("valid JSON")) return json(res, 400, { error: message }), true;
          console.error("[api/admin/subjects] Firestore operation failed:", error);
          return json(res, 500, { error: "Could not save subject." }), true;
        }
      }

      if (pathname === "/api/admin/chapters") {
        if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
        if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Chapter storage is unavailable." }), true;

        try {
          const collection = db.collection("platformChapters");
          const url = new URL(req.url, "http://localhost");
          if (req.method === "GET") {
            const subjectId = url.searchParams.get("subjectId")?.trim();
            if (!subjectId) return json(res, 400, { error: "A subject ID is required." }), true;
            const snapshot = await collection.where("subjectId", "==", subjectId).get();
            return json(res, 200, { chapters: sortCatalogItems(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))) }), true;
          }

          if (req.method === "POST" || req.method === "PUT") {
            const input = await readJsonBody(req);
            const subjectId = typeof input?.subjectId === "string" ? input.subjectId.trim() : "";
            const name = validateCatalogName(input, "Chapter");
            if (!subjectId) return json(res, 400, { error: "A subject ID is required." }), true;
            const subjectSnapshot = await db.collection("platformSubjects").doc(subjectId).get();
            if (!subjectSnapshot.exists) return json(res, 404, { error: "Selected subject was not found." }), true;
            const snapshot = await collection.where("subjectId", "==", subjectId).get();
            const chapters = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
            const duplicate = chapters.find((chapter) => chapter.name.toLowerCase() === name.toLowerCase() && chapter.id !== input.id);
            if (duplicate) return json(res, 409, { error: "A chapter with that name already exists in this subject." }), true;
            const now = new Date().toISOString();

            if (req.method === "POST") {
              const id = `chapter-${randomBytes(8).toString("hex")}`;
              const created = { id, subjectId, name, order: chapters.length, createdAt: now, updatedAt: now };
              await collection.doc(id).create(created);
              return json(res, 201, { chapter: created }), true;
            }

            const id = typeof input.id === "string" ? input.id.trim() : "";
            if (!id) return json(res, 400, { error: "Chapter ID is required for updates." }), true;
            const reference = collection.doc(id);
            const existing = await reference.get();
            if (!existing.exists) return json(res, 404, { error: "Chapter not found." }), true;
            if (existing.data().subjectId !== subjectId) return json(res, 400, { error: "A chapter cannot be moved to another subject." }), true;
            const updated = { id, subjectId, name, order: existing.data().order ?? chapters.length, createdAt: existing.data().createdAt ?? now, updatedAt: now };
            await reference.set(updated);
            return json(res, 200, { chapter: updated }), true;
          }

          if (req.method === "DELETE") {
            const id = url.searchParams.get("id")?.trim();
            if (!id) return json(res, 400, { error: "Chapter ID is required for deletion." }), true;
            const reference = collection.doc(id);
            const existing = await reference.get();
            if (!existing.exists) return json(res, 404, { error: "Chapter not found." }), true;
            await reference.delete();
            const snapshot = await collection.where("subjectId", "==", existing.data().subjectId).get();
            return json(res, 200, { chapters: sortCatalogItems(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }))) }), true;
          }

          return json(res, 405, { error: "Method not allowed." }), true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not save chapter.";
          if (message.includes("Chapter name") || message.includes("valid JSON")) return json(res, 400, { error: message }), true;
          console.error("[api/admin/chapters] Firestore operation failed:", error);
          return json(res, 500, { error: "Could not save chapter." }), true;
        }
      }

  if (pathname === "/api/admin/questions") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Question storage is unavailable." }), true;

    try {
      const collection = db.collection("examQuestions");
      if (req.method === "POST" || req.method === "PUT") {
        const input = await readJsonBody(req, 2 * 1024 * 1024);
        const record = questionDocument(input);
        const reference = collection.doc(record.id);
        if (req.method === "POST") await reference.create(record);
        else await reference.set(record);
        return json(res, req.method === "POST" ? 201 : 200, { question: record }), true;
      }

      if (req.method === "DELETE") {
        const input = await readJsonBody(req);
        if (input.all === true) {
          await deleteQueryDocuments(collection);
          return json(res, 200, { deleted: "all" }), true;
        }
        if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 400) {
          return json(res, 400, { error: "Provide between 1 and 400 question IDs to delete." }), true;
        }
        const ids = [...new Set(input.ids.map(questionDocumentId))];
        const batch = db.batch();
        ids.forEach((id) => batch.delete(collection.doc(id)));
        await batch.commit();
        return json(res, 200, { deleted: ids }), true;
      }

      return json(res, 405, { error: "Method not allowed." }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save questions.";
      if (/Question |Answer option |Correct answer|valid JSON|question ID|question IDs/.test(message)) return json(res, 400, { error: message }), true;
      console.error("[api/admin/questions] Firestore operation failed:", error);
      return json(res, 500, { error: "Could not save questions." }), true;
    }
  }

  // --- Extracted Papers Endpoints ---
  if (pathname === "/api/admin/papers") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;

    const url = new URL(req.url, "http://localhost");
    const action = url.searchParams.get("action");

    if (req.method === "GET") {
      if (!db || !hasAdminCredentials) return json(res, 503, { error: "Paper storage is unavailable." }), true;
      try {
        const snapshot = await db.collection("extractedPapers").get();
        const papers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        papers.sort((a, b) => String(b.extractedAt || "").localeCompare(String(a.extractedAt || "")));
        return json(res, 200, { papers }), true;
      } catch (error) {
        console.error("[api/admin/papers] Firestore read failed:", error);
        return json(res, 500, { error: "Could not load paper records." }), true;
      }
    }

    if (req.method === "DELETE" || (req.method === "POST" && action === "delete")) {
      if (!db || !hasAdminCredentials) return json(res, 503, { error: "Paper storage is unavailable." }), true;
      try {
        const input = await readJsonBody(req);
        const id = url.searchParams.get("id") || input.id;
        if (input.all === true) {
          await deleteQueryDocuments(db.collection("extractedPapers"));
          return json(res, 200, { deleted: "all" }), true;
        }
        if (typeof id !== "string" || !id.trim() || id.length > 150 || /[/.#?[\]]/.test(id)) {
          return json(res, 400, { error: "A valid paper ID is required." }), true;
        }
        await db.collection("extractedPapers").doc(id).delete();
        return json(res, 200, { success: true }), true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not delete paper record.";
        if (message.includes("valid JSON")) return json(res, 400, { error: message }), true;
        console.error("[api/admin/papers] Firestore delete failed:", error);
        return json(res, 500, { error: "Could not delete paper record." }), true;
      }
    }

    if (req.method === "POST") {
      try {
        const paper = await readJsonBody(req, 2 * 1024 * 1024);
        if (!paper || typeof paper.id !== "string" || !paper.id.trim() || paper.id.length > 150 || /[/.#?[\]]/.test(paper.id)) {
          return json(res, 400, { error: "Invalid paper payload." }), true;
        }
        if (!db || !hasAdminCredentials) return json(res, 503, { error: "Paper storage is unavailable." }), true;

        await db.collection("extractedPapers").doc(paper.id).set({
          ...paper,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        return json(res, 200, { success: true, paper }), true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not persist paper record.";
        if (message.includes("valid JSON")) return json(res, 400, { error: message }), true;
        console.error("[api/admin/papers] Firestore write failed:", error);
        return json(res, 500, { error: "Could not persist paper record." }), true;
      }
    }
    return json(res, 405, { error: "Method not allowed." }), true;
  }

  // --- Secure Admin Import Endpoint ---
  if (pathname === "/api/admin/questions/import" && req.method === "POST") {
    if (!sameOrigin(req)) return json(res, 403, { error: "Request rejected." }), true;
    if (!currentAdmin(req)) return json(res, 401, { error: "Admin session required." }), true;
    if (!db || !hasAdminCredentials) return json(res, 503, { error: "Question storage is unavailable." }), true;
    
    try {
      let questions;
      if (req.body && Array.isArray(req.body)) {
        questions = req.body;
      } else {
        const raw = (await bodyBuffer(req, 25 * 1024 * 1024)).toString("utf8");
        questions = raw ? JSON.parse(raw) : (Array.isArray(req.body) ? req.body : []);
      }
      if (!Array.isArray(questions) || questions.length === 0 || questions.length > 500) {
        return json(res, 400, { error: "Invalid batch size." }), true;
      }

      const batch = db.batch();
      questions.forEach((q) => {
        if (!q || typeof q !== "object" || Array.isArray(q)) {
          throw new Error("Invalid question payload.");
        }
        const rawOptions = q.options;
        const options = Array.isArray(rawOptions)
          ? {
              A: rawOptions[0] ?? q.optionA ?? "",
              B: rawOptions[1] ?? q.optionB ?? "",
              C: rawOptions[2] ?? q.optionC ?? "",
              D: rawOptions[3] ?? q.optionD ?? "",
              E: rawOptions[4] ?? q.optionE ?? "",
            }
          : rawOptions && typeof rawOptions === "object"
            ? rawOptions
            : {
                A: q.optionA ?? "",
                B: q.optionB ?? "",
                C: q.optionC ?? "",
                D: q.optionD ?? "",
                E: q.optionE ?? "",
              };
        const normalized = {
          ...q,
          id: typeof q.id === "string" && q.id.replace(/^firestore-/, "").trim()
            ? q.id
            : `q_${randomUUID()}`,
          examId: q.examId || String(q.exam || "CAT").toLowerCase(),
          correctAnswer: q.correctAnswer || q.answer || "",
          options,
          category: q.category || q.topic || q.section || "",
          subject: q.subject || q.category || q.topic || "",
          topic: q.topic || q.category || "",
          questionType: q.questionType || q.type || "MCQ",
          source: q.source || q.sourceUrl || "",
        };
        const record = questionDocument(normalized);
        const tags = Array.isArray(q.tags)
          ? q.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim().slice(0, 100)).filter(Boolean).slice(0, 50)
          : [];
        batch.set(db.collection("examQuestions").doc(record.id), {
          ...record,
          tags,
          importedAt: new Date().toISOString(),
          status: "published",
        }, { merge: true });
      });
      await batch.commit();
      return json(res, 200, { success: true, count: questions.length }), true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import questions.";
      if (/Invalid question payload|Question |Answer option |Correct answer|valid JSON|question ID|question IDs/.test(message)) return json(res, 400, { error: message }), true;
      console.error("[api/admin/questions/import] Firestore operation failed:", error);
      return json(res, 500, { error: "Could not import questions." }), true;
    }
  }
  // ------------------------------------

  if (req.method !== "POST" || !["/api/pdf/text", "/api/pdf/ocr", "/api/pdf/analyze"].includes(pathname)) return json(res, 404, { error: "Unknown API endpoint." }), true;
  if (!sameOrigin(req)) return json(res, 403, { error: "Request was rejected." }), true;
  if (!currentAdmin(req)) return json(res, 401, { error: "Your admin session expired. Sign in again." }), true;
  if (!process.env.GEMINI_API_KEY) return json(res, 503, { error: "AI service is not configured. Please contact the system administrator." }), true;
  if (pathname === "/api/pdf/ocr") { await streamPdfOcr(req, res); return true; }
  try {
    if (pathname === "/api/pdf/text") {
      const buffer = await bodyBuffer(req);
      const text = await extractPdfText(buffer);
      return json(res, 200, { text, ocrRequired: !isUsablePdfText(text) }), true;
    }
    const payload = JSON.parse((await bodyBuffer(req, 2 * 1024 * 1024)).toString("utf8"));
    if (typeof payload.text !== "string" || payload.text.length > 18000) return json(res, 400, { error: "Invalid or oversized question batch." }), true;
    return json(res, 200, await analyze(payload)), true;
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Question processing failed." }), true;
  }
}
