/**
 * Signed, time-limited media tokens. Storage is private; the browser only ever
 * sees /api/media/<token> URLs. Preview tokens can only name preview files.
 * Full-song tokens are only issued server-side after a verified purchase.
 */
import crypto from "node:crypto";
import { env } from "../env";

export type MediaKind = "preview" | "full";
export type MediaClaims = { k: string; t: MediaKind; x: number; v?: string; n?: string };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function sign(payload: string): string {
  return b64(crypto.createHmac("sha256", env.mediaSigningSecret).update(payload).digest());
}

export function issueMediaToken(c: { key: string; kind: MediaKind; ttlSec: number; versionId?: string; filename?: string }, nowMs = Date.now()): string {
  if (c.kind === "preview" && !c.key.endsWith("/preview.mp3")) throw new Error("Preview tokens can only reference preview files.");
  const claims: MediaClaims = { k: c.key, t: c.kind, x: Math.floor(nowMs / 1000) + c.ttlSec, v: c.versionId, n: c.filename };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

export function verifyMediaToken(token: string, nowMs = Date.now()): MediaClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  let claims: MediaClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MediaClaims;
  } catch {
    return null;
  }
  if (typeof claims.x !== "number" || claims.x < Math.floor(nowMs / 1000)) return null;
  if (claims.t === "preview" && !claims.k.endsWith("/preview.mp3")) return null;
  return claims;
}

export function mediaUrl(token: string): string {
  return `/api/media/${token}`;
}

/** Permanent delivery link token for a paid order: HMAC of the order id, nothing stored. */
export function deliveryToken(orderId: string): string {
  return `${orderId}.${b64(crypto.createHmac("sha256", env.mediaSigningSecret).update(`delivery:${orderId}`).digest()).slice(0, 32)}`;
}

export function verifyDeliveryToken(token: string): string | null {
  const [orderId, sig] = token.split(".");
  if (!orderId || !sig || !/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const expected = deliveryToken(orderId).split(".")[1];
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? orderId : null;
}
