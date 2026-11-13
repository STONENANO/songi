/**
 * The direct preview link: /r/<song id>?p=<token>. It opens the song's versions on any
 * device, with the same rights as the browser that made the song (listen, choose, buy),
 * until it expires PREVIEW_LINK_HOURS after the versions were ready.
 *
 * The token is signed (HMAC over the song id and expiry), so nothing is stored and it
 * can't be edited to last longer or open another song. On first use it is copied into
 * a cookie that expires with it, so the page keeps working after the address bar changes.
 */
import crypto from "node:crypto";
import { env } from "../env";

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string) => b64(crypto.createHmac("sha256", env.mediaSigningSecret).update(`preview-link:${payload}`).digest());

type Claims = { r: string; x: number };

export function issuePreviewLink(requestId: string, expiresAtMs: number): string {
  const payload = b64(JSON.stringify({ r: requestId, x: Math.floor(expiresAtMs / 1000) } satisfies Claims));
  return `${payload}.${sign(payload)}`;
}

export type LinkCheck = { status: "valid"; expiresAtMs: number } | { status: "expired" } | { status: "invalid" };

export function verifyPreviewLink(token: string, requestId: string, nowMs = Date.now()): LinkCheck {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { status: "invalid" };
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return { status: "invalid" };
  let c: Claims;
  try {
    c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
  } catch {
    return { status: "invalid" };
  }
  if (c.r !== requestId || typeof c.x !== "number") return { status: "invalid" };
  if (c.x * 1000 <= nowMs) return { status: "expired" };
  return { status: "valid", expiresAtMs: c.x * 1000 };
}

/** When a song's link expires: PREVIEW_LINK_HOURS after its versions were ready. Null before then. */
export function previewLinkExpiry(r: { candidatesFinalizedAt: Date | null }): number | null {
  return r.candidatesFinalizedAt ? r.candidatesFinalizedAt.getTime() + env.previewLinkHours * 3600_000 : null;
}

/** The full link to send or copy, or null when the versions aren't ready or the link has expired. */
export function previewLinkFor(r: { id: string; candidatesFinalizedAt: Date | null }, nowMs = Date.now()): { url: string; expiresAt: string } | null {
  const exp = previewLinkExpiry(r);
  if (!exp || exp <= nowMs) return null;
  return { url: `${env.appUrl}/r/${r.id}?p=${issuePreviewLink(r.id, exp)}`, expiresAt: new Date(exp).toISOString() };
}

export function previewLinkCookieName(requestId: string): string {
  return `spl_${requestId.replace(/-/g, "").slice(0, 16)}`;
}

/** Keeps a valid link working on this device until the link itself expires. */
export function previewLinkCookie(requestId: string, token: string, expiresAtMs: number, nowMs = Date.now()): string {
  const maxAge = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
  const secure = env.appUrl.startsWith("https://") ? "; Secure" : "";
  return `${previewLinkCookieName(requestId)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
