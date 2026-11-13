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
import { previewLinkCookieName, verifyPreviewLink } from "./preview-link";

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

/**
 * owner: this browser made the song (cookie, or a ?k= claim token).
 * link: a valid direct preview link (?p= or its cookie); same rights as the owner until it expires.
 * link_expired: only an expired preview link was presented.
 * legacy: the song predates access tokens. denied: anything else.
 */
export type Access = "owner" | "link" | "link_expired" | "legacy" | "denied";

/** Access that may see and act on the song (listen, choose, buy). */
export function canUseSong(access: Access): boolean {
  return access === "owner" || access === "link" || access === "legacy";
}

export function checkAccess(req: Request, project: { id: string; accessTokenHash: string | null }, nowMs = Date.now()): Access {
  if (!project.accessTokenHash) return "legacy";
  const url = new URL(req.url);
  const cookies = req.headers.get("cookie");
  const token = readCookie(cookies, cookieName(project.id)) ?? url.searchParams.get("k");
  if (token) {
    const h = hashToken(token);
    if (h.length === project.accessTokenHash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(project.accessTokenHash))) return "owner";
  }
  const link = url.searchParams.get("p") ?? readCookie(cookies, previewLinkCookieName(project.id));
  if (link) {
    const check = verifyPreviewLink(link, project.id, nowMs);
    if (check.status === "valid") return "link";
    if (check.status === "expired") return "link_expired";
  }
  return "denied";
}
