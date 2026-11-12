import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { handleKieCallback } from "@/lib/pipeline/run";
import { verifyCallbackParams, verifyKieSignature, verifyLegacySecret } from "@/lib/kie/client";
import { KieCallbackSchema } from "@/lib/kie/types";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

/**
 * Kie.ai posts here when a task changes state. We answer 200 fast (Kie allows
 * 15s) and never trust audio URLs from the body: the handler re-fetches the
 * authoritative result from Kie.ai's task API.
 *
 * Authentication, in order:
 *  1. Our own signature on the callback URL (gid + sig), bound to one generation.
 *     Legacy URLs used ?secret=; still accepted for tasks submitted before v2.
 *  2. Kie.ai's X-Webhook-Signature (HMAC of taskId.timestamp), required when KIE_WEBHOOK_HMAC_KEY is set.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const gid = url.searchParams.get("gid");
  const ourSig = verifyCallbackParams(gid, url.searchParams.get("sig"));
  const legacy = !gid && verifyLegacySecret(url.searchParams.get("secret"));
  if (!ourSig && !legacy) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await readJson(req, BODY_LIMITS.webhook);
  if (!body.ok) return body.response;
  const parsed = KieCallbackSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  const taskId = parsed.data.data.task_id ?? parsed.data.data.taskId ?? null;

  if (env.kieWebhookHmacKey) {
    if (!taskId || !verifyKieSignature(taskId, req.headers.get("x-webhook-timestamp"), req.headers.get("x-webhook-signature"), env.kieWebhookHmacKey)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else if (env.isProd) {
    console.warn("[kie] KIE_WEBHOOK_HMAC_KEY is not set; relying on the signed callback URL only.");
  }

  // "text" and "first" stages are progress notices; the handler only acts once the task is final.
  after(() => handleKieCallback({ generationId: gid, taskId, code: parsed.data.code, msg: parsed.data.msg }));
  return NextResponse.json({ status: "received" });
}
