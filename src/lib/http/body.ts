/**
 * Request bodies with a size cap. Route handlers have no body limit of their own
 * (next.config's bodySizeLimit only covers Server Actions), so every route reads
 * its body through here: a declared Content-Length over the cap is refused before
 * reading, and a body without one stops being read as soon as it passes the cap.
 */
import { NextResponse } from "next/server";

/** Byte caps per kind of request. Each is several times what a real client sends. */
export const BODY_LIMITS = {
  /** Small JSON: select, checkout, feedback, events, answers, probe, test pay. */
  small: 16 * 1024,
  /** Quiz analytics events. */
  track: 8 * 1024,
  /** New song: up to 8 story answers of about 4.6 KB each. */
  create: 64 * 1024,
  /** Hand-edited lyrics (6,000 characters, which can be multi-byte). */
  lyrics: 32 * 1024,
  /** Provider webhooks (Stripe events, Kie callbacks carry track lists). */
  webhook: 1024 * 1024,
} as const;

export const TOO_LARGE = "Request too large.";

/** The body as text, or null when it is larger than maxBytes. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type JsonBody = { ok: true; data: unknown } | { ok: false; response: NextResponse };

/**
 * Parse a JSON body of at most maxBytes. Invalid JSON gives data: null (callers
 * validate with zod, which rejects it); an oversized body gives a ready 413 response.
 */
export async function readJson(req: Request, maxBytes: number): Promise<JsonBody> {
  const text = await readBodyText(req, maxBytes);
  if (text === null) return { ok: false, response: NextResponse.json({ error: TOO_LARGE }, { status: 413 }) };
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: true, data: null };
  }
}
