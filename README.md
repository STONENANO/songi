# Custom Song Studio: backend MVP

A personalised gift-song pipeline. A short quiz becomes a structured brief, the brief becomes verified lyrics, the lyrics become a Suno track through Kie.ai, and the track is quality-checked and cut into a chorus-first preview that the buyer can hear.

This is the backend plus a plain quiz and song page. Marketing pages, pricing, checkout, and email come later and plug in at the `preview_ready` state.

## Run it in two minutes

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no API keys the app runs in **mock mode**: lyrics are placeholder text and audio is a test tone, but every state transition, the database, ffmpeg processing, the quality gate, and the preview cut are real. Use this to develop the UI and the pipeline without spending credits.

To generate real songs, set two keys in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
KIE_API_KEY=...
```

Kie.ai calls your server back when a song is ready. Locally, either expose the app with a tunnel and set `APP_URL` to it, or do nothing: the song page polls Kie.ai every 8 seconds while a song is generating, so callbacks are an optimisation, not a requirement.

Useful scripts:

| Command | What it does |
|---|---|
| `npm run smoke` | Drives one request through the entire pipeline from a script and prints the result. Mock mode costs nothing; real mode costs one Suno request. |
| `npm run golden` | Runs brief extraction, lyrics, and the verifier over the six briefs in `scripts/golden/` and prints a scorecard. Run it every time a prompt or registry entry changes. Output lands in `data/golden-out/`. |
| `npm run typecheck` | TypeScript check. |

## How a request moves

```
draft → briefing → (needs_input) → writing_lyrics → lyrics_ready
      → generating → processing → preview_ready | failed
```

1. **Quiz** (`/create`). Four steps: who and occasion, story, sound, email. Posts to `POST /api/requests`.
2. **Briefing** (`src/lib/songcraft/brief.ts`). Claude turns the raw story into a structured brief: name, phonetic respelling if needed, pronouns, typed and prioritised facts, tone, must-include phrases, an avoid list, and a one-line summary. If the story has fewer than three usable facts it returns up to two follow-up questions and the request pauses at `needs_input`. Lyrics are always written from the brief, never the raw text, which is the main defence against invented details.
3. **Lyrics** (`src/lib/songcraft/lyrics.ts`). The lyricist writes to the genre's blueprint (section order, line counts, syllable range). A separate verifier call checks the draft against the brief for fact coverage, invented details, the name in the chorus, avoid-list violations, and singability. If it fails, one repair pass runs and the better draft is kept. Each draft stores two texts: the display lyrics the buyer reads and the sung lyrics Suno receives, where unusual names are respelled phonetically and digits are spelled out. The buyer can regenerate or edit lines; edits are re-verified.
4. **Generation** (`src/lib/songcraft/style.ts`, `src/lib/kie/client.ts`). The Suno request is assembled from the genre registry, never from free text. Customer style notes are stripped of artist references first. Kie.ai returns two clips per request.
5. **Processing** (`src/lib/pipeline/run.ts`, `src/lib/audio/*`). Each clip is downloaded, loudness-normalised, and checked: timestamped lyrics from Kie.ai are compared against the sung lyrics for coverage, and duration is checked for truncation. Failing clips are rejected. The preview is cut to start just before the first chorus that sings the recipient's name. If both clips fail, generation retries automatically up to `MAX_GENERATION_ATTEMPTS`.
6. **Song page** (`/r/<id>`). Polls `GET /api/requests/<id>` every three seconds and renders the right view for the state: follow-up questions, lyrics with actions, generating, or two preview players.

## Project layout

```
src/app/                      Next.js pages and API routes
  create/                     the quiz
  r/[id]/                     the song page
  api/requests/...            create, status, answers, lyrics actions, generate
  api/webhooks/kie            Kie.ai callback (shared secret in the URL)
  api/audio/[...path]         serves stored audio with Range support
src/lib/songcraft/            the product: brief, lyrics, verifier, registry, sanitizer, Suno request builder
src/lib/pipeline/run.ts       the state machine; every function is idempotent
src/lib/kie/                  Kie.ai client (+ mock)
src/lib/audio/                ffmpeg wrapper, preview selection, quality gate
src/lib/storage/              local disk or S3/R2 behind one interface
src/lib/db/                   Drizzle schema, SQL migrations, Postgres or embedded PGlite
scripts/                      smoke test, golden set runner
```

## Configuration

See `.env.example`. Notable:

- `DATABASE_URL` empty uses embedded PGlite in `./data`. Set a Postgres URL (Supabase, Railway) for anything shared.
- `STORAGE_DRIVER=s3` with the `S3_*` variables uses Cloudflare R2 or S3 for audio. Default writes to `./storage`.
- `KIE_WEBHOOK_SECRET` is appended to the callback URL so random POSTs are rejected. Kie.ai also documents webhook signature verification; add it before launch.
- `PREVIEW_SECONDS`, `MIN_LYRIC_COVERAGE`, `MAX_GENERATION_ATTEMPTS` tune the preview and quality gate.
- `REGISTRY_VERSION` in `src/lib/songcraft/registry.ts` is recorded on every generation. Bump it when you change a style string or blueprint so you can compare purchase rates across versions later.

## Suno constraints handled

- No artist names reach Suno. Style text comes from the registry; customer free text passes through `stripArtistReferences`.
- Character limits are clamped to the documented V6 limits (style 1000, lyrics 5000, title 80).
- Lyrics use Suno section tags, and the verifier flags digits, abbreviations, and tongue twisters.
- Profanity is blocked locally and by the verifier.
- `vocal_gender` is a preference, not a guarantee, per Kie.ai's docs. The quality gate does not check it; a future improvement is a pitch heuristic.

## What is intentionally not here yet

Payments, pricing tiers, the gift page, email and SMS, abuse limits beyond the per-request generation cap, Gift Set deliverables (second style, instrumental, lyric video, poster), account login, and marketing pages. The pipeline ends at `preview_ready`; the full-song file is already stored at `requests/<id>/versions/<vid>/full.mp3` and is simply not exposed.
