# MBA Exam Preparation & Question Practice

A responsive React + TypeScript app for CAT, CMAT, MAT and XAT preparation. CAT, CMAT and XAT practice questions are read from Firebase Cloud Firestore. MAT continues to use the app's existing local question bank. Quiz navigation, scoring, explanations, progress and the existing layout remain in the app.

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

Imports are saved to the same `Question` model and `mba-questions` localStorage bank used by the existing Add Question flow, and display in the existing Questions list and practice views. This project currently uses browser-local question storage for admin edits; it does not have a server-side question write path. Consequently, imported questions are available in that browser only and are not written to Firestore or synchronized across browsers. CAT, CMAT and XAT Firestore records remain read-only in this app. Do not assume import persistence across browsers until the app's storage/auth architecture is migrated to a shared backend.

The PDF extractor handles common selectable-text PDFs, including Flate-compressed text streams. If text is absent or insufficient, the server renders pages sequentially and OCRs them in English. Scanned PDFs are limited to 250 pages per import; the existing 18 MB upload limit is unchanged. On the first OCR run, Tesseract downloads its English model and caches it under `.cache/tesseract`, so the server needs outbound network access for that initial download. No system-installed Tesseract or Poppler executable is required. Encrypted PDFs and unusual font encodings may not render reliably. OCR failures on individual pages are reported while remaining pages continue. Import history is browser-local.

Run the focused selectable-text and two-page scanned-PDF regression check with `node scripts/test-pdf-ocr.mjs`.

### Import checklist

1. Add `GEMINI_API_KEY` to `.env.local`, along with any Firebase values the app needs.
2. Run `npm run dev`; sign in as admin and open **AI PDF Import**.
3. Upload a selectable-text PDF and click **Analyze PDF**.
4. Inspect each question, correct classifications and answers as needed, explicitly approve any suggested chapter creation, then approve questions individually or approve the valid items together.
5. Confirm approved records appear under **Questions** and in the matching practice section.

## Firebase setup

1. In the Firebase Console, create or open the project that contains your Firestore database.
2. Add a Web App in Project settings, then copy its Firebase configuration values.
3. In this project folder, copy `.env.example` to `.env.local`.
4. Paste the Web App values into the matching `VITE_FIREBASE_*` entries in `.env.local`. This is the configuration file used by `src/firebase.ts`.
5. Ensure Cloud Firestore is enabled and its rules allow the quiz app to read `examQuestions`. The app's local student/admin sign-in is not Firebase Authentication, so it does not provide a Firebase user identity for Firestore rules. For a public quiz bank, allow reads and deny client writes for this collection; do not allow public writes.
6. Restart `npm run dev` after changing `.env.local`.

The Firebase Web SDK configuration identifies the Firebase project and is intended for client apps. Never put a service-account JSON file, private key, or Admin SDK credentials in this frontend project. Firestore Security Rules control access to the data.

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

To add a question: open Firestore Data, select `examQuestions`, add a document, enter the exact field names and types above, and set `exam` to the intended uppercase exam. The selected exam view updates automatically.

## Local accounts and storage

The initial account chooser offers Admin Login and Student Login. Admin-created student accounts, local account records, settings, reports and quiz progress remain in browser `localStorage`; they are not synced between browsers. Firestore supplies CAT/CMAT/XAT question content. MAT remains local. The app's local role checks are not a secure authorization boundary for public deployment.

## Test the integration

1. Fill in `.env.local`, start the dev server, and open the app.
2. In Firestore, create at least one valid `examQuestions` document for each exam, using the exact uppercase `exam` values.
3. Open CAT, CMAT, and XAT individually and check that only that exam's questions and matching categories appear.
4. Answer a question and confirm correct/incorrect feedback, explanation, progress, results, and restart work as before.
5. While an exam is open, add or edit a Firestore document with that exam value and confirm the displayed count/content updates live.
6. Temporarily use an exam value with no matching documents (or an empty collection) and confirm the no-questions message appears. Check a denied Firestore read to confirm the error and retry state.
7. Run `npm run build` to verify the production bundle.
