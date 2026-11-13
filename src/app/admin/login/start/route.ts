import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/auth/admin-session";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts the Google (or GitHub) sign-in. The PKCE verifier is kept in an httpOnly cookie. */
export async function POST(req: Request) {
  const login = new URL("/admin/login", env.appUrl);
  if (!env.adminLoginConfigured || !(await rateLimit(`admin-login:${clientIp(req)}`, 30, 60 * 60_000))) return NextResponse.redirect(login, 303);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: env.adminAuthProvider,
    options: { redirectTo: new URL("/admin/auth/callback", env.appUrl).toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    console.warn("[admin-login] could not start sign-in:", error?.message ?? "no url");
    login.searchParams.set("error", "start");
    return NextResponse.redirect(login, 303);
  }
  return NextResponse.redirect(data.url, 303);
}
