import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin-session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDER = { google: "Google", github: "GitHub" } as const;

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const s = await getAdminSession();
  if (s.state === "closed") notFound();
  if (s.state === "ok" || s.state === "open") redirect("/admin");

  return (
    <div className="admin login">
      <h1>Sign in</h1>
      {s.state === "forbidden" ? (
        <>
          <p className="err">{s.email || "This account"} doesn&apos;t have access.</p>
          <form method="post" action="/admin/logout">
            <button className="btn secondary" type="submit">Sign out and use another account</button>
          </form>
        </>
      ) : (
        <>
          {error && <p className="err">Sign-in didn&apos;t complete. Please try again.</p>}
          <form method="post" action="/admin/login/start">
            <button className="btn" type="submit">Continue with {PROVIDER[env.adminAuthProvider]}</button>
          </form>
        </>
      )}
    </div>
  );
}
