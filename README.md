# MBA Exam Preparation & Question Practice

A responsive React + TypeScript app for CAT, CMAT, MAT and XAT preparation. CAT, CMAT and XAT practice questions are read from Firebase Cloud Firestore. MAT continues to use the app's existing local question bank. Quiz navigation, scoring, explanations, progress and the existing layout remain in the app.

## Run locally

1. Install Node.js 20 or later.
2. From this folder run `npm install`.
3. Copy `.env.example` to `.env.local` and fill in the Firebase Web App values (see below).
4. Run `npm run dev` and open the local URL printed by Vite.
5. Build for production with `npm run build`.

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
