# Custom Song Studio (Songcraft v2)

A personalised gift-song pipeline. A short quiz becomes a source-backed brief, the brief becomes verified lyrics, the lyrics become two or three musical versions through Kie.ai (Suno), and the customer previews, picks one, and buys it through Shopify.

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
| `SHOPIFY_*` | Real checkout and payment webhooks |
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
| `SHOPIFY_STORE_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_STOREFRONT_TOKEN` | Shopify admin → Apps → Develop apps → your app → Storefront API access token |
| `SHOPIFY_SONG_VARIANT_ID` | `gid://shopify/ProductVariant/<number>` of the song product |
| `SHOPIFY_WEBHOOK_SECRET` | The same app's API secret key (signs webhooks) |

Add keys one at a time. With only `ANTHROPIC_API_KEY` set you get real lyrics and still spend nothing on music.

## How a song moves

```
draft → briefing → (needs_input) → writing_lyrics → lyrics_ready
      → generating → processing → preview_ready → purchased | failed
```

1. **Brief** (`songcraft/brief.ts`, `provenance.ts`). Claude extracts facts with the customer's exact supporting words; code verifies every quote, dedupes, ranks and caps facts. Thin stories get up to two follow-up questions, once.
2. **Lyrics** (`songcraft/lyrics.ts`, `validate.ts`, `arrangements.ts`). Chorus-first writer on a genre-appropriate arrangement; deterministic checks plus an independent Claude verifier; localized repair; explicit status. Only `verified` lyrics can be recorded.
3. **Music direction** (`songcraft/direction.ts`, `registry.ts`, `style.ts`). Typed direction per version (intimate, signature, expressive), mood-aware, honouring the customer's sound notes; validated request, no truncation.
4. **Versions** (`pipeline/generation.ts`, `process.ts`, `audio/qa.ts`). Two tasks in different styles for three versions; QA on every track; bounded follow-up on shortfall; idempotent, reconciled callbacks.
5. **Preview and purchase** (`pipeline/view.ts`, `commerce/*`, `media/tokens.ts`). Private storage, signed preview links, persisted selection, Shopify checkout, verified webhooks, idempotent fulfilment, permanent delivery link.

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

## Production checklist

- Set `MEDIA_SIGNING_SECRET`, `KIE_WEBHOOK_SECRET` and `KIE_WEBHOOK_HMAC_KEY` (from kie.ai settings).
- Use Postgres (`DATABASE_URL`) and private S3/R2 storage (`STORAGE_DRIVER=s3`).
- In Shopify: create the song product, set `SHOPIFY_SONG_VARIANT_ID`, register webhooks `orders/paid`, `refunds/create`, `orders/cancelled` to `/api/webhooks/shopify`.
- Run on a long-running Node host; background work uses Next's `after()`.
