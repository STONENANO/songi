# Custom Song Studio (Songcraft v2)

A personalised gift-song pipeline. A short quiz becomes a source-backed brief, the brief becomes verified lyrics, the lyrics become two or three musical versions through Kie.ai (Suno), and the customer previews, picks one, and buys it on our own checkout page (Stripe: card, Link, Apple Pay, Google Pay).

See `docs/songcraft-v2-report.md` for the full design, decisions, costs and limitations.

## Run it

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:4747
```

With no keys, everything runs in free mock mode: placeholder lyrics, test-tone audio and a test checkout page. Every state transition, the database, audio processing, QA, previews, signed media and the purchase flow are real. Add keys one provider at a time:

| Key | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | Real briefs, lyrics and verification |
| `KIE_API_KEY` | Real Suno recordings (paid) |
| `STRIPE_*` + `STRIPE_ENABLED=true` | Real payments on the custom checkout, and payment webhooks |
| `MEDIA_SIGNING_SECRET` | Required in production |

Requirements: Node 22 and ffmpeg (`brew install ffmpeg`). The Dockerfile includes ffmpeg.

### Setting up your keys

1. `npm run doctor -- --fix` creates `.env` if needed and generates the two local signing secrets.
2. Open `.env` in your editor and paste your keys after the `=` (no quotes, no spaces). Never commit `.env`; it is gitignored.
3. `npm run doctor` again. It checks each key with free, read-only calls and never prints full secrets.

| Setting | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API keys |
| `KIE_API_KEY` | kie.ai → API keys (needs credits for real recordings) |
| `KIE_WEBHOOK_HMAC_KEY` | kie.ai → Settings (production only) |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com → Developers → API keys (use test keys first) |
| `STRIPE_WEBHOOK_SECRET` | Developers → Webhooks → add `https://<domain>/api/webhooks/stripe` → signing secret (`whsec_…`). Locally: `stripe listen --forward-to localhost:4747/api/webhooks/stripe` (Stripe CLI: `npm i -g @stripe/cli`) |
| `STRIPE_ENABLED` | The Stripe switch. `false` (default): test checkout, nothing charged, even with keys set. `true`: real payments |
| `SONG_PRICE_CENTS` / `SONG_CURRENCY` | The price (default 3900 = $39, usd). Set on the server only |
| `STRIPE_AUTOMATIC_TAX` / `STRIPE_TAX_CODE` / `STRIPE_TAX_BEHAVIOR` | Stripe Tax. See "Stripe Tax" below before turning it on |

Add keys one at a time. With only `ANTHROPIC_API_KEY` set you get real lyrics and still spend nothing on music.

## How a song moves

```
draft → briefing → (needs_input) → writing_lyrics → lyrics_ready
      → generating → processing → preview_ready → purchased | failed
```

0. **Story quiz** (`/create`, `app/create/*`, `onboarding/*`). Three chapters, one question per screen: who it's for, their story, the sound. The buyer picks 2 or 3 story threads and answers one question each; a fast model (`POST /api/probe`, `PROBE_MODEL`) asks at most one follow-up when an answer is vague. Answers become the `story` as Q/A blocks; extras (the one line, feeling, leave-out, who it's from) are kept in `quiz_snapshot`. Quiz projects record automatically once verified lyrics exist (`autoRecord`). See `docs/story-capture-plan.md`.
1. **Brief** (`songcraft/brief.ts`, `provenance.ts`). Claude extracts facts with the customer's exact supporting words; code verifies every quote, dedupes, ranks and caps facts. Thin stories get up to two follow-up questions, once.
2. **Lyrics** (`songcraft/lyrics.ts`, `validate.ts`, `arrangements.ts`). Chorus-first writer on a genre-appropriate arrangement; deterministic checks plus an independent Claude verifier; localized repair; explicit status. Only `verified` lyrics can be recorded.
3. **Music direction** (`songcraft/direction.ts`, `registry.ts`, `style.ts`). Typed direction per version (intimate, signature, expressive), mood-aware, honouring the customer's sound notes; validated request, no truncation.
4. **Versions** (`pipeline/generation.ts`, `process.ts`, `audio/qa.ts`). Two tasks in different styles for three versions; QA on every track; bounded follow-up on shortfall; idempotent, reconciled callbacks.
5. **Preview and purchase** (`pipeline/view.ts`, `commerce/*`, `media/tokens.ts`). Private storage, signed preview links, persisted selection, Stripe checkout, verified webhooks, idempotent fulfilment, permanent delivery link.

## Front end and re-skinning

The customer pages (quiz and song page) are built to be re-skinned without touching logic:

| What | Where |
|---|---|
| Colours, fonts, spacing, motion | `src/app/theme.css` (design tokens only) |
| Home page | `src/app/page.tsx`, `home.css`, `home-floaters.tsx` |
| Mascot and 3D objects (made in Higgsfield) | `public/brand/mascot/`, `public/brand/objects/` |
| Wait-screen mascot clips, one per step | `public/brand/wait/` (`MascotStage` in `components/ui`; step → clip in `app/r/[id]/song-view.tsx`) |
| Shared UI pieces (tiles, chips, player, lyrics, bubbles…) | `src/components/ui/` |
| Quiz behaviour / screens | `src/app/create/use-quiz.ts` / `screens.tsx` |
| Song page behaviour / views | `src/app/r/[id]/use-song.ts` / `song-view.tsx` |
| All quiz wording, story threads, examples | `src/lib/onboarding/content.ts` |
| Brand name, wait-page video, wait timing | `src/lib/brand.ts` (`NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_WAIT_VIDEO_URL`, `NEXT_PUBLIC_EST_RECORD_SECONDS`) |

`/dev/theme` shows every shared piece in its states. Admin, test checkout and delivery pages keep the original dark styles (`app/legacy.css`, scoped under `.legacy`). Quiz funnel events go to the `events` table via `POST /api/track`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 4747 (`npm run dev -- -p 5555` for another port; set `APP_URL` to match) |
| `npm test` | Unit + integration tests (in-memory DB, all providers mocked, no spend) |
| `npm run test:e2e` | Browser test against a running mock dev server (needs Playwright) |
| `npm run smoke` | Full pipeline from a script, through a mock purchase |
| `npm run golden` | 32-fixture lyric suite; `--a writer=v1 --b writer=v2` for A/B; output in `data/golden-out/` |
| `npm run metrics` | Business metrics from the database |
| `npm run typecheck` | TypeScript |

## Testing with real people (MVP)

1. Check setup: `npm run doctor -- --fix` (generates `ADMIN_TOKEN` and the signing secrets if missing).
   In `.env`, keep `SONGCRAFT_WRITER=v3` (or delete the line) and `LYRIC_DRAFTS=2`.
2. Start the app: `npm run dev`, then open http://localhost:4747/create.
3. Make the song with the tester's real story (with their permission). Lyrics take about one to two minutes;
   recording three takes takes about two to four more. You can leave the page and come back.
4. Play the takes for the person the song is for. Each song page has a "How did it land?" box:
   a reaction, "would you pay $45?", and a note. Fill it in with what they said.
5. See every test song in one place at http://localhost:4747/admin?token=YOUR_ADMIN_TOKEN:
   lyrics, all takes (full audio), checker notes, cost and feedback.
6. Checkout is in test mode while Stripe is switched off (`STRIPE_ENABLED=false`, the default): "Pay (test)" unlocks the download without charging. On a live server, also set `FREE_DOWNLOADS=true`, or the checkout step stays closed.

Each song costs roughly $0.50 to $0.80 in Claude calls (two first drafts, checks, sometimes a polish pass) plus two
Kie tasks for three takes. Note your Kie credits before and after the first song.

## Stripe Tax

Checkout is a Stripe Checkout Session shown inside our page (`ui_mode: "elements"`), so turning on tax is one setting: `automatic_tax`. When `STRIPE_AUTOMATIC_TAX=true`, the checkout adds an address form, and Stripe works out the tax from that address and adds it on top of the price (`STRIPE_TAX_BEHAVIOR=exclusive`). Stripe also records each sale for tax reports and reverses the tax on refunds. Before turning it on:

1. Dashboard → **Tax** → **Settings**: add your head office address. Until you do, Stripe refuses checkouts that ask for tax.
2. Dashboard → **Tax** → **Registrations**: add every place you are already registered to collect tax. **With no registration, Stripe collects $0 and shows no error.** Adding one in Stripe does not register you with the tax authority. Stripe's "Register for me" can do that for eligible US remote sellers. **Locations → Needs attention** shows where you may be getting close to a threshold.
3. Check the product tax code. The default, `txcd_10401100` (Digital Audio Works, downloaded, permanent rights), matches an MP3 the buyer keeps. Confirm it with your tax advisor ([tax codes](https://docs.stripe.com/tax/tax-codes)).
4. `npm run doctor` with `STRIPE_AUTOMATIC_TAX=true`: it checks steps 1 and 2 and runs a real test calculation.

Sandbox and live mode keep separate tax settings and registrations, so do steps 1 and 2 in both.

## Production checklist

- Set `MEDIA_SIGNING_SECRET`, `KIE_WEBHOOK_SECRET` and `KIE_WEBHOOK_HMAC_KEY` (from kie.ai settings). A production server (`NODE_ENV=production`) **refuses to start** and lists what is missing when any of these is unset or a placeholder, when `STRIPE_ENABLED=true` lacks a Stripe key or `STRIPE_WEBHOOK_SECRET`, or when `STORAGE_DRIVER=s3` lacks an `S3_*` setting.
- Use Postgres (`DATABASE_URL`) and private S3/R2 storage (`STORAGE_DRIVER=s3`).
- Set `STRIPE_ENABLED=true` (payments are off by default). In Stripe: set `STRIPE_SECRET_KEY` (a restricted `rk_live_` key is safer), `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`. Add the webhook endpoint `/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` and `charge.refunded`. Add `payment_intent.succeeded` and `payment_intent.canceled` too while orders from before this change are still open. Turn on Link, Apple Pay and Google Pay under Payment methods, and register your domain for Apple Pay. To collect tax, follow "Stripe Tax" above in live mode.
- Run on a long-running Node host; background work uses Next's `after()`.
