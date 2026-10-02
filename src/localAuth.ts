import type { StudentAccountInput, UserProfile } from "./model";

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
  if (!/^[a-z0-9_-]{3,32}$/i.test(id)) {
    throw new Error("Student IDs must be 3–32 letters, numbers, underscores or hyphens.");
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
    if (key !== "admin" || await derive(password, ADMIN_SALT) !== ADMIN_HASH) {
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

  const account = readStudents().find((student) => student.studentId.toLowerCase() === key);
  if (!account || account.status === "disabled" || await derive(password, account.passwordSalt) !== account.passwordHash) {
    throw new Error("Student ID or password is incorrect.");
  }
  const updated = { ...account, lastLogin: new Date().toISOString() };
  saveStudents(readStudents().map((student) => student.uid === updated.uid ? updated : student));
  const profile = publicProfile(updated);
  saveLocalSession(profile);
  return profile;
}

export async function createLocalStudent(input: StudentAccountInput): Promise<UserProfile> {
  const fields = validateInput(input, true);
  const students = readStudents();
  if (students.some((student) => student.studentId.toLowerCase() === fields.key)) {
    throw new Error("That Student ID is already in use.");
  }
  const passwordSalt = newSalt();
  const created: LocalStudent = {
    uid: `local-student-${globalThis.crypto.randomUUID()}`,
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
  saveStudents(students.map((student) => student.uid === uid ? next : student));
  return publicProfile(next);
}

export async function resetLocalStudentPassword(uid: string, password: string): Promise<void> {
  const existing = readStudents().find((student) => student.uid === uid);
  if (!existing) throw new Error("Student account not found.");
  const passwordSalt = newSalt();
  const updated = { ...existing, passwordSalt, passwordHash: await derive(password, passwordSalt) };
  saveStudents(readStudents().map((student) => student.uid === uid ? updated : student));
}

export function setLocalStudentDisabled(uid: string, disabled: boolean): void {
  const students = readStudents();
  if (!students.some((student) => student.uid === uid)) throw new Error("Student account not found.");
  saveStudents(students.map((student) => student.uid === uid ? { ...student, status: disabled ? "disabled" : "active" } : student));
  if (disabled && read<UserProfile | null>(SESSION_KEY, null)?.uid === uid) saveLocalSession(null);
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
}

export function readLocalStudents(): UserProfile[] {
  return readStudents().map(publicProfile);
}

export function readLocalAttemptEvents(): Array<Record<string, unknown> & { userId: string }> {
  return read<Array<Record<string, unknown> & { userId: string }>>(EVENTS_KEY, []);
}

export function recordLocalAttempt(uid: string, attempt: Record<string, unknown>): void {
  const events = readLocalAttemptEvents();
  events.push({ ...attempt, userId: uid });
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

export function clearLocalSession(): void {
  saveLocalSession(null);
}
