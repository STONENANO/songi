/**
 * Cloudflare Turnstile: proof that "Write the song" was pressed by a person, checked on
 * the server before a song (and its API spend) is created. Off until both keys are set.
 * Tokens are single-use and expire after 5 minutes; Cloudflare enforces both.
 */
import { env } from "../env";
import { reportError } from "../observability";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The action the quiz's widget declares; a token minted for anything else is refused. */
export const TURNSTILE_ACTION = "create_song";

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export async function verifyTurnstile(token: string | undefined, ip: string, fetchImpl: typeof fetch = fetch): Promise<TurnstileResult> {
  const t = env.turnstile;
  if (!t.enabled) return { ok: true };
  if (!token) return { ok: false, reason: "missing_token" };
  let body: { success?: boolean; action?: string; "error-codes"?: string[] };
  try {
    const form = new URLSearchParams({ secret: t.secretKey, response: token });
    if (ip && ip !== "local") form.set("remoteip", ip);
    const res = await fetchImpl(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    body = (await res.json()) as typeof body;
  } catch (e) {
    // Fail closed: without the check, song creation is unprotected. The buyer can retry.
    reportError(e, { where: "turnstile" });
    return { ok: false, reason: "verify_unreachable" };
  }
  if (!body.success) return { ok: false, reason: (body["error-codes"] ?? ["failed"]).join(",") };
  if (body.action && body.action !== TURNSTILE_ACTION) return { ok: false, reason: "wrong_action" };
  return { ok: true };
}
