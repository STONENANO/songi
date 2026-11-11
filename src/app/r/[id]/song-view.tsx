"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestView } from "@/lib/pipeline/view";

const WORKING = new Set(["draft", "briefing", "writing_lyrics", "generating", "processing"]);

const STATUS_COPY: Record<string, string> = {
  draft: "Getting started…",
  briefing: "Reading your story and pulling out the details that matter…",
  needs_input: "One or two quick questions",
  writing_lyrics: "Writing the lyrics and checking every line against your story…",
  lyrics_ready: "Your lyrics are ready",
  generating: "Recording your versions. This usually takes two to four minutes.",
  processing: "Mastering and checking each recording…",
  preview_ready: "Your song is ready to hear",
  purchased: "Your song is yours",
  failed: "Something went wrong",
};

function fmt(sec: number | null) {
  if (!sec && sec !== 0) return "";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

export default function SongView({ id }: { id: string }) {
  const [view, setView] = useState<RequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const played = useRef(new Set<string>());

  const load = useCallback(async () => {
    const res = await fetch(`/api/requests/${id}${typeof window !== "undefined" ? window.location.search : ""}`, { cache: "no-store" });
    if (!res.ok) {
      setError(res.status === 403 ? "This song belongs to a different browser. Open it from the device you created it on." : "This song request could not be found.");
      return;
    }
    setView(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingOrder = view?.order?.status === "pending";
  useEffect(() => {
    if (!view || !(WORKING.has(view.status) || pendingOrder)) return;
    const t = setInterval(load, pendingOrder ? 4000 : 3000);
    return () => clearInterval(t);
  }, [view, load, pendingOrder]);

  async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/requests/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) setError((json.error as string) ?? "Request failed");
    setBusy(false);
    await load();
    return res.ok ? json : null;
  }

  function track(type: "preview_play" | "preview_complete", versionId: string, position: number) {
    const key = `${type}:${versionId}`;
    if (played.current.has(key)) return;
    played.current.add(key);
    fetch(`/api/requests/${id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, versionId, position }) }).catch(() => {});
  }

  async function buy(versionId: string) {
    const j = await post("/checkout", { versionId });
    if (j?.checkoutUrl) window.location.href = j.checkoutUrl as string;
  }

  if (error && !view) return <p className="err">{error}</p>;
  if (!view) return (
    <p>
      <span className="spinner" />
      Loading…
    </p>
  );

  const draft = view.draft;
  const working = WORKING.has(view.status);
  const showGallery = (view.status === "preview_ready" || view.status === "purchased") && view.candidates.length > 0;
  const selected = view.candidates.find((c) => c.selected) ?? null;
  const paid = view.order?.status === "paid";

  return (
    <div>
      {view.mock.banner && (view.mock.llm || view.mock.kie || view.mock.shopify) && (
        <div className="banner">
          Test mode:{" "}
          {[view.mock.llm && "placeholder lyrics", view.mock.kie && "test-tone audio", view.mock.shopify && "test checkout"].filter(Boolean).join(", ")}. Add API keys in .env for real songs and payments.
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
          <p className="err" style={{ marginTop: 0 }}>{view.lastError}</p>
          {draft?.singable && view.generation.canRequestMore && (
            <button className="btn" disabled={busy} onClick={() => post("/generate", {})}>
              Try recording again
            </button>
          )}
        </div>
      )}

      {view.status === "needs_input" && (
        <div className="card">
          <p className="muted">Your story is a great start. A couple of specific details will make the song unmistakably about them.</p>
          {view.followUpQuestions.map((q, i) => (
            <div key={q}>
              <label htmlFor={`fq-${i}`}>{q}</label>
              <textarea id={`fq-${i}`} style={{ minHeight: 80 }} value={answers[q] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))} />
            </div>
          ))}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" disabled={busy || view.followUpQuestions.some((q) => !(answers[q] ?? "").trim())} onClick={() => post("/answers", { answers })}>
              Continue
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => post("/answers", { answers: Object.fromEntries(view.followUpQuestions.map((q) => [q, "(skipped)"])) })}>
              Skip
            </button>
          </div>
        </div>
      )}

      {(view.status === "generating" || view.status === "processing") && (
        <div className="card">
          <p style={{ margin: 0 }}>
            Recording {view.generation.desired} versions of your song in different styles. {view.generation.usable > 0 ? `${view.generation.usable} ready so far.` : ""}
          </p>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Every recording is checked before you hear it. You can leave this page open or come back later.</p>
        </div>
      )}

      {showGallery && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{view.candidates.length > 1 ? `${view.candidates.length} versions. Pick the one that gives you chills.` : "Here is your version."}</h2>
          <div className="grid2" role="radiogroup" aria-label="Song versions">
            {view.candidates.map((c) => (
              <div key={c.id} className={`version ${c.selected ? "on" : ""}`}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>{c.label}</b>
                  {c.runtimeSec ? <span className="tag">{fmt(c.runtimeSec)}</span> : null}
                </div>
                {c.description && <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{c.description}</p>}
                {c.purchaseStatus === "paid" && c.downloadUrl ? (
                  <audio controls preload="metadata" src={c.downloadUrl} />
                ) : c.previewUrl ? (
                  <audio
                    controls
                    preload="none"
                    src={c.previewUrl}
                    aria-label={`${c.label} preview`}
                    onPlay={() => track("preview_play", c.id, view.candidates.indexOf(c))}
                    onEnded={() => track("preview_complete", c.id, view.candidates.indexOf(c))}
                  />
                ) : null}
                {!paid && (
                  <button
                    role="radio"
                    aria-checked={c.selected}
                    className={`btn ${c.selected ? "" : "secondary"}`}
                    style={{ marginTop: 10, width: "100%" }}
                    disabled={busy}
                    onClick={() => post("/select", { versionId: c.id })}
                  >
                    {c.selected ? "Selected" : "Choose this version"}
                  </button>
                )}
                {c.purchaseStatus === "paid" && <span className="tag ok" style={{ marginTop: 8, display: "inline-block" }}>Purchased</span>}
              </div>
            ))}
          </div>
          {view.rejectedCount > 0 && (
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
              {view.rejectedCount} recording{view.rejectedCount > 1 ? "s" : ""} did not pass our quality checks and {view.rejectedCount > 1 ? "were" : "was"} discarded.
            </p>
          )}

          {!paid && (
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" disabled={busy || !selected || pendingOrder} onClick={() => selected && buy(selected.id)}>
                {selected ? `Get the full song · ${view.priceLabel}` : "Choose a version first"}
              </button>
              {view.generation.canRequestMore && (
                <button className="btn secondary" disabled={busy} onClick={() => post("/generate", { more: true })}>
                  Hear another take
                </button>
              )}
            </div>
          )}
          {pendingOrder && (
            <p className="muted" style={{ marginBottom: 0 }}>
              <span className="spinner" />
              Waiting for payment confirmation. This page updates on its own once your payment is confirmed.
            </p>
          )}
          {view.order?.status === "paid_unfulfilled" && <p className="err">Your payment went through but we couldn't prepare the file. Our team has been notified and will deliver it.</p>}
          {paid && (
            <div style={{ marginTop: 12 }}>
              {view.candidates
                .filter((c) => c.purchaseStatus === "paid" && c.downloadUrl)
                .map((c) => (
                  <a key={c.id} className="btn" href={c.downloadUrl!} style={{ textDecoration: "none", marginRight: 8 }}>
                    Download MP3
                  </a>
                ))}
              {view.order?.deliveryLink && (
                <p className="muted" style={{ fontSize: 13 }}>
                  Your permanent link: <a href={view.order.deliveryLink}>{typeof window !== "undefined" ? window.location.origin : ""}{view.order.deliveryLink}</a>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {showGallery && <FeedbackCard id={id} versionId={selected?.id ?? null} given={view.feedback} />}

      {view.brief && view.status !== "needs_input" && (
        <div className="card">
          <p style={{ margin: 0 }}>{view.brief.summary}</p>
          {view.brief.facts.length > 0 && (
            <div className="chips" style={{ marginTop: 12 }}>
              {view.brief.facts.map((f) => (
                <span key={f.id} className="chip" style={{ cursor: "default" }} title={f.sourceQuote ? `From your words: "${f.sourceQuote}"` : f.type}>
                  {f.text}
                </span>
              ))}
            </div>
          )}
          {view.brief.contradictions.length > 0 && (
            <p className="muted" style={{ fontSize: 13 }}>We noticed something that may conflict ({view.brief.contradictions[0].issue}) and kept it out of the lyrics.</p>
          )}
        </div>
      )}

      {draft && view.status !== "needs_input" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{draft.title}</h2>
            <span>
              <span className="tag">draft {draft.version}</span>
              {draft.singable ? <span className="tag ok">checked</span> : <span className="tag bad">needs changes</span>}
            </span>
          </div>
          {!draft.singable && draft.blockingIssues.length > 0 && (
            <ul className="err" style={{ fontSize: 14 }}>
              {draft.blockingIssues.map((i, k) => (
                <li key={k}>
                  {i.section ? `${i.section}: ` : ""}
                  {i.reason}
                </li>
              ))}
            </ul>
          )}
          {!editing ? (
            <div className="lyrics" style={{ marginTop: 12 }}>
              {draft.displayLyrics}
            </div>
          ) : (
            <>
              <label htmlFor="edit-lyrics" className="muted" style={{ fontWeight: 400 }}>Keep the section tags like [Chorus]. We check your edits before anything is sung.</label>
              <textarea id="edit-lyrics" style={{ minHeight: 360, marginTop: 8, fontFamily: "Georgia, serif" }} value={editText} onChange={(e) => setEditText(e.target.value)} />
            </>
          )}
          {["lyrics_ready", "preview_ready", "failed"].includes(view.status) && !paid && (
            <div className="row" style={{ marginTop: 16 }}>
              {!editing ? (
                <>
                  {view.status === "lyrics_ready" && (
                    <button className="btn" disabled={busy || !draft.singable} title={draft.singable ? "" : "Fix the issues above first"} onClick={() => post("/generate", { draftId: draft.id })}>
                      Sing it
                    </button>
                  )}
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
                      if (await post("/lyrics", { action: "edit", text: editText })) setEditing(false);
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
          {draft.singable && draft.warnings.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>Editor notes ({draft.warnings.length})</summary>
              <ul className="muted" style={{ fontSize: 13 }}>
                {draft.warnings.map((w, k) => (
                  <li key={k}>
                    {w.section ? `${w.section}: ` : ""}
                    {w.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && <p className="err">{error}</p>}
      <p className="muted" style={{ fontSize: 12, marginTop: 32 }}>Request {view.id}</p>
    </div>
  );
}

const RATINGS = [
  { n: 1, label: "Not for me" },
  { n: 2, label: "Meh" },
  { n: 3, label: "Nice" },
  { n: 4, label: "Loved it" },
  { n: 5, label: "Gave me chills" },
];

/** MVP test feedback: how the song landed, and whether the tester would pay for it. */
function FeedbackCard({ id, versionId, given }: { id: string; versionId: string | null; given: RequestView["feedback"] }) {
  const [rating, setRating] = useState<number | null>(given?.rating ?? null);
  const [wouldPay, setWouldPay] = useState<"yes" | "maybe" | "no" | null>(given?.wouldPay ?? null);
  const [note, setNote] = useState(given?.note ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(given ? "sent" : "idle");

  async function send() {
    if (!rating) return;
    setState("sending");
    const res = await fetch(`/api/requests/${id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, wouldPay, note, versionId }) });
    setState(res.ok ? "sent" : "error");
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>How did it land?</h2>
      <p className="muted" style={{ marginTop: 0 }}>We're testing this. Your honest reaction helps more than anything.</p>
      <div className="chips">
        {RATINGS.map((r) => (
          <button key={r.n} type="button" className={`chip ${rating === r.n ? "on" : ""}`} onClick={() => { setRating(r.n); setState("idle"); }} aria-pressed={rating === r.n}>
            {r.label}
          </button>
        ))}
      </div>
      <p style={{ marginBottom: 6 }}>Would you pay $45 for this as a gift?</p>
      <div className="chips">
        {(["yes", "maybe", "no"] as const).map((w) => (
          <button key={w} type="button" className={`chip ${wouldPay === w ? "on" : ""}`} onClick={() => { setWouldPay(w); setState("idle"); }} aria-pressed={wouldPay === w}>
            {w === "yes" ? "Yes" : w === "maybe" ? "Maybe" : "No"}
          </button>
        ))}
      </div>
      <textarea
        style={{ marginTop: 12, minHeight: 80 }}
        rows={3}
        placeholder="Anything that felt off, or a line you loved? (optional)"
        value={note}
        onChange={(e) => { setNote(e.target.value); setState("idle"); }}
      />
      <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
        <button className="btn" disabled={!rating || state === "sending" || state === "sent"} onClick={send}>
          {state === "sent" ? "Thanks, saved" : state === "sending" ? "Saving…" : "Send feedback"}
        </button>
        {state === "error" && <span className="err">Couldn't save that. Try again.</span>}
      </div>
    </div>
  );
}
