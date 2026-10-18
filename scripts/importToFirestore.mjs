import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, writeBatch } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Try reading .env.local or process.env
const envLocalPath = path.join(rootDir, '.env.local');
const envVars = { ...process.env };

if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      envVars[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

const firebaseConfig = {
  apiKey: envVars.VITE_FIREBASE_API_KEY,
  authDomain: envVars.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: envVars.VITE_FIREBASE_PROJECT_ID,
  storageBucket: envVars.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: envVars.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: envVars.VITE_FIREBASE_APP_ID,
};

const isConfigured = Object.values(firebaseConfig).every(
  (v) => typeof v === 'string' && v.trim().length > 0 && !v.includes('your-')
);

if (!isConfigured) {
  console.log('⚠️ Firebase configuration is missing or incomplete in .env.local.');
  console.log('Please configure .env.local with your Firebase project credentials (see .env.example):');
  console.log('VITE_FIREBASE_API_KEY=...');
  console.log('VITE_FIREBASE_PROJECT_ID=...');
  console.log('etc.\n');
  console.log('Note: Questions have also been compiled into firestore-import/cat-2024-all-slots.json');
  console.log('and bundled into the frontend application for offline & fallback access.\n');
  process.exit(0);
}

console.log(`Connecting to Firebase project: ${firebaseConfig.projectId}...`);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 2. Load questions
const jsonPath = path.join(rootDir, 'firestore-import', 'cat-2024-all-slots.json');
if (!fs.existsSync(jsonPath)) {
  console.error(`Error: Question file not found at ${jsonPath}`);
  process.exit(1);
}

const questions = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
console.log(`Found ${questions.length} questions to import into Firestore 'examQuestions' collection.`);

function cleanOption(text) {
  if (!text) return '';
  return text.replace(/^\([A-E]\)\s*/i, '').replace(/^[A-E]\.\s*/i, '').trim();
}

function getCategory(subject) {
  if (subject === 'QUANT') return 'Quantitative Aptitude';
  if (subject === 'VARC') return 'Verbal Ability & Reading Comprehension';
  if (subject === 'DILR') return 'Data Interpretation';
  return subject || 'Quantitative Aptitude';
}

function extractAnswer(q, optA, optB, optC, optD) {
  const raw = (q.correct_answer || '').trim();
  if (!q.options || q.options.length === 0) return raw;
  const match = raw.match(/Choice\s+([A-D])/i) || raw.match(/^\(?([A-D])\)?/i);
  if (match) return match[1].toUpperCase();
  if (optA && optA.toLowerCase() === raw.toLowerCase()) return 'A';
  if (optB && optB.toLowerCase() === raw.toLowerCase()) return 'B';
  if (optC && optC.toLowerCase() === raw.toLowerCase()) return 'C';
  if (optD && optD.toLowerCase() === raw.toLowerCase()) return 'D';
  return raw;
}

async function importQuestions() {
  const BATCH_SIZE = 50;
  let importedCount = 0;

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const chunk = questions.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const q of chunk) {
      // Deterministic document ID: e.g. cat_2024_s1_quant_q01
      const docId = `cat_2024_s${q.slot}_${q.subject.toLowerCase()}_q${String(q.question_number).padStart(2, '0')}`;
      const docRef = doc(db, 'examQuestions', docId);

      const optA = cleanOption(q.options?.[0]);
      const optB = cleanOption(q.options?.[1]);
      const optC = cleanOption(q.options?.[2]);
      const optD = cleanOption(q.options?.[3]);
      const answer = extractAnswer(q, optA, optB, optC, optD);
      const category = getCategory(q.subject);

      // Store in examQuestions format expected by App.tsx and README
      const docData = {
        exam: (q.exam || 'CAT').toUpperCase(),
        year: Number(q.year) || 2024,
        slot: Number(q.slot) || 1,
        category,
        subject: q.subject,
        question_number: Number(q.question_number),
        question: q.question,
        optionA: optA,
        optionB: optB,
        optionC: optC,
        optionD: optD,
        answer,
        explanation: q.explanation || '',
        source: q.source || '',
        confidence: q.confidence || 'High',
        options: Array.isArray(q.options) ? q.options : [],
        correct_answer: q.correct_answer || '',
        updatedAt: new Date().toISOString()
      };

      batch.set(docRef, docData, { merge: true });
    }

    await batch.commit();
    importedCount += chunk.length;
    console.log(`Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1} (${importedCount}/${questions.length} questions)...`);
  }

  console.log(`\n🎉 Successfully imported all ${importedCount} CAT 2024 questions into Firestore 'examQuestions' collection!`);
}

importQuestions().catch((err) => {
  console.error('Import failed with error:', err);
  process.exit(1);
});

