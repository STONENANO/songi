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
| `STRIPE_PRODUCT_ID` | Recommended. The price is read from this Stripe product's default price: change it in Stripe (add a price, "Set as default price") and the site follows within a minute, at once with the price webhooks. See "Pricing from Stripe" below |
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
5. See every test song in one place at http://localhost:4747/admin (open locally; on the live site, sign in, see Admin sign-in below):
   lyrics, all takes (full audio), checker notes, cost and feedback.
6. Checkout is in test mode while Stripe is switched off (`STRIPE_ENABLED=false`, the default): "Pay (test)" unlocks the download without charging. On a live server, also set `FREE_DOWNLOADS=true`, or the checkout step stays closed.

Each song costs roughly $0.50 to $0.80 in Claude calls (two first drafts, checks, sometimes a polish pass) plus two
Kie tasks for three takes. Note your Kie credits before and after the first song.

## Admin sign-in

`/admin` (songs, takes, feedback, Numbers) is behind a Supabase Auth sign-in. Supabase only proves who someone
is; only the accounts in `ADMIN_EMAILS` get in. The pages aren't linked from the site and tell search engines not
to index them. Locally, with no Supabase settings, `/admin` is open as before; on a production server without
them it is closed to everyone.

**Email link (default, `ADMIN_AUTH_PROVIDER=email`).** Enter your email on `/admin/login` and Supabase emails a
one-time sign-in link. Links are only sent to addresses in `ADMIN_EMAILS` (the page says the same thing either
way, so it never reveals who has access), and a link only works in the browser that asked for it.

Setup:
1. Supabase -> Authentication -> URL Configuration -> Redirect URLs: add
   `https://www.getcryworthy.com/admin/auth/callback` (and `http://localhost:4747/admin/auth/callback` for local
   testing). Without it, the emailed link lands on the project's Site URL instead.
2. On the server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (Project Settings -> API Keys) and `ADMIN_EMAILS`
   (comma-separated). `APP_URL` must be the site's public address. The server refuses to start with only some
   of the three set.
3. Supabase's built-in email sender is rate limited and meant for low volume, which is fine for admin sign-ins.
   For more, set up custom SMTP in Supabase -> Authentication -> Emails.

**Google or GitHub instead (`ADMIN_AUTH_PROVIDER=google` or `github`).** Create an OAuth client with the provider
(for Google: Cloud Console -> APIs & Services -> Credentials -> OAuth client ID, Web application, redirect URI
`https://<project-ref>.supabase.co/auth/v1/callback`), enable the provider in Supabase -> Authentication -> Sign
In / Providers with its client ID and secret, and add the same Redirect URL as above.

The flow runs on the server (PKCE), the session cookies are httpOnly, and `src/middleware.ts` refreshes the
session on /admin requests. `ADMIN_TOKEN` now only opens the admin API (`/api/admin/ip`).

## Unit economics (/admin/numbers)

`/admin/numbers` shows, for songs started in the last 7, 30 or 90 days or all time:
the funnel from finished quiz to paid, conversion rates, money (charged, tax, refunds, estimated Stripe fees,
net revenue), AI cost split into Kie, Claude and the quiz's follow-up questions, and cost and profit per buyer.
Its break-even line says how many previewed songs one sale pays for. Enter the period's ad spend to see cost to
acquire a buyer, return on ad spend and profit after ads. Tables split it all by week and by occasion.

- Only real Stripe payments count as sales; free test unlocks are listed separately.
- AI costs are the cost ledger's estimates (`KIE_TASK_COST_USD`, `LLM_*_COST_PER_MTOK`). Check them against
  your Kie.ai and Anthropic bills. Stripe fees use `STRIPE_FEE_PERCENT` and `STRIPE_FEE_FIXED_CENTS`.
- The quiz's follow-up questions are recorded in the cost ledger without a song (they run before one exists),
  so people who leave the quiz still count toward cost per buyer.

## Meta ads tracking (Pixel + Conversions API)

With `META_PIXEL_ID` set, the browser loads the Meta Pixel after the page has loaded (never on /admin or /dev),
and with `META_CAPI_TOKEN` the server also sends the same events through Meta's Conversions API:

| Event | Browser | Server | Event id |
|---|---|---|---|
| PageView | every page | - | - |
| Lead | quiz submitted | song created | `lead:<song id>` |
| InitiateCheckout | checkout page | order created | `checkout:<order id>` |
| Purchase | first visit to the song after paying | Stripe payment confirmed | `purchase:<order id>` |

- Matching ids let Meta keep one copy of each event. Purchase value is the price before tax.
- Free test unlocks and $0 orders are never sent as purchases.
- Server events carry the email hashed with SHA-256, a hashed song id, Meta's `_fbp`/`_fbc` cookies, IP and
  user agent, captured when the song was started (`song_requests.ad_attribution`).
- To check the setup: Events Manager -> Test events, put its code in `META_TEST_EVENT_CODE`, make a song, then
  remove the code.
- Code: `src/lib/analytics/meta.ts` (server), `src/lib/analytics/meta-pixel.ts` and `src/app/meta-pixel.tsx`
  (browser), `src/lib/analytics/meta-ids.ts` (shared ids).

## Analytics (PostHog)

Funnels, quiz drop-off, traffic sources and session replay. Off until `NEXT_PUBLIC_POSTHOG_KEY` is set
(the project API key, `phc_...`, from PostHog -> Settings -> Project). Set it before building: the Dockerfile
takes it as a build arg. Use `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` for an EU project.

- The browser sends page views, every `quiz:*` event (step views, skips, submitted) and session replays.
  Replays mask everything typed. `/admin` and `/dev` are never tracked.
- The server sends the rest, so ad blockers can't drop them: `status:needs_input`, `status:preview_ready`,
  `status:failed`, `preview_play`, `preview_complete`, `candidate:selected`, `checkout:started`, `order:paid`
  (with `revenue`, before tax), `order:payment_failed`, `order:refunded`. Each carries `request_id`, `occasion`,
  `relationship` and `genre`. The quiz sends the visitor's PostHog id with the song, so these join that visitor's funnel.
- Events go through `/ingest` on our own domain (see `next.config.ts`), so fewer are lost to ad blockers.
- Every event is still written to our own `events` table too. Costs and margins come from the database
  (`/admin/numbers`), not PostHog. The "Cryworthy: conversion" dashboard in PostHog holds the main funnel,
  quiz drop-off by screen, previews to purchase, conversion by `utm_source`, daily volume and revenue.

Main funnel: `quiz:step_view` -> `quiz:submitted` -> `status:preview_ready` -> `preview_play` ->
`candidate:selected` -> `checkout:started` -> `order:paid`. For quiz drop-off, break down `quiz:step_view` by `step`.

## Pricing from Stripe

With `STRIPE_PRODUCT_ID` (or `STRIPE_PRICE_ID` to pin one price), Stripe is the source of truth for the price (`src/lib/commerce/pricing.ts`):

- **Change the price** in Dashboard → Product catalog → the product → Add another price → "Set as default price". No deploy.
- **Fast pages**: the price is cached and refreshed in the background every minute; the `product.updated` and `price.*` webhooks refresh it at once.
- **Hard to break**: if Stripe can't be reached, pages keep the last good price (or `SONG_PRICE_CENTS` before the first load). Checkout always sells a freshly checked price and refuses an archived, recurring, tiered or pay-what-you-want one, alerting Sentry. Each order stores the amount it was sold at and payments are checked against that, so a price change mid-checkout is safe.
- `npm run doctor` shows where the price comes from and whether it can be sold.

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
- Set `STRIPE_ENABLED=true` (payments are off by default). In Stripe: set `STRIPE_SECRET_KEY` (a restricted `rk_live_` key is safer), `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`. Add the webhook endpoint `/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` and `charge.refunded`, plus `product.updated`, `price.created`, `price.updated` and `price.deleted` so price changes show at once. Add `payment_intent.succeeded` and `payment_intent.canceled` too while orders from before this change are still open. Turn on Link, Apple Pay and Google Pay under Payment methods, and register your domain for Apple Pay. To collect tax, follow "Stripe Tax" above in live mode.
- Run on a long-running Node host; background work uses Next's `after()`.
- Bot check: set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (Cloudflare → Turnstile → Add site, widget mode "Managed"). Song creation then needs a passed check. Rebuild after setting the site key: it is built into the page.
- Error tracking: set `NEXT_PUBLIC_SENTRY_DSN` before building (the Dockerfile takes it as a build arg, so the browser reports too; the server reads it at startup). Paid orders that can't be delivered, amount mismatches, duplicate payments, failed Stripe webhooks and failed songs are reported; set Sentry alerts on them.
- Free previews: each email address may start `MAX_SONGS_PER_EMAIL_PER_WEEK` (3) songs per rolling week, on top of the per-visitor limit. There is no site-wide daily cap by default (`MAX_SONGS_PER_DAY=0`); `SONG_VOLUME_ALERT_PER_DAY` sends a Sentry warning on busy days instead.
- Preview links: when a song's versions are ready, the buyer gets a direct link (`/r/<id>?p=…`, copy and share buttons on the song page, and by email once `EMAIL_FROM` and a Postmark or Resend key are set). It works on any device for `PREVIEW_LINK_HOURS` (48). Audio nobody bought is deleted `PREVIEW_RETENTION_DAYS` (14) after the versions were ready; paid songs are never deleted.
- Rate limits are stored in the database (`rate_limits`) and keyed by the visitor IP from `CLIENT_IP_HEADER` (default `x-real-ip` on Railway), so they hold across instances and deploys.
