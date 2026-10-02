# MBA Exam Preparation & Question Practice

A responsive React + TypeScript application for CAT, CMAT, MAT and XAT preparation. Students can practice by exam, subject and chapter; take random quizzes; review wrong answers; view results and per-exam progress; and report questions. Admins can manage exams, subjects, chapters, questions, student accounts, settings and reports.

## Run locally

1. Install Node.js 20 or later.
2. From this folder run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.
4. Create a production build with `npm run build`.

No backend, cloud account, API key or environment file is required.

## Local accounts and storage

The initial account chooser offers separate Admin Login and Student Login forms. Use the existing local Admin credentials. Admins can create individual student IDs and passwords from **Admin Dashboard → Create Student Account**.

Questions, exams, subjects, chapters, settings, account records, reports, theme preference and each user's quiz progress are saved in the browser's `localStorage`. Data remains in that browser after refresh or restart, but is not synced to other browsers or devices. Clearing site data removes it. Export or back up the browser data separately if it must be retained.

Local browser storage is suitable for personal use and a small trusted group; it is not a secure authorization boundary for a public deployment. A browser user can inspect or alter locally stored data. Admin-only controls are separated in the app UI, and student actions do not expose question-management forms.

## Question management

From **Admin Dashboard → Questions**, add, edit, search, categorize and delete questions. The editor captures exam, subject/section, chapter/topic, question, four options, correct answer, explanation, source year, slot and difficulty. Questions and changes are written to local storage. Subjects and chapters are managed in their corresponding Admin Dashboard sections.

The offline topic classifier provides editable suggestions; check its results before saving. Mathematical content is rendered by KaTeX.
