"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestView } from "@/lib/pipeline/run";

const WORKING = new Set(["draft", "briefing", "writing_lyrics", "generating", "processing"]);

const STATUS_COPY: Record<string, string> = {
  draft: "Getting started…",
  briefing: "Reading your story and pulling out the details that matter…",
  needs_input: "One or two quick questions",
  writing_lyrics: "Writing the lyrics and checking them against your story…",
  lyrics_ready: "Your lyrics are ready",
  generating: "Recording your song. This usually takes two to three minutes.",
  processing: "Mastering, checking, and cutting your preview…",
  preview_ready: "Your song is ready to hear",
  failed: "Something went wrong",
};

export default function SongView({ id }: { id: string }) {
  const [view, setView] = useState<RequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/requests/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError("This song request could not be found.");
      return;
    }
    setView(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!view || !WORKING.has(view.status)) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [view, load]);

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/requests/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(json.error ?? "Request failed");
    setBusy(false);
    await load();
  }

  if (error && !view) return <p className="err">{error}</p>;
  if (!view) return <p><span className="spinner" />Loading…</p>;

  const draft = view.drafts[0];
  const working = WORKING.has(view.status);
  const readyVersions = view.versions.filter((v) => v.status === "ready");
  const rejected = view.versions.filter((v) => v.status === "rejected");

  return (
    <div>
      {(view.mock.llm || view.mock.kie) && (
        <div className="banner">
          Mock mode: {view.mock.llm ? "lyrics are placeholder text" : ""}{view.mock.llm && view.mock.kie ? " and " : ""}{view.mock.kie ? "audio is a test tone" : ""}. Add API keys in .env to generate real songs.
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        {view.genreLabel} · for {view.recipientName || view.relationship} · {view.occasion.replace(/_/g, " ")}
      </p>
      <h1>
        {working && <span className="spinner" />}
        {STATUS_COPY[view.status] ?? view.status}
      </h1>

      {view.status === "failed" && (
        <div className="card">
          <p className="err">{view.lastError}</p>
          <div className="row">
            {draft && (
              <button className="btn" disabled={busy} onClick={() => post("/generate", {})}>
                Try recording again
              </button>
            )}
          </div>
        </div>
      )}

      {view.status === "needs_input" && (
        <div className="card">
          <p className="muted">Your story is a great start. Two small details will make the song unmistakably about them.</p>
          {view.followUpQuestions.map((q) => (
            <div key={q}>
              <label>{q}</label>
              <textarea style={{ minHeight: 80 }} value={answers[q] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))} />
            </div>
          ))}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" disabled={busy || view.followUpQuestions.some((q) => !(answers[q] ?? "").trim())} onClick={() => post("/answers", { answers })}>
              Continue
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => post("/answers", { answers: Object.fromEntries(view.followUpQuestions.map((q) => [q, "(skipped)"])) })}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {view.brief && view.status !== "needs_input" && (
        <div className="card">
          <p style={{ margin: 0 }}>{view.brief.summary}</p>
          {view.brief.facts.length > 0 && (
            <div className="chips" style={{ marginTop: 12 }}>
              {view.brief.facts.map((f, i) => (
                <span key={i} className="chip" style={{ cursor: "default" }} title={f.type}>
                  {f.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {view.status === "preview_ready" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Two versions. Pick the one that gives you chills.</h2>
          <div className="grid2">
            {readyVersions.map((v, i) => (
              <div key={v.id} className="version">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>Version {String.fromCharCode(65 + i)}</b>
                  <span className="tag ok">preview {Math.round(v.previewStart ?? 0)}s in</span>
                </div>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{v.title}</p>
                {v.previewUrl && <audio controls preload="none" src={v.previewUrl} />}
              </div>
            ))}
          </div>
          {rejected.length > 0 && (
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
              {rejected.length} version{rejected.length > 1 ? "s" : ""} did not pass our quality check and {rejected.length > 1 ? "were" : "was"} discarded automatically.
            </p>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn secondary" disabled={busy || view.generationAttempts >= view.maxGenerationAttempts * 3} onClick={() => post("/generate", {})}>
              Try another take
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              Take {view.generationAttempts}. Full song unlock and checkout come next.
            </span>
          </div>
        </div>
      )}

      {draft && view.status !== "needs_input" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{draft.title}</h2>
            <span>
              <span className="tag">draft {draft.version}</span>
              <VerifierTag report={draft.report} />
            </span>
          </div>
          {!editing ? (
            <div className="lyrics" style={{ marginTop: 12 }}>
              {draft.displayLyrics}
            </div>
          ) : (
            <>
              <textarea style={{ minHeight: 360, marginTop: 12, fontFamily: "Georgia, serif" }} value={editText} onChange={(e) => setEditText(e.target.value)} />
              <p className="muted" style={{ fontSize: 13 }}>Keep the section tags like [Chorus]. We will re-check the words before singing them.</p>
            </>
          )}
          {view.status === "lyrics_ready" && (
            <div className="row" style={{ marginTop: 16 }}>
              {!editing ? (
                <>
                  <button className="btn" disabled={busy} onClick={() => post("/generate", { draftId: draft.id })}>
                    Sing it
                  </button>
                  <button className="btn secondary" disabled={busy} onClick={() => post("/lyrics", { action: "regenerate" })}>
                    New lyrics
                  </button>
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditText(draft.displayLyrics);
                      setEditing(true);
                    }}
                  >
                    Edit lines
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={async () => {
                      await post("/lyrics", { action: "edit", text: editText });
                      setEditing(false);
                    }}
                  >
                    Save edits
                  </button>
                  <button className="btn secondary" disabled={busy} onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
          <VerifierDetails report={draft.report} />
        </div>
      )}

      {error && <p className="err">{error}</p>}
      <p className="muted" style={{ fontSize: 12, marginTop: 32 }}>Request {view.id}</p>
    </div>
  );
}

type Report = { pass?: boolean; issues?: { severity: string; message: string }[]; inventedDetails?: string[] } | null | undefined;

function VerifierTag({ report }: { report: unknown }) {
  const r = report as Report;
  if (!r) return null;
  const errors = (r.issues ?? []).filter((i) => i.severity === "error").length + (r.inventedDetails?.length ?? 0);
  const warnings = (r.issues ?? []).filter((i) => i.severity === "warning").length;
  if (errors) return <span className="tag bad">{errors} issue{errors > 1 ? "s" : ""}</span>;
  if (warnings) return <span className="tag warn">{warnings} note{warnings > 1 ? "s" : ""}</span>;
  return <span className="tag ok">checked</span>;
}

function VerifierDetails({ report }: { report: unknown }) {
  const r = report as Report;
  const items = [...(r?.issues ?? []).map((i) => `${i.severity === "error" ? "Issue" : "Note"}: ${i.message}`), ...(r?.inventedDetails ?? []).map((d) => `Not from your story: ${d}`)];
  if (!items.length) return null;
  return (
    <ul className="muted" style={{ fontSize: 13, marginTop: 12 }}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}
