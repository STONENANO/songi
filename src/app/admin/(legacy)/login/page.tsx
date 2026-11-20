import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin-session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDER = { google: "Google", github: "GitHub" } as const;

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  const s = await getAdminSession();
  if (s.state === "closed") notFound();
  if (s.state === "ok" || s.state === "open") redirect("/admin");
  const provider = env.adminAuthProvider;

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
      ) : sent ? (
        <>
          <p>If that address has access, a sign-in link is on its way.</p>
          <p><strong>Open it on this device, in this browser.</strong> The link won&apos;t work anywhere else.</p>
          <p className="muted">
            Nothing after a few minutes? Check spam, or <a href="/admin/login">try again</a>.
          </p>
        </>
      ) : (
        <>
          {error === "limit" && <p className="err">Too many tries. Please wait a while and try again.</p>}
          {error && error !== "limit" && <p className="err">Sign-in didn&apos;t complete. Please try again.</p>}
          <form method="post" action="/admin/login/start">
            {provider === "email" ? (
              <>
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" autoComplete="email" required />
                <p>
                  <button className="btn" type="submit">Email me a sign-in link</button>
                </p>
              </>
            ) : (
              <button className="btn" type="submit">Continue with {PROVIDER[provider]}</button>
            )}
          </form>
        </>
      )}
    </div>
  );
}
