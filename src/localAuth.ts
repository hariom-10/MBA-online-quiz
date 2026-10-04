import type { StudentAccountInput, UserProfile } from "./model";
import { firestore } from "./firebase";
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from "firebase/firestore";

type LocalStudent = UserProfile & {
  role: "student";
  studentId: string;
  passwordSalt: string;
  passwordHash: string;
};

const STUDENTS_KEY = "mba-local-students";
const EVENTS_KEY = "mba-local-attempt-events";
const SESSION_KEY = "mba-demo-user";
const ADMIN_SALT = "mba-prep-initial-admin-v1";
const ADMIN_HASH = "ceaf104b4d5088774e289a46d9f99f4f9014d82602cc50d55d3d1dd0e24cd050";
const ITERATIONS = 210_000;

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch (error) {
    console.error(`Could not read local account data (${key}).`, error);
    throw new Error("Local account data is unavailable or damaged.");
  }
}

function readStudents(): LocalStudent[] {
  return read<LocalStudent[]>(STUDENTS_KEY, []);
}

function saveStudents(students: LocalStudent[]) {
  localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
}

function saveLocalSession(profile: UserProfile | null) {
  if (profile) localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  else localStorage.removeItem(SESSION_KEY);
}

export function restoreLocalSession(): UserProfile | null {
  const session = read<UserProfile | null>(SESSION_KEY, null);
  if (!session) return null;
  if (session.role === "admin" && session.uid === "local-admin") return session;
  const account = readStudents().find((student) => student.uid === session.uid && student.status !== "disabled");
  if (!account) {
    saveLocalSession(null);
    return null;
  }
  return publicProfile(account);
}

export async function verifyAdminSession(): Promise<UserProfile | null> {
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      if (!response.ok) return null;
      const data = await response.json() as { profile?: UserProfile };
      return data.profile?.role === "admin" && data.profile.uid === "local-admin" ? data.profile : null;
    }
  } catch {
    /* backend server not available (e.g. Firebase static hosting) */
  }
  const session = restoreLocalSession();
  return session?.role === "admin" && session.uid === "local-admin" ? session : null;
}

export async function logoutAdminSession(): Promise<void> {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      await response.json();
    }
  } catch {
    /* local sign-out still clears the browser profile */
  }
}

function publicProfile(account: LocalStudent): UserProfile {
  const { passwordHash: _hash, passwordSalt: _salt, ...profile } = account;
  return profile;
}

async function derive(password: string, salt: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure password verification requires a modern browser context.");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new TextEncoder().encode(salt),
    iterations: ITERATIONS,
    hash: "SHA-256",
  }, material, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanStudentId(studentId: string): { id: string; key: string } {
  const id = studentId.trim();
  if (!/^[a-z0-9_.-]{3,64}$/i.test(id)) {
    throw new Error("Student IDs or Emails must be 3–64 characters long.");
  }
  return { id, key: id.toLowerCase() };
}

function validateInput(input: StudentAccountInput, requirePassword: boolean) {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("Enter a student name (up to 100 characters).");
  const { id, key } = cleanStudentId(input.studentId);
  if (requirePassword && (!input.password || input.password.length < 8 || input.password.length > 128)) {
    throw new Error("Student passwords must be 8–128 characters.");
  }
  if (input.password && (input.password.length < 8 || input.password.length > 128)) {
    throw new Error("Student passwords must be 8–128 characters.");
  }
  const email = input.email.trim();
  if (email.length > 254) throw new Error("Email address is too long.");
  const phone = input.phone.trim();
  if (phone.length > 32) throw new Error("Phone number is too long.");
  return { name, id, key, email, phone };
}

export async function loginLocalAccount(studentId: string, password: string, kind: "student" | "admin"): Promise<UserProfile> {
  const { key } = cleanStudentId(studentId);
  if (kind === "admin") {
    let serverOk = false;
    let serverProfile: UserProfile | null = null;
    try {
      const response = await fetch("/api/auth/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: key, password }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const result = await response.json() as { profile?: UserProfile; error?: string };
        if (response.ok && result.profile?.role === "admin") {
          serverProfile = result.profile;
          serverOk = true;
        } else if (!response.ok) {
          throw new Error(result.error || "Admin ID or password is incorrect.");
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Admin ID or password is incorrect.") {
        throw err;
      }
    }

    if (serverOk && serverProfile) {
      saveLocalSession(serverProfile);
      return serverProfile;
    }

    const envAdminPassword = import.meta.env.VITE_ADMIN_PASSWORD;
    const isEnvMatch = Boolean(envAdminPassword && password === envAdminPassword);
    const isHashMatch = (await derive(password, ADMIN_SALT)) === ADMIN_HASH;
    const storedHash = localStorage.getItem("mba-admin-password-hash");
    const storedSalt = localStorage.getItem("mba-admin-password-salt") || ADMIN_SALT;
    const isStoredMatch = Boolean(storedHash && (await derive(password, storedSalt)) === storedHash);

    if (key !== "admin" || (!isEnvMatch && !isHashMatch && !isStoredMatch)) {
      throw new Error("Admin ID or password is incorrect.");
    }

    const profile: UserProfile = {
      uid: "local-admin",
      name: "Administrator",
      email: "",
      studentId: "admin",
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };
    saveLocalSession(profile);
    return profile;
  }

  // Look up student in local storage or Firebase Firestore
  let account = readStudents().find((s) => s.studentId.toLowerCase() === key || s.email.toLowerCase() === key);

  if (!account && firestore) {
    try {
      const q1 = query(collection(firestore, "students"), where("studentId", "==", key));
      const snap1 = await getDocs(q1);
      if (!snap1.empty) {
        account = snap1.docs[0].data() as LocalStudent;
      } else {
        const q2 = query(collection(firestore, "students"), where("email", "==", key));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) account = snap2.docs[0].data() as LocalStudent;
      }
    } catch (err) {
      console.warn("Firebase Firestore student lookup failed:", err);
    }
  }

  if (!account || account.status === "disabled" || (await derive(password, account.passwordSalt)) !== account.passwordHash) {
    throw new Error("Student ID or password is incorrect.");
  }

  const updated: LocalStudent = { ...account, lastLogin: new Date().toISOString() };
  const allStudents = readStudents();
  const nextList = allStudents.some((s) => s.uid === updated.uid)
    ? allStudents.map((s) => (s.uid === updated.uid ? updated : s))
    : [...allStudents, updated];
  saveStudents(nextList);

  if (firestore) {
    setDoc(doc(firestore, "students", updated.uid), updated, { merge: true }).catch(() => {});
  }

  const profile = publicProfile(updated);
  saveLocalSession(profile);
  return profile;
}

export async function createLocalStudent(input: StudentAccountInput): Promise<UserProfile> {
  const fields = validateInput(input, true);
  const students = readStudents();
  if (students.some((student) => student.studentId.toLowerCase() === fields.key || (fields.email && student.email.toLowerCase() === fields.email.toLowerCase()))) {
    throw new Error("That Student ID or Email address is already registered.");
  }

  // Check Firestore for duplicates as well
  if (firestore) {
    try {
      const q = query(collection(firestore, "students"), where("studentId", "==", fields.id));
      const snap = await getDocs(q);
      if (!snap.empty) throw new Error("That Student ID is already registered in Firebase.");
    } catch (err) {
      if (err instanceof Error && err.message.includes("already registered")) throw err;
    }
  }

  const passwordSalt = newSalt();
  const created: LocalStudent = {
    uid: `student-${globalThis.crypto.randomUUID()}`,
    name: fields.name,
    studentId: fields.id,
    email: fields.email,
    phone: fields.phone,
    role: "student",
    status: "active",
    createdAt: new Date().toISOString(),
    lastLogin: "",
    passwordSalt,
    passwordHash: await derive(input.password ?? "", passwordSalt),
  };

  saveStudents([...students, created]);

  // Sync to Firebase Firestore
  if (firestore) {
    try {
      await setDoc(doc(firestore, "students", created.uid), created);
    } catch (err) {
      console.warn("Could not save student to Firebase Firestore:", err);
    }
  }

  return publicProfile(created);
}

export async function updateLocalStudent(uid: string, input: StudentAccountInput): Promise<UserProfile> {
  const fields = validateInput(input, false);
  const students = readStudents();
  const existing = students.find((student) => student.uid === uid);
  if (!existing) throw new Error("Student account not found.");
  if (students.some((student) => student.uid !== uid && student.studentId.toLowerCase() === fields.key)) {
    throw new Error("That Student ID is already in use.");
  }
  let next: LocalStudent = {
    ...existing,
    name: fields.name,
    studentId: fields.id,
    email: fields.email,
    phone: fields.phone,
  };
  if (input.password) {
    const passwordSalt = newSalt();
    next = { ...next, passwordSalt, passwordHash: await derive(input.password, passwordSalt) };
  }
  saveStudents(students.map((student) => (student.uid === uid ? next : student)));

  if (firestore) {
    try {
      await setDoc(doc(firestore, "students", uid), next, { merge: true });
    } catch (err) {
      console.warn("Could not update student on Firebase Firestore:", err);
    }
  }

  return publicProfile(next);
}

export async function resetLocalStudentPassword(uid: string, password: string): Promise<void> {
  const existing = readStudents().find((student) => student.uid === uid);
  if (!existing) throw new Error("Student account not found.");
  const passwordSalt = newSalt();
  const updated = { ...existing, passwordSalt, passwordHash: await derive(password, passwordSalt) };
  saveStudents(readStudents().map((student) => (student.uid === uid ? updated : student)));

  if (firestore) {
    try {
      await setDoc(doc(firestore, "students", uid), { passwordSalt, passwordHash: updated.passwordHash }, { merge: true });
    } catch (err) {
      console.warn("Could not update password on Firebase Firestore:", err);
    }
  }
}

export function setLocalStudentDisabled(uid: string, disabled: boolean): void {
  const students = readStudents();
  if (!students.some((student) => student.uid === uid)) throw new Error("Student account not found.");
  saveStudents(students.map((student) => (student.uid === uid ? { ...student, status: disabled ? "disabled" : "active" } : student)));
  if (disabled && read<UserProfile | null>(SESSION_KEY, null)?.uid === uid) saveLocalSession(null);

  if (firestore) {
    setDoc(doc(firestore, "students", uid), { status: disabled ? "disabled" : "active" }, { merge: true }).catch(() => {});
  }
}

export function deleteLocalStudent(uid: string): void {
  const students = readStudents();
  if (!students.some((student) => student.uid === uid)) throw new Error("Student account not found.");
  saveStudents(students.filter((student) => student.uid !== uid));
  localStorage.removeItem(`mba-progress-${uid}`);
  localStorage.setItem(EVENTS_KEY, JSON.stringify(readLocalAttemptEvents().filter((attempt) => attempt.userId !== uid)));
  const reports = read<Array<{ studentUid: string } & Record<string, unknown>>>("mba-question-reports", []);
  localStorage.setItem("mba-question-reports", JSON.stringify(reports.filter((report) => report.studentUid !== uid)));
  if (read<UserProfile | null>(SESSION_KEY, null)?.uid === uid) saveLocalSession(null);

  if (firestore) {
    deleteDoc(doc(firestore, "students", uid)).catch(() => {});
  }
}

export function readLocalStudents(): UserProfile[] {
  return readStudents().map(publicProfile);
}

export async function syncFirebaseStudents(): Promise<UserProfile[]> {
  const local = readStudents();
  if (!firestore) return local.map(publicProfile);
  try {
    const snapshot = await getDocs(collection(firestore, "students"));
    const remote = snapshot.docs.map((d) => d.data() as LocalStudent);
    const map = new Map<string, LocalStudent>();
    for (const item of local) map.set(item.uid, item);
    for (const item of remote) map.set(item.uid, item);
    const merged = Array.from(map.values());
    saveStudents(merged);
    return merged.map(publicProfile);
  } catch {
    return local.map(publicProfile);
  }
}

export function readLocalAttemptEvents(): Array<Record<string, unknown> & { userId: string }> {
  return read<Array<Record<string, unknown> & { userId: string }>>(EVENTS_KEY, []);
}

export function recordLocalAttempt(uid: string, attempt: Record<string, unknown>): void {
  const events = readLocalAttemptEvents();
  events.push({ ...attempt, userId: uid });
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));

  if (firestore) {
    const attemptId = `attempt-${crypto.randomUUID()}`;
    setDoc(doc(firestore, "attempts", attemptId), { ...attempt, userId: uid, recordedAt: new Date().toISOString() }).catch(() => {});
  }
}

export function clearLocalSession(): void {
  saveLocalSession(null);
}
