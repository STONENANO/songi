import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/auth/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign out: ends the Supabase session and clears the cookies. POST only, so a link can't sign you out. */
export async function POST() {
  if (env.adminLoginConfigured) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut().catch(() => {});
  }
  return NextResponse.redirect(new URL("/admin/login", env.appUrl), 303);
}
