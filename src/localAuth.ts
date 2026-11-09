import type { StudentAccountInput, UserProfile } from "./model";

type ApiResult<T> = T & { error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const result = await response.json() as ApiResult<T>;
  if (!response.ok) throw new Error(result.error || "The account service could not complete the request.");
  return result;
}

export function restoreLocalSession(): UserProfile | null {
  localStorage.removeItem("mba-demo-user");
  return null;
}

export async function verifySession(): Promise<UserProfile | null> {
  try {
    const result = await request<{ profile?: UserProfile }>("/api/auth/session");
    return result.profile ?? null;
  } catch (error) {
    if (error instanceof Error && error.message === "Sign in to continue.") return null;
    return null;
  }
}

export async function verifyAdminSession(): Promise<UserProfile | null> {
  const profile = await verifySession();
  return profile?.role === "admin" && profile.uid === "local-admin" ? profile : null;
}

export async function logoutAdminSession(): Promise<void> {
  await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function loginLocalAccount(studentId: string, password: string, kind: "student" | "admin"): Promise<UserProfile> {
  const path = kind === "admin" ? "/api/auth/admin/login" : "/api/auth/student/login";
  const result = await request<{ profile?: UserProfile }>(path, {
    method: "POST",
    body: JSON.stringify({ studentId, password }),
  });
  if (!result.profile || result.profile.role !== kind) throw new Error("The account service returned an invalid session.");
  return result.profile;
}

export async function createLocalStudent(input: StudentAccountInput): Promise<UserProfile> {
  const result = await request<{ profile?: UserProfile }>("/api/auth/student/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!result.profile || result.profile.role !== "student") throw new Error("The account service returned an invalid student account.");
  return result.profile;
}

export async function listManagedStudents(): Promise<UserProfile[]> {
  const result = await request<{ students?: UserProfile[] }>("/api/admin/students");
  if (!Array.isArray(result.students)) throw new Error("The student service returned invalid data.");
  return result.students;
}

export async function listManagedAttempts(): Promise<Array<Record<string, unknown> & { userId: string }>> {
  const result = await request<{ attempts?: Array<Record<string, unknown> & { userId: string }> }>("/api/admin/attempts");
  if (!Array.isArray(result.attempts)) throw new Error("The performance service returned invalid data.");
  return result.attempts;
}

export async function updateLocalStudent(uid: string, input: StudentAccountInput): Promise<UserProfile> {
  const result = await request<{ student?: UserProfile }>(`/api/admin/students?id=${encodeURIComponent(uid)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!result.student) throw new Error("The student service returned invalid data.");
  return result.student;
}

export async function resetLocalStudentPassword(uid: string, password: string): Promise<void> {
  await request<{ success: boolean }>(`/api/admin/students?id=${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "password", password }),
  });
}

export async function setLocalStudentDisabled(uid: string, disabled: boolean): Promise<UserProfile> {
  const result = await request<{ student?: UserProfile }>(`/api/admin/students?id=${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "status", disabled }),
  });
  if (!result.student) throw new Error("The student service returned invalid data.");
  return result.student;
}

export async function deleteLocalStudent(uid: string): Promise<void> {
  await request<{ success: boolean }>(`/api/admin/students?id=${encodeURIComponent(uid)}`, { method: "DELETE" });
}

export function clearLocalSession(): void {
  localStorage.removeItem("mba-demo-user");
}
