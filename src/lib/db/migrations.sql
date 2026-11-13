CREATE TABLE IF NOT EXISTS song_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'draft',
  email text,
  recipient_name text,
  pronunciation text,
  relationship text NOT NULL,
  occasion text NOT NULL,
  story text NOT NULL,
  genre_key text NOT NULL,
  vocal_gender text NOT NULL DEFAULT 'any',
  mood text,
  custom_style text,
  language text NOT NULL DEFAULT 'en',
  brief jsonb,
  follow_up_questions jsonb,
  follow_up_answers jsonb,
  generation_attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE TABLE IF NOT EXISTS lyric_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  display_lyrics text NOT NULL,
  sung_lyrics text NOT NULL,
  verifier_report jsonb,
  source text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lyric_drafts_request_idx ON lyric_drafts(request_id);

CREATE TABLE IF NOT EXISTS generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
  lyric_draft_id uuid NOT NULL REFERENCES lyric_drafts(id),
  provider text NOT NULL DEFAULT 'kie-suno',
  provider_task_id text,
  registry_version text NOT NULL,
  request_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS generations_task_idx ON generations(provider_task_id);
CREATE INDEX IF NOT EXISTS generations_request_idx ON generations(request_id);

CREATE TABLE IF NOT EXISTS song_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
  provider_audio_id text NOT NULL,
  title text,
  audio_key text,
  preview_key text,
  image_url text,
  duration real,
  preview_start real,
  aligned_words jsonb,
  quality jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS song_versions_request_idx ON song_versions(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS song_versions_provider_audio_idx ON song_versions(generation_id, provider_audio_id);

CREATE TABLE IF NOT EXISTS events (
  id serial PRIMARY KEY,
  request_id uuid REFERENCES song_requests(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_ledger (
  id serial PRIMARY KEY,
  request_id uuid REFERENCES song_requests(id) ON DELETE CASCADE,
  provider text NOT NULL,
  operation text NOT NULL,
  units real NOT NULL DEFAULT 1,
  cost_usd numeric(10,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===================== Songcraft v2 (additive, backward compatible) =====================
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS access_token_hash text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS quiz_snapshot jsonb;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS brief_version integer;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS experiment jsonb;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS active_draft_id uuid;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS selected_version_id uuid;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS candidates_finalized_at timestamptz;

ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS validation jsonb;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS creative jsonb;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS arrangement_id text;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS plan jsonb;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS fact_placement jsonb;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE lyric_drafts ADD COLUMN IF NOT EXISTS parent_draft_id uuid;

ALTER TABLE generations ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS generations_idem_idx ON generations(idempotency_key);
ALTER TABLE generations ADD COLUMN IF NOT EXISTS slot integer;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS trigger text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS variant_id text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS preset_version text;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS music_direction jsonb;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS est_cost_usd numeric(10,4);
ALTER TABLE generations ADD COLUMN IF NOT EXISTS credits_consumed real;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS track_count integer;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS variant_id text;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS variant_label text;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS style_summary text;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS requested_duration real;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS source_audio_url text;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS audio_qa jsonb;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS name_heard boolean;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS score real;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS offered boolean NOT NULL DEFAULT false;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS offer_rank integer;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS purchase_status text NOT NULL DEFAULT 'none';
ALTER TABLE song_versions ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'available';
CREATE UNIQUE INDEX IF NOT EXISTS song_versions_req_audio_idx ON song_versions(request_id, provider_audio_id);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES song_versions(id),
  status text NOT NULL DEFAULT 'pending',
  offer_id text,
  cart_id text,
  checkout_url text,
  shopify_order_id text,
  amount_cents integer,
  currency text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  refunded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_shopify_order_idx ON orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS orders_request_idx ON orders(request_id);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  id text PRIMARY KEY,
  source text NOT NULL,
  topic text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES song_requests(id) ON DELETE CASCADE,
  version_id uuid REFERENCES song_versions(id) ON DELETE SET NULL,
  rating integer NOT NULL,
  would_pay text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_request_idx ON feedback(request_id);

-- Stripe payments (replaces Shopify checkout)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_pi_idx ON orders(stripe_payment_intent_id);

-- Stripe Checkout Sessions (Payment Element in our page) and Stripe Tax
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_cs_idx ON orders(stripe_checkout_session_id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_cents integer;

-- Lock every table to the server. On Supabase the public schema is also served by
-- its Data API; with RLS on and no policies, the anon and authenticated keys see
-- nothing. The app connects as the database owner, which RLS does not restrict.
ALTER TABLE song_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE lyric_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Rate limits shared by every server instance; they survive restarts and deploys.
-- Keys are SHA-256 hashes, so no IP address is stored.
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Songs per email per week: the address as it is compared (lower case, no +tag, Gmail dots removed).
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS email_normalized text;
CREATE INDEX IF NOT EXISTS song_requests_email_norm_idx ON song_requests(email_normalized, created_at);
UPDATE song_requests SET email_normalized = lower(trim(email)) WHERE email_normalized IS NULL AND email IS NOT NULL AND email <> '';
-- When unpurchased audio was deleted after the retention period.
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS previews_purged_at timestamptz;
CREATE INDEX IF NOT EXISTS song_requests_finalized_idx ON song_requests(candidates_finalized_at) WHERE previews_purged_at IS NULL
