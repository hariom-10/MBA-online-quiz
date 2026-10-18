import { readFile } from "node:fs/promises";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export const adminSalt = "mba-prep-initial-admin-v1";
export const adminHash = "a5a00b9a04a9dfc91b8d3aff26a7005515a478ac50348aa1a46fe13579e419e2";
export const adminSessions = new Map();
export const sessionCookie = "mba_admin_session";
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;

const sessionSecret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "mba-prep-admin-secret-key-v1";

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expectedSig = createHmac("sha256", sessionSecret).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload || payload.expiresAt <= Date.now()) return null;
    return payload.profile;
  } catch {
    return null;
  }
}

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
  const isHttps = Boolean(req.socket?.encrypted || req.headers?.["x-forwarded-proto"] === "https");
  const secure = isHttps ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function currentAdmin(req) {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (!token) return null;
  const verified = verifyToken(token);
  if (verified) return verified;
  const session = adminSessions.get(token);
  if (session && session.expiresAt > Date.now()) return session.profile;
  return null;
}

export function createAdminSession(req, res) {
  const profile = { uid: "local-admin", name: "Administrator", email: "", studentId: "admin", role: "admin", status: "active", createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
  const token = signToken({ profile, expiresAt: Date.now() + sessionLifetimeMs });
  adminSessions.set(token, { profile, expiresAt: Date.now() + sessionLifetimeMs });
  res.setHeader("Set-Cookie", `${sessionCookie}=${token}; ${cookieOptions(req, sessionLifetimeMs / 1000)}`);
  return profile;
}

export async function bodyBuffer(req, max = 18 * 1024 * 1024) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
    if (typeof req.body === "object") return Buffer.from(JSON.stringify(req.body), "utf8");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("The upload exceeds the 18 MB limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
