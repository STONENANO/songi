import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/auth/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The provider sends the person back here with a one-time code; swap it for a session cookie. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  const login = new URL("/admin/login", env.appUrl);
  if (!env.adminLoginConfigured || !code) {
    login.searchParams.set("error", "callback");
    return NextResponse.redirect(login, 303);
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn("[admin-login] code exchange failed:", error.message);
    login.searchParams.set("error", "callback");
    return NextResponse.redirect(login, 303);
  }
  // /admin decides whether this account is allowed in (and sends anyone else back to the sign-in page).
  return NextResponse.redirect(new URL("/admin", env.appUrl), 303);
}
