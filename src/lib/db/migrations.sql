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

-- Story quiz v2
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS giver_name text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS one_line text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS leave_out text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS feeling text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS needed_by text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS story_answers jsonb;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS auto_generate boolean NOT NULL DEFAULT false;
ALTER TABLE song_requests ADD COLUMN IF NOT EXISTS unlocked boolean NOT NULL DEFAULT false;
