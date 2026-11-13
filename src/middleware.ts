/**
 * Keeps the /admin sign-in fresh: Supabase access tokens last an hour, and only middleware
 * (not a page) can write the refreshed cookies. Runs on /admin only.
 *
 * The refreshed cookies go both to the browser (response) and to this same request, so the
 * page sees the new session instead of refreshing again with the already-used refresh token.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ADMIN_COOKIE_OPTIONS } from "@/lib/auth/admin-session";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  if (!env.adminLoginConfigured) return res;
  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: ADMIN_COOKIE_OPTIONS,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of list) res.cookies.set(c.name, c.value, { ...c.options, ...ADMIN_COOKIE_OPTIONS });
      },
    },
  });
  await supabase.auth.getUser().catch(() => null);
  return res;
}

export const config = { matcher: ["/admin/:path*"], runtime: "nodejs" };
