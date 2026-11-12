/**
 * Customer identity without accounts: each song project gets a random access
 * token, stored only as a SHA-256 hash. The browser holds it in an httpOnly
 * cookie scoped to the project. Every project API checks it.
 *
 * Projects created before v2 have no hash and stay readable (legacy), but
 * cannot start checkout until claimed.
 */
import crypto from "node:crypto";
import { env } from "../env";

export function newProjectToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function cookieName(projectId: string): string {
  return `sp_${projectId.replace(/-/g, "").slice(0, 16)}`;
}

export function projectCookie(projectId: string, token: string): string {
  const secure = env.appUrl.startsWith("https://") ? "; Secure" : "";
  return `${cookieName(projectId)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${secure}`;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export type Access = "owner" | "legacy" | "denied";

/** Owner if the cookie (or ?k= claim token) matches; legacy if the project predates tokens. */
export function checkAccess(req: Request, project: { id: string; accessTokenHash: string | null }): Access {
  if (!project.accessTokenHash) return "legacy";
  const url = new URL(req.url);
  const token = readCookie(req.headers.get("cookie"), cookieName(project.id)) ?? url.searchParams.get("k");
  if (!token) return "denied";
  const h = hashToken(token);
  return h.length === project.accessTokenHash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(project.accessTokenHash)) ? "owner" : "denied";
}
