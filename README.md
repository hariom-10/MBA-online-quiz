# MBA Exam Preparation & Question Practice

A responsive React + TypeScript multi-exam preparation app. Exam categories, exams, subjects, chapters, and platform questions are managed dynamically; the existing CAT, CMAT, MAT and XAT practice banks and quiz experience remain available.

## Run locally

1. Install Node.js 20 or later.
2. From this folder run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in the Firebase Web App values (see below).
4. Run `npm run dev` and open `http://localhost:5173`.
5. Build for production with `npm run build`, then serve it with `npm start`.

## AI PDF question import

The Admin Workspace includes **AI PDF Import**. The server first extracts selectable PDF text. If that text is missing or too short, it automatically renders pages one at a time with PDF.js and OCRs them with Tesseract.js. OCR progress, page confidence, and partial page failures are reported in the importer. The resulting text is sent in batches to the Gemini API through the official Google GenAI JavaScript SDK using structured JSON output for individual question review. `GEMINI_API_KEY` must be a Google AI Studio key and remains on the server. The existing Admin Login establishes a server-verified, HttpOnly session that authorizes PDF requests; no separate token is requested.

Add these entries to the root `.env.local` file (copy `.env.example` first):

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
```

Keep `GEMINI_API_KEY` private and out of frontend variables and source control. Put it in the root `.env.local` for local use or the server's private environment configuration in production. Sign in through the existing Admin Login; no API key or additional token is entered in the Admin Workspace. Restart the app after changing `.env.local`. `GEMINI_MODEL` is optional; the default is `gemini-3.8-flash`.

Approved questions and extracted-paper records are persisted through same-origin Admin API routes that require the server-verified Admin session. Firestore client writes to `examQuestions` are denied, and imported-paper reads and writes are available only through the Admin API. Configure Firebase Admin credentials on the server for persistence; an unavailable database produces an explicit error rather than a local-only success. The existing CAT, CMAT and XAT question-bank listener remains read-only.

Admin login is server-only. Configure `ADMIN_PASSWORD` (at least 12 characters) and `SESSION_SECRET` (at least 32 characters) in the server's private environment or root `.env.local`; never use a `VITE_` variable for Admin credentials. Set `FIREBASE_SERVICE_ACCOUNT_JSON` privately for Admin API database writes. `.env.example` intentionally contains no default Admin password.

The PDF extractor handles common selectable-text PDFs, including Flate-compressed text streams. If text is absent or insufficient, the server renders pages sequentially and OCRs them in English. Scanned PDFs are limited to 250 pages per import; the existing 18 MB upload limit is unchanged. On the first OCR run, Tesseract downloads its English model and caches it under `.cache/tesseract`, so the server needs outbound network access for that initial download. No system-installed Tesseract or Poppler executable is required. Encrypted PDFs and unusual font encodings may not render reliably. OCR failures on individual pages are reported while remaining pages continue. The PDF file itself is not retained; extracted paper metadata and review records are stored in Firestore.

Run the focused selectable-text and two-page scanned-PDF regression check with `node scripts/test-pdf-ocr.mjs`.

### Import checklist

1. Add `GEMINI_API_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `FIREBASE_SERVICE_ACCOUNT_JSON` to `.env.local`, along with any Firebase Web App values the app needs.
2. Run `npm run dev`; sign in as admin and open **AI PDF Import**.
3. Upload a selectable-text PDF and click **Analyze PDF**.
4. Inspect each question, correct classifications and answers as needed, explicitly approve any suggested chapter creation, then approve questions individually or approve the valid items together.
5. Confirm approved records appear under **Questions** and in the matching practice section.

## Firebase setup

1. In the Firebase Console, create or open the project that contains your Firestore database.
2. Add a Web App in Project settings, then copy its Firebase configuration values.
3. In this project folder, copy `.env.example` to `.env.local`.
4. Paste the Web App values into the matching `VITE_FIREBASE_*` entries in `.env.local`. This is the configuration file used by `src/firebase.ts`.
5. Ensure Cloud Firestore is enabled and its rules allow public reads of `examQuestions` while denying client writes. `extractedPapers`, `students`, `studentLogins`, and `studentAttempts` are not readable or writable through the client SDK; server APIs use the private Admin SDK credential.
6. Restart `npm run dev` after changing `.env.local`.

The Firebase Web SDK configuration identifies the Firebase project and is intended for client apps. Never put a service-account JSON file, private key, or Admin SDK credentials in this frontend project. Firestore Security Rules control access to the data.

## Exam categories

The Student Portal loads active categories from the Firestore `examCategories` collection; category names are not maintained in the frontend. On first use, the server initializes the provided starter categories if the collection has not already been initialized. Admins can add, edit, activate/deactivate, and delete categories from **Admin Workspace → Exam Categories**. Student category reads are public and update live, while all writes go through the same-origin Admin API and require a verified Admin session. Deleting all categories does not recreate the starter set.

Category-specific student exam choices are stored in Firestore's `platformExams` collection and managed under **Admin Workspace → Exam Management**. The server initializes the supplied starter exam records once when that collection is first used; these are regular database records afterward, and admins can edit, assign, activate/deactivate, or delete them. The four existing MBA quiz banks are linked to the initial CAT, CMAT, MAT and XAT catalog records so existing practice remains available. New catalog exams can optionally link to one of the existing quiz banks; exams without a linked quiz bank are visible to students but marked as coming soon. Category deletion is blocked while any exams are assigned to it.

Subjects and chapters are stored dynamically in Firestore's `platformSubjects` and `platformChapters` collections and managed under **Admin Workspace → Subjects & Chapters**. Each subject belongs to one platform exam and each chapter belongs to one subject. Students can browse the subject and chapter hierarchy from an exam card and start a timed chapter quiz when matching multiple-choice questions with answer keys exist in `examQuestions`. Question records should identify the exam via `exam` or `examId`, the subject via `subject` or `category`, and the chapter via `chapter`; each quiz question needs options A–D and an answer key. The quiz reuses the existing CBT navigation and review UI, uses one point per correct answer with no penalty, and shows correct answers and explanations after submission. The existing linked quiz-bank practice action remains available. Deleting a subject also deletes its chapters; deleting an exam removes its subject and chapter catalog records.

The server API needs the Firebase Admin SDK service-account JSON in its private `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable (or the root `.env.local` for local development) to persist catalog, question, and paper changes. Do not expose that credential to the browser. The Firestore rules permit reads of the public catalog collections and deny client-side writes. If the server credential is missing or Firestore is unavailable, management screens report the storage error instead of showing hardcoded or non-persistent data.

## CAT 2024 Slot 3 answer and explanation matching

The app includes answer/explanation data for the questions in `CAT 2024 QUANT Slot-3.pdf`. When an existing CAT question is fetched from Firestore, its question text is matched against `firestore-import/cat-2024-slot-3.json`. A match adds the PDF answer and explanation to that quiz question in the app; it does not add or remove quiz questions, or change their wording or options. After the student answers, the existing feedback screen shows the correct answer and explanation.

## Firestore question records

Use the existing collection named `examQuestions`. Each document must contain these fields:

- `exam`: `CAT`, `CMAT`, or `XAT` (uppercase; this value is queried exactly)
- `question`: question text
- `optionA`, `optionB`, `optionC`, `optionD`: the four option texts
- `answer`: the exact text of the correct option, or its letter `A`, `B`, `C`, or `D`
- `category`: a section/category name, such as `Quantitative Aptitude`
- `explanation`: explanation text

When CAT is selected, the app listens to `examQuestions` where `exam == "CAT"`; CMAT and XAT use the same query with their respective uppercase values. The listener updates the page when a document is added, edited, or deleted. Categories are matched to the app's existing section names. Each remote record is assigned to a chapter in that section so the existing chapter practice flow can be used. If the collection has no matching documents, the exam dashboard shows an empty-state message. If the query fails, the dashboard shows an error and retry button.

To add or edit questions, use the authenticated Admin Workspace question-management or PDF-import screens. Direct client writes to `examQuestions` are denied by Firestore rules.

## Student accounts and performance

The initial account chooser separates Admin Login from Student access. Students select a category before registering or signing in. Student credentials use salted PBKDF2 hashes in Firestore; the server issues HttpOnly student sessions and checks the account status on protected requests. The browser never reads student credential documents.

Completed practice quizzes and CBT mocks are saved through `/api/student/attempts`. The server derives the student UID from the session cookie, calculates attempted/correct/incorrect counts and score, and stores each attempt with its question-and-answer review in `studentAttempts`. Students can only list their own attempts through the session-protected endpoint. Admin student and attempt management use separate Admin-session-protected APIs. Student account, attempt, and login-index collections must remain denied to client SDKs.

Configure `FIREBASE_SERVICE_ACCOUNT_JSON`, `ADMIN_PASSWORD`, and `SESSION_SECRET` privately on the server for student registration, sign-in, and protected performance storage. Student accounts previously created only in browser localStorage are not automatically migrated; students must register again unless their accounts are migrated through a trusted process. Browser-local quiz history from older versions is not imported as verified server history.

## Test the integration

1. Configure the Firebase Web App values and private server credentials in `.env.local`, start the dev server, and open the app.
2. Verify the separate Student and Admin entry points. Register or sign in as a Student, then confirm active categories, exams, subjects, and chapters load in sequence.
3. In Admin Workspace, add or edit a category, exam, subject, chapter, and question; verify the changes appear in the Student Portal. Use the Admin UI or protected APIs for writes, not direct client-side Firestore edits.
4. Complete a chapter quiz and an existing CAT, CMAT, MAT, or XAT practice quiz. Check navigation, timer, score, answer review, explanations, and restart behavior.
5. Confirm the Student sees the saved attempt in history and cannot access another Student's records or Admin endpoints. Confirm Admin can manage students, questions, and papers.
6. Import selectable-text and scanned PDFs, review questions, and approve valid entries. Confirm database or authentication failures are shown rather than treated as successful saves.
7. Run `node scripts/test-pdf-ocr.mjs` and `npm run build` for focused regression and production-build checks.
