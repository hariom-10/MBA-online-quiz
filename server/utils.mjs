import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

export const adminSalt = "mba-prep-initial-admin-v1";
export const adminHash = "ceaf104b4d5088774e289a46d9f99f4f9014d82602cc50d55d3d1dd0e24cd050";
export const adminSessions = new Map();
export const sessionCookie = "mba_admin_session";
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;

export function loadEnvFile(path, { preferLocalGeminiKey = false } = {}) {
  return readFile(path, "utf8").then((contents) => {
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
      if (match && (process.env[match[1]] === undefined || process.env[match[1]] === "" || (preferLocalGeminiKey && match[1] === "GEMINI_API_KEY"))) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
    }
  }).catch(() => {});
}

export const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s, 2)).filter(([key, value]) => key && value !== undefined));
}

export function cookieOptions(req, maxAge) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export function currentAdmin(req) {
  const value = parseCookies(req.headers.cookie)[sessionCookie];
  const session = value && adminSessions.get(value);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { adminSessions.delete(value); return null; }
  session.expiresAt = Date.now() + sessionLifetimeMs;
  return session.profile;
}

export function createAdminSession(req, res) {
  const key = randomBytes(32).toString("base64url");
  const profile = { uid: "local-admin", name: "Administrator", email: "", studentId: "admin", role: "admin", status: "active", createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
  adminSessions.set(key, { profile, expiresAt: Date.now() + sessionLifetimeMs });
  res.setHeader("Set-Cookie", `${sessionCookie}=${key}; ${cookieOptions(req, sessionLifetimeMs / 1000)}`);
  return profile;
}

export async function bodyBuffer(req, max = 18 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("The upload exceeds the 18 MB limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
