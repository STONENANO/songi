import { NextResponse } from "next/server";
import { adminAllowed } from "@/lib/admin";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only: the visitor IP the rate limits use for this request, and the headers it came from.
 *
 * Use it to check that the IP header can't be forged on your host. Send two requests:
 *   curl -s -H "x-admin-token: $ADMIN_TOKEN" https://<site>/api/admin/ip
 *   curl -s -H "x-admin-token: $ADMIN_TOKEN" -H "X-Real-IP: 203.0.113.7" -H "X-Forwarded-For: 203.0.113.8" https://<site>/api/admin/ip
 * If the second answer's clientIp is 203.0.113.7 or 203.0.113.8, a visitor can choose their own
 * IP and the per-visitor limits can be dodged. If it is your real address both times, they can't.
 *
 * The token goes in the x-admin-token header (kept out of URLs and logs); ?token= also works,
 * like the /admin pages. Anything else gets a 404, as if the route didn't exist.
 */
export async function GET(req: Request) {
  const token = req.headers.get("x-admin-token") ?? new URL(req.url).searchParams.get("token") ?? undefined;
  if (!adminAllowed(token)) {
    // Count failed guesses (the response stays a plain 404 either way).
    await rateLimit(`admin-ip-fail:${clientIp(req)}`, 20, 60 * 60_000);
    return new NextResponse("Not found", { status: 404 });
  }
  const h = req.headers;
  return NextResponse.json(
    {
      clientIp: clientIp(req),
      usedHeader: env.clientIpHeader || "x-forwarded-for (last entry)",
      headers: {
        "x-real-ip": h.get("x-real-ip"),
        "x-forwarded-for": h.get("x-forwarded-for"),
        "cf-connecting-ip": h.get("cf-connecting-ip"),
        "x-railway-edge": h.get("x-railway-edge"),
      },
      howToRead:
        "Repeat this request with a made-up X-Real-IP and X-Forwarded-For. If clientIp becomes the made-up value, visitors can forge their IP. If it stays your real address, they can't.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
