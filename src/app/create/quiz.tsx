"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  genres: { key: string; label: string; tagline: string }[];
  moods: string[];
  occasions: string[];
  relationships: string[];
};

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function Quiz({ genres, moods, occasions, relationships }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    recipientName: "",
    pronunciation: "",
    relationship: "",
    occasion: "",
    story: "",
    genreKey: "",
    vocalGender: "any" as "m" | "f" | "any",
    mood: "",
    customStyle: "",
    email: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const steps = [
    { title: "Who is this song for?", valid: form.relationship && form.occasion },
    { title: "Tell us about them", valid: form.story.trim().length >= 10 },
    { title: "Pick the sound", valid: !!form.genreKey },
    { title: "Where should we send it?", valid: true },
  ];

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Something went wrong");
      setBusy(false);
      return;
    }
    router.push(`/r/${json.id}`);
  }

  return (
    <div>
      <p className="muted" style={{ margin: 0 }}>
        Step {step + 1} of {steps.length} · about 2 minutes · free preview before you decide
      </p>
      <h1>{steps[step].title}</h1>
      <div className="progress">
        <div style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
      </div>

      {step === 0 && (
        <div className="card">
          <label>Their first name (optional)</label>
          <input type="text" value={form.recipientName} onChange={(e) => set("recipientName", e.target.value)} placeholder="Linda" maxLength={60} />
          <p className="muted" style={{ fontSize: 13 }}>Songs with a name in the chorus feel twice as personal.</p>
          {form.recipientName.trim().length > 0 && (
            <>
              <label>How do you say it? (only if it is unusual)</label>
              <input type="text" value={form.pronunciation} onChange={(e) => set("pronunciation", e.target.value)} placeholder="e.g. Shiv-awn for Siobhan" maxLength={60} />
            </>
          )}
          <label>Who are they to you?</label>
          <div className="chips">
            {relationships.map((r) => (
              <button key={r} type="button" className={`chip ${form.relationship === r ? "on" : ""}`} onClick={() => set("relationship", r)}>
                {pretty(r)}
              </button>
            ))}
          </div>
          <label>What is the occasion?</label>
          <div className="chips">
            {occasions.map((o) => (
              <button key={o} type="button" className={`chip ${form.occasion === o ? "on" : ""}`} onClick={() => set("occasion", o)}>
                {pretty(o)}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <p className="muted">
            A few real details beat a long essay. A habit that makes you smile, a place you share, something they always say, a memory only you two have. Plain sentences are perfect.
          </p>
          <label>Your story</label>
          <textarea
            value={form.story}
            onChange={(e) => set("story", e.target.value)}
            maxLength={4000}
            placeholder={`Example: Mom taught me to make pancakes every Sunday. She sings off-key in the car on every road trip and does not care. Her happy place is the lake house in Michigan. She is turning 60 and still beats everyone at cards.`}
          />
          <p className="muted" style={{ fontSize: 13 }}>{form.story.trim().length} characters. If we need one more detail, we will ask.</p>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <label>Genre</label>
          <div className="chips">
            {genres.map((g) => (
              <button key={g.key} type="button" className={`chip ${form.genreKey === g.key ? "on" : ""}`} onClick={() => set("genreKey", g.key)}>
                {g.label}
                <small>{g.tagline}</small>
              </button>
            ))}
          </div>
          <label>Voice</label>
          <div className="chips">
            {(["f", "m", "any"] as const).map((v) => (
              <button key={v} type="button" className={`chip ${form.vocalGender === v ? "on" : ""}`} onClick={() => set("vocalGender", v)}>
                {v === "f" ? "Female" : v === "m" ? "Male" : "Surprise me"}
              </button>
            ))}
          </div>
          <label>Mood (optional)</label>
          <div className="chips">
            {moods.map((m) => (
              <button key={m} type="button" className={`chip ${form.mood === m ? "on" : ""}`} onClick={() => set("mood", form.mood === m ? "" : m)}>
                {pretty(m)}
              </button>
            ))}
          </div>
          <label>Anything about the sound? (optional)</label>
          <input type="text" value={form.customStyle} onChange={(e) => set("customStyle", e.target.value)} placeholder="e.g. a slow build, whistling, a big gospel choir at the end" maxLength={300} />
          <p className="muted" style={{ fontSize: 13 }}>Describe sounds, not artists. Artist names are removed automatically.</p>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <label>Email (optional for now)</label>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" />
          <p className="muted" style={{ fontSize: 13 }}>Your song takes a couple of minutes. We will keep the page updating; the email is a backup link.</p>
          <h2>Summary</h2>
          <p>
            A <b>{genres.find((g) => g.key === form.genreKey)?.label}</b> song for <b>{form.recipientName || pretty(form.relationship)}</b> ({pretty(form.relationship)}) for{" "}
            <b>{pretty(form.occasion)}</b>
            {form.mood ? <> with a <b>{form.mood}</b> mood</> : null}.
          </p>
        </div>
      )}

      {error && <p className="err">{error}</p>}
      <div className="row">
        {step > 0 && (
          <button type="button" className="btn secondary" onClick={() => setStep(step - 1)} disabled={busy}>
            Back
          </button>
        )}
        {step < steps.length - 1 ? (
          <button type="button" className="btn" disabled={!steps[step].valid} onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={submit}>
            {busy ? "Starting…" : "Write my song"}
          </button>
        )}
      </div>
    </div>
  );
}
