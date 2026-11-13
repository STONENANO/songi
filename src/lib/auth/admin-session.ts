/**
 * Sign-in for the /admin pages, through Supabase Auth (Google by default).
 *
 * Supabase only proves who the person is; access is decided here, by ADMIN_EMAILS.
 * The whole flow runs on the server (PKCE), and the session lives in httpOnly cookies
 * that page scripts can't read. middleware.ts keeps the session fresh on /admin requests.
 *
 * Without SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY: open locally (as before), closed in production.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "../env";

export type AdminSession =
  | { state: "ok"; email: string }
  | { state: "open" } // local dev without sign-in configured
  | { state: "signed_out" }
  | { state: "forbidden"; email: string }
  | { state: "closed" }; // production without sign-in configured

/** Session cookies: httpOnly (no page script can read them), sent over HTTPS only in production. */
export const ADMIN_COOKIE_OPTIONS: CookieOptions = { httpOnly: true, sameSite: "lax", secure: env.isProd, path: "/" };

export function isAdminEmail(email: string | null | undefined, allowed = env.adminEmails): boolean {
  return !!email && allowed.includes(email.trim().toLowerCase());
}

type CookieJar = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};

export function supabaseFor(jar: CookieJar) {
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: ADMIN_COOKIE_OPTIONS,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, { ...c.options, ...ADMIN_COOKIE_OPTIONS });
        } catch {
          // Pages can't set cookies; middleware.ts refreshes the session before the page renders.
        }
      },
    },
  });
}

/** A Supabase client using this request's cookies (pages and route handlers). */
export async function supabaseServer() {
  const jar = await cookies();
  return supabaseFor({ getAll: () => jar.getAll(), set: (n, v, o) => jar.set(n, v, o) });
}

export async function getAdminSession(): Promise<AdminSession> {
  if (!env.adminLoginConfigured) return env.isProd ? { state: "closed" } : { state: "open" };
  const supabase = await supabaseServer();
  // getUser() asks Supabase to verify the session, so a forged or revoked cookie doesn't pass.
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;
  if (!user) return { state: "signed_out" };
  const email = user.email ?? "";
  // The provider must have confirmed the address, or anyone could claim an allowed email.
  if (!user.email_confirmed_at || !isAdminEmail(email)) return { state: "forbidden", email };
  return { state: "ok", email };
}

/** For /admin pages: the signed-in admin's email (null in open local dev), or off to the sign-in page. */
export async function requireAdmin(): Promise<{ email: string | null }> {
  const s = await getAdminSession();
  if (s.state === "ok") return { email: s.email };
  if (s.state === "open") return { email: null };
  if (s.state === "closed") notFound();
  redirect("/admin/login");
}
