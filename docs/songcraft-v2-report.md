# Songcraft v2: implementation report

Status: implemented and tested in mock mode. Nothing in this report was verified against the real Claude, Kie.ai or Shopify APIs, because no credentials were available in the build environment. Every claim about songwriting quality is a design intent until the golden suite and human listening tests run with real keys.

## 0. What existed before (discovery map)

| Area | Before v2 |
|---|---|
| Request states | draft, briefing, needs_input, writing_lyrics, lyrics_ready, generating, processing, preview_ready, failed |
| Kie model | `V6`, custom mode, outer model `ai-music-api/generate` |
| Tracks per task | Usually 2; code processed whatever came back |
| Draft storage | `lyric_drafts`, versioned, no status: a failed draft could be sung |
| Audio | Downloaded, normalised, stored as full and preview; served by an unauthenticated `/api/audio/*` route that exposed full songs |
| Retries | One automatic regeneration on total failure |
| Webhook | Shared secret in the URL; audio URLs trusted from the callback body |
| Payments, sessions, orders | None. No Shopify code existed |
| Tests | None (smoke script and a six-fixture golden script only) |
| Lint | None configured |

Because there was no checkout, Phase 5 is a new, minimal Shopify integration rather than an adaptation.

## 1. Files changed and why

New files

| File | Purpose |
|---|---|
| `src/lib/songcraft/provenance.ts` | Verifies every brief quote against the customer's words, dedupes without merging distinct details, ranks and caps facts, records omissions |
| `src/lib/songcraft/arrangements.ts` | Six arrangement variants and the deterministic selection rules |
| `src/lib/songcraft/validate.ts` | Deterministic lyric validation, verifier-issue merging, draft comparison hierarchy |
| `src/lib/songcraft/direction.ts` | Typed `MusicDirection`, customer-style constraints, conflict resolution, style rendering, duration estimate |
| `src/lib/audio/qa.ts` | ffmpeg technical QA: corrupt or incomplete files, silence, clipping, length |
| `src/lib/pipeline/common.ts` | Shared events, status and cost logging |
| `src/lib/pipeline/generation.ts` | Candidate generation: planning, budget, idempotent submission, collection, selection, timeouts |
| `src/lib/pipeline/process.ts` | Per-track download, QA, normalisation, alignment, preview cut, scoring |
| `src/lib/pipeline/view.ts` | Customer view with signed media only; version selection |
| `src/lib/commerce/shopify.ts` | Storefront cart creation, webhook HMAC, order parsing |
| `src/lib/commerce/orders.ts` | Checkout, idempotent paid-order handling, fulfilment, refunds, cancellations |
| `src/lib/media/tokens.ts` | Signed, expiring media tokens; permanent delivery-link tokens |
| `src/lib/session/project.ts` | Per-project access token (hashed), cookies, rate limiting |
| `src/lib/http/guard.ts` | Route guard for project ownership |
| Routes | `select`, `checkout`, `events`, `media/[token]`, `webhooks/shopify`, `dev/mock-pay` |
| Pages | `/checkout/mock/[orderId]` (test checkout), `/d/[token]` (permanent delivery) |
| `scripts/metrics.ts` | Business metrics |
| `tests/**` | 55 unit tests, 11 integration tests, 1 browser end-to-end test |
| `docs/songcraft-v2-report.md` | This report |

Changed files

| File | Change |
|---|---|
| `songcraft/types.ts` | Source-backed brief, chorus-first lyric schema with plan, two-part verifier schema, `normalizeBrief` for v1 records |
| `songcraft/brief.ts` | New intake prompt; code-side provenance pass |
| `songcraft/lyrics.ts` | New writer and verifier prompts, gated loop with localized repair and shortening; v1 writer kept for A/B |
| `songcraft/registry.ts` | Archetypes, vocal presets with compatibility map, mood overrides, arrangements per genre; legacy fields kept |
| `songcraft/style.ts` | Model capabilities, runtime request schema, no truncation, `buildKieInput` kept as entry point |
| `songcraft/sanitize.ts` | Years and ordinals spelled out; artist filter fixes; `clamp` limited to titles |
| `songcraft/mock.ts` | v2 shapes; test hooks |
| `llm/client.ts` | Beta structured output with server-side refusal fallback on by default; usage accounting |
| `kie/client.ts`, `kie/types.ts` | Runtime validation, error classification, ambiguous-submit handling, signed callback URLs, Kie signature check, safe URLs, controllable mock |
| `pipeline/run.ts` | Briefing and lyrics only; draft status persistence |
| `db/schema.ts`, `db/migrations.sql` | Additive columns and tables (section 2) |
| `storage/index.ts` | No public URLs; `exists()` |
| `audio/ffmpeg.ts` | Download size cap and content-type check |
| API routes | Ownership checks on every project route; rate limits |
| `r/[id]/song-view.tsx` | Draft gate, version gallery, selection, checkout, purchased state |
| `scripts/golden-run.ts`, `scripts/smoke.ts` | A/B arms; full v2 flow |
| `.env.example`, `package.json` | New settings; test scripts |

Removed: `src/app/api/audio/[...path]/route.ts` (served full songs without authentication).

## 2. Database migrations

All additive (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) and applied automatically on start. Existing rows keep working.

- `song_requests`: `access_token_hash`, `quiz_snapshot`, `brief_version`, `experiment`, `active_draft_id`, `selected_version_id`, `candidates_finalized_at`. New status value `purchased`.
- `lyric_drafts`: `status` (null = legacy), `validation`, `creative`, `arrangement_id`, `plan`, `fact_placement`, `prompt_version`, `parent_draft_id`.
- `generations`: `idempotency_key` (unique), `slot`, `trigger`, `model`, `variant_id`, `prompt_version`, `preset_version`, `music_direction`, `est_cost_usd`, `credits_consumed`, `track_count`, `submitted_at`. New statuses `pending`, `unknown`, `collecting`.
- `song_versions`: `variant_id`, `variant_label`, `style_summary`, `requested_duration`, `source_audio_url` (server-side only), `audio_qa`, `name_heard`, `score`, `offered`, `offer_rank`, `selected`, `purchase_status`, `availability`. Unique `(request_id, provider_audio_id)`.
- New `orders` (unique `shopify_order_id`) and `webhook_receipts`.

Backward compatibility, tested: v1 briefs load through `normalizeBrief` (facts marked `legacy`), v1 drafts are gated by their stored verifier verdict, and v1 versions are still shown. Projects without an access token stay readable but cannot start checkout. Old `/api/audio` preview links stop working; previews are re-issued through the view.

## 3. Songwriting changes

- **Source-backed brief.** Each fact carries an id, the customer's exact supporting words and their character offsets, an emotional meaning (interpretation, not a fact) and a narrative role. Code checks every quote. A paraphrased quote is replaced with the real sentence; a fact with no supporting words is dropped and recorded. Must-include words, nicknames and signature phrases must also appear verbatim.
- **Fact retention.** Priority first, then distinctiveness (names, numbers, quotes, inside jokes). Duplicates merge only when one fact is contained in the other or they are nearly identical; distinct details are never merged. Omitted facts are listed with a reason.
- **Emotional thesis, signature phrases, narrative arc, contradictions** added to the brief. Contradictions are listed, not resolved, and the writer is told to assert neither side. A deterministic check flags a relationship chip that conflicts with the story.
- **Chorus-first writer.** The writer plans first (thesis, central detail, payoff, hook concept, verse roles, ending), then writes. The prompt asks for conversational, singable lines, one detail per line, natural rhymes, no forced inversions, and stock phrases only when they genuinely fit. Emotional interpretation is allowed; new events are not. Name in the first two chorus lines by default, with a documented exception path.
- **Arrangements.** Six variants with flexible line ranges, section purposes, dynamics and duration ranges; each genre allows only sensible ones.
- **Verifier.** Factual pass/fail is kept separate from five creative scores. The weights (30/25/20/15/10) are experimental. Craft findings never block.
- **Gate.** Draft status is explicit (`verified`, `needs_repair`, `failed`, `superseded`). Generation refuses anything not verified. The UI disables "Sing it" and lists the blocking issues.
- **Repair.** Localized: only flagged sections are rewritten and code restores anything else the model changed. Comparison hierarchy: factual failures, constraint failures, structure and length, warnings, then creative score. A valid draft is never replaced by an invalid one. Every attempt is stored.
- **No truncation.** Over-limit lyrics get one targeted shortening pass, then fail explicitly. The phonetic version is validated separately.

## 4. Music direction and Suno prompts

- `MusicDirection` is built from rules and presets with no LLM call. It covers the genre, arrangement, archetype, emotional intent, energy, voice (preset, texture, delivery), instrumentation, production, dynamics, negative tags, customer constraints, conflicts and preset version.
- Three internal archetypes per genre (lullaby has two): intimate, signature, expressive. Customer-facing labels describe the actual style, e.g. Heartfelt Acoustic, Modern Country, Big-Stage Country.
- Mood-aware presets: country heartfelt and celebratory, R&B heartfelt and romantic, per the brief. Romance is never added for a parent, child or friend; a "romantic" mood for them becomes "tender and affectionate", recorded as a conflict.
- Vocal presets are specific (e.g. "warm gravelly baritone") with a genre compatibility map that a test enforces. They are experimental until listening tests.
- Customer sound notes are parsed into real changes (no drums, acoustic only, piano, strings, fiddle, choir, live band, slow, upbeat, voice requests). Conflicts are resolved explicitly: the customer wins on sound, the quiz wins on voice gender, a lullaby stays gentle. Unrecognised text is kept verbatim. Artist references are removed and recorded.
- Rendering order: genre and arrangement, energy and intent, vocal, instruments, production, dynamics, customer notes. No bracket commands or noise descriptors. Optional segments are dropped whole if over the limit; required content that does not fit raises an error.
- Model capabilities are explicit; unsupported fields (e.g. `duration` on V5) are omitted. Only `KIE_ALLOWED_MODELS` are used. The request is validated against a runtime schema before sending.
- Duration is estimated from sung word count, arrangement vocal density and instrumental space, clamped to the arrangement range and the provider range.

## 5. The candidate strategy (exact)

1. One verified lyric sheet per round; versions differ musically, not lyrically.
2. A Kie task returns about two tracks. For three versions, two tasks are submitted at once: **signature** and **intimate** archetypes. Same cost as sequential, one generation wait instead of two.
3. Every track goes through technical QA (ffmpeg) and lyric-alignment QA (Kie timestamps). Failures are rejected and kept for internal review.
4. Up to three versions are offered, preferring one per archetype, then by heuristic score (lyric coverage, name heard, duration fit, QA warnings). The customer's existing selection is kept.
5. If fewer than three pass and nothing is in flight, one more task is submitted with the next archetype (**expressive**), within budget.
6. Defaults: at most 3 automatic tasks per lyric sheet, 5 tasks per project, $0.75 estimated spend. Below that, offer what passed (minimum 1); with zero usable, the request fails with a clear message. No loops.
7. Offer order is randomized by default and stored, so position bias can be measured.
8. Alternatives by setting: `DESIRED_CANDIDATES=2` (one task), `VARIANT_MODE=same_style`, `CANDIDATE_COLLECTION=per_task` (one task per offered version).

Paid-call safety: each task slot has a unique idempotency key. A timeout or malformed response after sending is treated as "unknown" and never resubmitted. The callback URL carries our generation id and a signature, so a task whose creation response was lost is reconciled when Kie calls back. Results always come from Kie's task API, never from the callback body. A "success" with zero valid tracks is a failure. Duplicate callbacks are no-ops.

## 6. Preview and checkout

- Every project gets a random access token, stored hashed and held in an httpOnly cookie. All project APIs check it.
- Storage is private. Previews are served through signed tokens that expire after an hour and can only name preview files. Previews are about 45 seconds, starting just before the first chorus line that sings the name.
- The gallery has native audio controls, a single persisted selection, real style labels, runtimes and listening analytics.
- **Checkout:** the client sends only a version id. The server checks that it belongs to the caller's project and is on offer, then creates a Storefront cart with our order id as a hidden line attribute and redirects. Price is always Shopify's. Abandoned checkouts are reused for 24 hours.
- **Payment:** returning from checkout unlocks nothing. Only a verified `orders/paid` webhook counts. HMAC is checked over the raw body, deliveries are de-duplicated by event id, the order must be paid and contain the configured variant, and the order row is claimed atomically. A second payment for the same song is flagged `duplicate_payment` for refund. If an Admin API token is set, the order is re-fetched authoritatively.
- **Fulfilment:** confirms the full file is in durable storage, re-downloading from Kie while its URL is still valid if needed. Then it unlocks the version and creates a permanent delivery link. Download URLs are short-lived and re-issued on each visit.
- **Refunds:** `refunds/create` revokes access, and the media route re-checks purchase status on every full-file request.

## 7. Tests run and results

All run in this environment, mock providers, no paid calls.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npm run test:unit` | 55 / 55 pass |
| `npm run test:integration` | 11 / 11 pass |
| `npm run test:e2e` (Playwright vs mock dev server) | Pass |
| `next build` | Pass (run in a copy of the project) |
| `npm run smoke` | Pass: two tasks, three versions offered, mock purchase fulfilled, duplicate webhook ignored |
| `npm run golden` (32 fixtures, mock) | Runs; 32/32 verified, all quotes traced. Mock scores are placeholders |
| Lint | Not run: no linter is configured in the project |

Real bugs the tests caught during this work, now fixed: clipping detection read the wrong ffmpeg statistic; a truncated MP3 passed QA because its header declares full length; one vocal preset was outside its compatibility map; fact dedupe would have merged facts differing by one real detail.

## 8. Limitations and unresolved items

- No live verification of Claude, Kie.ai or Shopify. The v2 prompts have not produced real lyrics yet.
- Optional transcription-based audio checking behind a feature flag was not built; lyric alignment uses Kie's timestamps, which are a heuristic.
- Background work uses Next's `after()`; it needs a long-running Node host (Railway, Fly, Docker). On serverless, move the pipeline to a queue.
- Rate limiting and poll throttling are per process.
- No email delivery yet; the delivery link appears on the song page.
- Data model supports buying further versions (one order per version); bundles and reorders are not built.
- Vocal presets, archetype parameters and creative weights are experimental.

## 9. Needs real credentials to verify

- Claude: `npm run golden` with `ANTHROPIC_API_KEY`, then read `data/golden-out/*.md`.
- Kie.ai: actual tracks per task, `duration` and weight behaviour on V6, timestamp format, credit costs, `KIE_WEBHOOK_HMAC_KEY` signatures, audio host names for `KIE_AUDIO_HOSTS`.
- Shopify: cart creation with the song variant, line attributes appearing as line item properties on `orders/paid`, webhook HMAC with the app secret, refunds.

## 10. Estimated cost per customer session

Assumptions, all estimates: Claude Opus 5.5 at $4 / $20 per million tokens; the token counts below are guesses to replace with `npm run metrics` after real runs; Kie task cost $0.15 (configurable; check actual credits).

| | Before | After (default) |
|---|---|---|
| Claude calls (baseline) | 3 | 3 |
| Claude cost, no repair | ~$0.18 (brief 2.5k/1.5k, writer 3k/4k, verifier 3k/2k tokens) | ~$0.26 (larger prompts and outputs: 3k/2.5k, 4.5k/5k, 5k/3k) |
| Each repair or shortening pass | ~$0.15 | ~$0.15-0.20 (writer + verifier) |
| Kie tasks | 1 (2 versions) | 2 (3 versions); up to 3 on QA shortfall |
| Generation cost | ~$0.15 | ~$0.30 typical, $0.45 worst automatic case, $0.75 hard cap |
| **Typical per preview session** | **~$0.33** | **~$0.56** |

With `DESIRED_CANDIDATES=2`, generation cost matches the old system (one task), and only the larger prompts add about $0.08.

## 11. Suggested A/B tests

1. Two vs three versions: conversion against generation cost.
2. Writer v1 vs v2: golden suite with real keys plus blind human preference on the same fixtures.
3. Specific vs generic vocal descriptors (`VOCAL_MODE`): blind listening, several takes per arm.
4. Distinct styles vs same style per round (`VARIANT_MODE`).
5. Adaptive arrangement vs fixed v1 blueprint (`--a arrangement=legacy_blueprint`).
6. Preview length 45 vs 60 seconds.
7. Position bias: compare selection share by on-screen position with randomized order.

Change one variable per experiment, keep model versions and fixtures fixed, and collect several samples per arm because generation is stochastic.

## 12. Writer v3 (idea-first), under evaluation

Built after the first real golden runs (mom-60, wedding, two friend fixtures)
showed the same failures every time: singability was the lowest score, choruses
rhymed weakly, leftover facts were tacked on as extra lines, and songs walked
through every fact in order.

- `SONGCRAFT_WRITER=v3` uses `LYRICIST_SYSTEM_V3`: a sequence (idea, boxes,
  chorus first, verses as setups, bridge as reframe, outro, singability pass)
  instead of a growing rule list. The truth rules are unchanged from v2.
- The v3 plan records the shape (blessing, then_and_now, never_said,
  joke_to_truth, portrait), three competing hook options with verdicts, one
  box per section with its fact ids, and the reframe. `fromV3Lyrics` maps it to
  the shared contract, so v2 and v3 face identical checks and the same verifier.
- New code checks (all writers): `melodic_mismatch` (line n of a later verse vs
  verse 1, syllables), `title_not_in_chorus`, `chorus_longer_than_verses`
  (suggestion), plus the earlier `odd_line_count`.
- Verifier: explicit rubric per score. Singability starts at 10 and loses points
  for melodic mismatches, prosody errors, breath-length lines, unpaired lines and
  closed held vowels. A fact-list song is capped at 6 for emotional impact.
  Scores from before this change are not directly comparable.
- Brief: at most `BRIEF_MAX_PRIORITY1` (default 3) must-use facts; extras are
  demoted to priority 2 and recorded in provenanceNotes.

Not yet evaluated with the real model. Compare with
`npm run golden -- --a writer=v2 --b writer=v3`, then generate audio for a few
songs from each arm; scores alone do not decide it.

## Before and after: `mom-60-country` fixture

The story: "Mom taught me to make pancakes every Sunday. She sings off-key in the car on every road trip and does not care. Her happy place is the lake house in Michigan. She is turning 60 and still beats everyone at cards."

Both runs below are **mock mode**, because no Claude key was available. The lyrics are placeholder text from the mocks, not real model output, and say nothing about songwriting quality. What is real: the brief structure and provenance checks, the validation, and the Suno style prompts, which are deterministic.

### Original brief (v1, from the previous commit)

```json
{
  "recipient": { "name": "Linda", "sungAs": "", "relationship": "mom", "pronouns": "she" },
  "occasion": "birthday",
  "facts": [
    { "type": "trait", "text": "Mom taught me to make pancakes every Sunday", "priority": 1 },
    { "type": "place", "text": "She sings off-key in the car on every road trip and does not care", "priority": 1 }
  ]
}
```
(abridged: four facts, tone, mustInclude, avoid, summary, followUpQuestions; no sources, ids or interpretation)

### New source-backed brief (v2)

```json
{
  "id": "fact_02",
  "type": "trait",
  "text": "Mom taught me to make pancakes every Sunday",
  "priority": 1,
  "sourceQuote": "Mom taught me to make pancakes every Sunday",
  "sourceRef": { "source": "story", "index": 0, "start": 0, "end": 43 },
  "provenance": "verified",
  "emotionalMeaning": "…",
  "narrativeRole": "opening_scene"
}
```
Plus `emotionalThesis`, `signaturePhrases`, `narrativeArc`, `contradictions`, `omittedFacts`, `provenanceNotes`. All four facts verified against the story.

### Old lyrics (v1 mock)

```
[Chorus]
Linda, this one is for you
Every birthday I think of all you do
Through the years you have been my light
Linda, tonight we sing it right
```

### New lyrics

Placeholder in mock mode. Run `npm run golden -- --only mom-60` with `ANTHROPIC_API_KEY` set to see real v2 output with its plan, issues and creative scores.

### Final Suno style prompts (v2, real output of the direction engine)

- **Modern Country** (signature): heartfelt modern country ballad, slow tempo, gentle energy, heartfelt and grateful, bright female country vocal with a light twang, warm and expressive, acoustic guitar, restrained pedal steel, soft live drums, polished Nashville production, slow-building ballad structure, conversational verses, gradual emotional build, full final chorus
- **Heartfelt Acoustic** (intimate): intimate singer-songwriter country, slow tempo, gentle energy, heartfelt and grateful, clear expressive alto vocal, warm, gentle acoustic guitar, restrained pedal steel, natural room ambience, close warm vocal, slow-building ballad structure, conversational verses, gradual emotional build
- **Big-Stage Country** (expressive, only if a follow-up task is needed): anthemic country rock, mid-tempo, heartfelt and grateful, powerful soulful mezzo-soprano vocal, warm and expressive, driving electric guitars, pedal steel, big live drums, fiddle, wide arena mix, stacked harmonies, slow-building ballad structure, soaring final chorus

Old style prompt (v1): "modern country, acoustic and electric guitar, pedal steel, steady drums, storytelling verses, big singalong chorus, bright female vocal with a slight twang, warm and nostalgic, heartfelt mood"

### Expected variation configuration

| Slot | Archetype | Label | Voice | style_weight / weirdness / variety | Duration |
|---|---|---|---|---|---|
| 0 | signature | Modern Country | female (quiz) | 0.70 / 0.20 / 1 | estimated from lyrics |
| 1 | intimate | Heartfelt Acoustic | female (quiz) | 0.75 / 0.20 / 1 | estimated from lyrics |
| 2 (only on shortfall) | expressive | Big-Stage Country | female (quiz) | 0.65 / 0.25 / 2 | estimated from lyrics |
