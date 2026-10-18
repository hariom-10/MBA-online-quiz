import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || 'AIzaSyBKmjYkkXWUbredEM8P1BDtY2YqUMFc3gc',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'mba-online-quiz.firebaseapp.com',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'mba-online-quiz',
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'mba-online-quiz.firebasestorage.app',
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '322029708869',
  appId: process.env.VITE_FIREBASE_APP_ID || '1:322029708869:web:ae255b65600c9f75be252c',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const cmatQuestions = [
  {
    id: 'cmat_qt_01',
    exam: 'CMAT',
    category: 'Quantitative Techniques',
    question: 'A shopkeeper marks an item at 25% above the cost price and allows a discount of 10% on the marked price. What is the profit percentage?',
    optionA: '12.5%',
    optionB: '15%',
    optionC: '10%',
    optionD: '17.5%',
    answer: 'A',
    explanation: 'Let CP = 100. Marked Price MP = 125. Selling Price SP = 125 * 0.90 = 112.5. Profit = 112.5 - 100 = 12.5%.'
  },
  {
    id: 'cmat_lr_01',
    exam: 'CMAT',
    category: 'Logical Reasoning',
    question: 'In a certain code, "PENCIL" is written as "QGOFKN". How is "ERASER" written in that code?',
    optionA: 'FSDTFV',
    optionB: 'FTCVGU',
    optionC: 'FTCUGU',
    optionD: 'FSCTFV',
    answer: 'C',
    explanation: 'The shift pattern is +1, +2, +1, +2, +1, +2. E+1=F, R+2=T, A+1=B... checking pattern: P->Q (+1), E->G (+2), N->O (+1), C->F (+3). Applying the incremental shift gives FTCUGU.'
  },
  {
    id: 'cmat_lc_01',
    exam: 'CMAT',
    category: 'Language Comprehension',
    question: 'Select the most appropriate synonym for the word "EPHEMERAL":',
    optionA: 'Transient',
    optionB: 'Enduring',
    optionC: 'Celestial',
    optionD: 'Perpetual',
    answer: 'A',
    explanation: '"Ephemeral" means lasting for a very short time; transient is its exact synonym.'
  },
  {
    id: 'cmat_ga_01',
    exam: 'CMAT',
    category: 'General Awareness',
    question: 'Which institution serves as the monetary policy regulator and issuer of currency in India?',
    optionA: 'State Bank of India',
    optionB: 'Reserve Bank of India',
    optionC: 'Securities and Exchange Board of India',
    optionD: 'Ministry of Finance',
    answer: 'B',
    explanation: 'The Reserve Bank of India (RBI) is the central bank and monetary authority of India.'
  },
  {
    id: 'cmat_ie_01',
    exam: 'CMAT',
    category: 'Innovation & Entrepreneurship',
    question: 'What is a "bootstrapped" startup?',
    optionA: 'A company backed by venture capital from day one',
    optionB: 'A business built using existing personal resources and operating revenues without external funding',
    optionC: 'A government-subsidized technology incubator project',
    optionD: 'A company preparing for an Initial Public Offering (IPO)',
    answer: 'B',
    explanation: 'Bootstrapping means starting and growing a business without attracting external venture investment or capital loans.'
  }
];

const xatQuestions = [
  {
    id: 'xat_dm_01',
    exam: 'XAT',
    category: 'Decision Making',
    question: 'A manufacturing firm discovers a minor, non-hazardous defect in a batch of 5,000 products already shipped to retailers. Fixing the issue in the field will incur significant cost, but ignoring it may harm brand reputation if noticed by observant customers. What is the most ethically and strategically sound decision?',
    optionA: 'Ignore the defect unless customers file formal complaints.',
    optionB: 'Proactively notify retailers, provide a swift free replacement or fix kit, and inspect quality control processes at the plant.',
    optionC: 'Quietly discount the batch on the shelves without informing the public.',
    optionD: 'Blame the outsourced parts supplier and issue a press release denying responsibility.',
    answer: 'B',
    explanation: 'Transparent communication, consumer safety, and safeguarding long-term stakeholder trust are core principles of ethical business decision-making.'
  },
  {
    id: 'xat_valr_01',
    exam: 'XAT',
    category: 'Verbal Ability & Logical Reasoning',
    question: 'Identify the grammatically correct sentence:',
    optionA: 'Neither the manager nor the employees was aware of the policy change.',
    optionB: 'Neither the manager nor the employees were aware of the policy change.',
    optionC: 'Neither the manager or the employees was aware of the policy change.',
    optionD: 'Neither the manager nor the employees has been aware of the policy change.',
    answer: 'B',
    explanation: 'In "neither... nor" constructions, the verb agrees with the closer subject ("employees", which is plural), hence "were aware".'
  },
  {
    id: 'xat_qadi_01',
    exam: 'XAT',
    category: 'Quantitative Ability & Data Interpretation',
    question: 'A circle of radius 6 cm is inscribed in an equilateral triangle. Find the area of the equilateral triangle.',
    optionA: '72√3 cm²',
    optionB: '108√3 cm²',
    optionC: '144√3 cm²',
    optionD: '36√3 cm²',
    answer: 'B',
    explanation: 'In an equilateral triangle with side a, inradius r = a / (2√3). Given r = 6, a = 12√3. Area = (√3 / 4) * a² = (√3 / 4) * 432 = 108√3 cm².'
  },
  {
    id: 'xat_gk_01',
    exam: 'XAT',
    category: 'General Knowledge',
    question: 'Which strait connects the Persian Gulf and the Gulf of Oman, forming one of the worlds most critical oil transit chokepoints?',
    optionA: 'Strait of Malacca',
    optionB: 'Strait of Hormuz',
    optionC: 'Bab-el-Mandeb',
    optionD: 'Bosphorus Strait',
    answer: 'B',
    explanation: 'The Strait of Hormuz connects the Persian Gulf with the Gulf of Oman and the Arabian Sea.'
  }
];

async function seed() {
  console.log('Seeding CMAT and XAT starter questions into Firestore...');
  for (const q of [...cmatQuestions, ...xatQuestions]) {
    await setDoc(doc(db, 'examQuestions', q.id), {
      ...q,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`Uploaded ${q.exam} - ${q.category}: ${q.id}`);
  }
  console.log('Successfully seeded CMAT and XAT questions!');
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
