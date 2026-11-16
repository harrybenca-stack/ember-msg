-- Messenger (Vercel variant) — Neon Postgres schema, REFERENCE ONLY.
-- You do not need to run this by hand: api/_db.js creates all of this
-- idempotently (CREATE TABLE IF NOT EXISTS) on the first request of a cold
-- instance (ensureInit), mirroring the Pishmashool pattern. This file exists
-- so the schema can be reviewed / pre-created in the Neon SQL editor if
-- Parsa ever wants to.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  pass TEXT NOT NULL,            -- scrypt "salt:hash", same format as the standalone app
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  UNIQUE (user_id, contact_id)
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,         -- 'msg' (message seq/updatedSeq), 'sig' (signal sseq)
  value BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,           -- client-generated UUID; unique = offline-queue dedupe
  seq BIGINT NOT NULL,
  updated_seq BIGINT NOT NULL,
  chat TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- text | voice | photo | call
  text TEXT NOT NULL DEFAULT '',
  media TEXT,                    -- '/uploads/<uuid>.<ext>' for voice/photo
  call_info JSONB,               -- {kind, outcome, durationSec} for type='call'
  reply_to JSONB,                -- quote snapshot
  edited BOOLEAN NOT NULL DEFAULT false,
  deleted BOOLEAN NOT NULL DEFAULT false,
  reaction JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {userId: emoji}
  delivered_at DOUBLE PRECISION, -- epoch ms (float8 so the driver returns a JS number)
  seen_at DOUBLE PRECISION,
  ts DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_seq_idx ON messages (seq);
CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (from_id, to_id);

CREATE TABLE IF NOT EXISTS signals (
  sseq BIGINT PRIMARY KEY,
  to_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- offer | answer | ice | end | decline | busy
  payload JSONB,
  call_id TEXT,
  media TEXT,                    -- voice | video
  ts DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS typing (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  expires_at DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS uploads (
  name TEXT PRIMARY KEY,         -- '<uuid>.<ext>'
  mime TEXT NOT NULL,
  data TEXT NOT NULL             -- base64 payload (photos pre-compressed client-side, voice clips small)
);
