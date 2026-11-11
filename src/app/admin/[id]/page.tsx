import Link from "next/link";
import { notFound } from "next/navigation";
import { adminAllowed, adminDetail } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminSong({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  if (!adminAllowed(token)) notFound();
  const d = await adminDetail(id);
  if (!d) notFound();
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const r = d.request;

  return (
    <div className="admin">
      <p><Link href={`/admin${q}`}>← All test songs</Link></p>
      <h1>{d.draft?.title ?? "(no lyrics yet)"}</h1>
      <p className="muted">
        For {r.recipient ?? "(no name)"}{r.pronunciation ? ` (say "${r.pronunciation}")` : ""} · {r.relationship} · {r.occasion.replace(/_/g, " ")} · {r.genre} · {r.vocal} vocal{r.mood ? ` · ${r.mood}` : ""} · status {r.status}
      </p>
      {r.lastError && <p className="err">{r.lastError}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Feedback</h2>
        {d.feedback.length === 0 && <p className="muted">None yet.</p>}
        {d.feedback.map((f) => (
          <p key={f.id}>
            <strong>{f.rating} / 5</strong> · would pay: {f.wouldPay ?? "-"} · {new Date(f.createdAt).toLocaleString()}
            {f.note && <><br />{f.note}</>}
          </p>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Takes</h2>
        {d.takes.length === 0 && <p className="muted">No recordings yet.</p>}
        {d.takes.map((t) => (
          <div key={t.id} style={{ marginBottom: 16 }}>
            <strong>{t.label}</strong> · {t.status}{t.offered ? " · offered" : ""}{t.selected ? " · chosen" : ""}{t.paid ? " · paid" : ""}{t.duration ? ` · ${Math.round(t.duration)}s` : ""}
            {t.style && <div className="muted">{t.style}</div>}
            {t.audioUrl && <audio controls preload="none" src={t.audioUrl} style={{ width: "100%", marginTop: 6 }} />}
          </div>
        ))}
        <p className="muted">Kie tasks: {d.cost.kieTasks} · est. Kie ${d.cost.kieUsd.toFixed(2)} · est. Claude ${d.cost.llmUsd.toFixed(2)}</p>
      </div>

      {d.draft && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Lyrics</h2>
          <p className="muted">
            {d.draft.status} · score {d.draft.score?.toFixed(2) ?? "-"} · {d.draft.promptVersion} · {d.draft.arrangement} · {d.draftsWritten} draft(s) written
          </p>
          <pre className="lyrics">{d.draft.lyrics}</pre>
          {d.draft.issues.length > 0 && (
            <>
              <h3>Checker notes</h3>
              <ul>{d.draft.issues.map((i, k) => <li key={k}>[{i.severity}] {i.section ? `${i.section}: ` : ""}{i.reason}</li>)}</ul>
            </>
          )}
          <details>
            <summary>Plan</summary>
            <pre className="lyrics">{JSON.stringify(d.draft.plan, null, 2)}</pre>
          </details>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Story</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{r.story}</p>
        {r.followUps && Object.keys(r.followUps).length > 0 && (
          <ul>{Object.entries(r.followUps).map(([k, v]) => <li key={k}>{k} {v}</li>)}</ul>
        )}
        {d.brief && (
          <>
            <h3>Brief</h3>
            <p>{d.brief.summary}</p>
            <ul>{d.brief.facts.map((f) => <li key={f.id}>{f.text} (priority {f.priority})</li>)}</ul>
          </>
        )}
      </div>

      <details className="card">
        <summary>Event log</summary>
        <ul>{d.events.map((e, k) => <li key={k}><code>{new Date(e.at).toLocaleTimeString()} {e.type}</code></li>)}</ul>
      </details>
    </div>
  );
}
