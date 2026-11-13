import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isAdminEmail, supabaseServer } from "@/lib/auth/admin-session";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts sign-in. The PKCE verifier is kept in an httpOnly cookie, so the emailed link or
 * provider redirect only works in the browser that asked for it.
 * - email: Supabase emails a one-time link, only to addresses in ADMIN_EMAILS. The answer is
 *   the same either way, so the page never reveals which addresses have access.
 * - google / github: off to the provider.
 */
export async function POST(req: Request) {
  const login = new URL("/admin/login", env.appUrl);
  if (!env.adminLoginConfigured || !(await rateLimit(`admin-login:${clientIp(req)}`, 10, 60 * 60_000))) {
    login.searchParams.set("error", "limit");
    return NextResponse.redirect(login, 303);
  }
  const supabase = await supabaseServer();
  const redirectTo = new URL("/admin/auth/callback", env.appUrl).toString();

  if (env.adminAuthProvider === "email") {
    const form = await req.formData().catch(() => null);
    const email = String(form?.get("email") ?? "").trim().toLowerCase().slice(0, 200);
    if (isAdminEmail(email)) {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
      if (error) console.warn("[admin-login] could not send the sign-in link:", error.message);
    }
    login.searchParams.set("sent", "1");
    return NextResponse.redirect(login, 303);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({ provider: env.adminAuthProvider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) {
    console.warn("[admin-login] could not start sign-in:", error?.message ?? "no url");
    login.searchParams.set("error", "start");
    return NextResponse.redirect(login, 303);
  }
  return NextResponse.redirect(data.url, 303);
}
