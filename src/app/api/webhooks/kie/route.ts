import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { handleTaskResult } from "@/lib/pipeline/run";
import type { KieCallback } from "@/lib/kie/types";

export const runtime = "nodejs";

/**
 * Kie.ai posts here when a music task finishes. It expects a 200 within 15
 * seconds, so the heavy work (download, ffmpeg, quality gate) runs after the
 * response. Only the "complete" stage carries final audio.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== env.kieWebhookSecret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as KieCallback | null;
  if (!body?.data?.task_id) return NextResponse.json({ error: "bad payload" }, { status: 400 });

  const taskId = body.data.task_id;
  if (body.code !== 200) {
    after(() => handleTaskResult(taskId, { ok: false, error: body.msg || `provider code ${body.code}` }));
  } else if (body.data.callbackType === "complete" && body.data.data?.length) {
    const tracks = body.data.data;
    after(() => handleTaskResult(taskId, { ok: true, tracks }));
  }
  // "text" and "first" stages: acknowledged, nothing to do yet.
  return NextResponse.json({ status: "received" });
}
