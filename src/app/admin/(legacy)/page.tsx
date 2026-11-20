import Link from "next/link";
import { adminList } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth/admin-session";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAY: Record<string, string> = { yes: "Yes", maybe: "Maybe", no: "No" };

export default async function AdminPage() {
  const { email } = await requireAdmin();
  const rows = await adminList();
  const rated = rows.filter((r) => r.feedback);
  const avg = rated.length ? rated.reduce((s, r) => s + r.feedback!.rating, 0) / rated.length : null;
  const yes = rated.filter((r) => r.feedback!.wouldPay === "yes").length;
  const spend = rows.reduce((s, r) => s + r.llmUsd + r.kieUsd, 0);

  return (
    <div className="admin">
      <AdminNav current="songs" email={email} />
      <h1>Test songs</h1>
      <p className="muted">
        {rows.length} songs · {rated.length} rated{avg !== null ? ` · average ${avg.toFixed(1)} / 5` : ""} · {yes} of {rated.length} would pay · est. spend ${spend.toFixed(2)}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>For</th>
              <th>Song</th>
              <th>Status</th>
              <th>Score</th>
              <th>Chosen take</th>
              <th>Reaction</th>
              <th>Would pay</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  {r.recipient}
                  <div className="muted">{r.relationship} · {r.occasion.replace(/_/g, " ")} · {r.genre}</div>
                </td>
                <td>
                  <Link href={`/admin/${r.id}`}>{r.title ?? "(no lyrics yet)"}</Link>
                  <div className="muted">{r.writer ?? ""}</div>
                </td>
                <td>{r.status}{r.paid ? " · paid" : ""}</td>
                <td>{r.score?.toFixed(2) ?? "-"}</td>
                <td>{r.chosen ?? (r.takes ? `${r.takes} offered` : "-")}</td>
                <td>
                  {r.feedback ? `${r.feedback.rating} / 5` : "-"}
                  {r.feedback?.note && <div className="muted">{r.feedback.note}</div>}
                </td>
                <td>{r.feedback?.wouldPay ? PAY[r.feedback.wouldPay] : "-"}</td>
                <td>${(r.llmUsd + r.kieUsd).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
