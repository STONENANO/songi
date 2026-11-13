import Link from "next/link";

/** Top of every admin page: the two tabs, who is signed in, and sign out. */
export function AdminNav({ current, email }: { current: "songs" | "numbers" | null; email: string | null }) {
  const tab = (key: "songs" | "numbers", href: string, label: string) => (current === key ? <strong>{label}</strong> : <Link href={href}>{label}</Link>);
  return (
    <div className="admin-nav muted">
      <span>
        {tab("songs", "/admin", "Songs")} · {tab("numbers", "/admin/numbers", "Numbers")}
      </span>
      {email && (
        <form method="post" action="/admin/logout">
          <span>{email}</span>{" "}
          <button className="linkish" type="submit">Sign out</button>
        </form>
      )}
    </div>
  );
}
