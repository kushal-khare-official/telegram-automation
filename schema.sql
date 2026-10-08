-- Omulimu: schema for an empty Postgres (Supabase) database.
-- Safe to run twice: every object uses IF NOT EXISTS and the seed uses ON CONFLICT.

-- 1. Youth profile. business_type is seeded, never asked for by the bot.
CREATE TABLE IF NOT EXISTS users (
  chat_id        bigint PRIMARY KEY,
  first_name     text,
  language       text        NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'lg', 'mixed')),
  business_type  text,
  needs_human    boolean     NOT NULL DEFAULT false,   -- set by the Care brain
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. Both sides of every chat. In rows are keyed on the Telegram update_id,
--    out rows on the in row they answer, so neither can be written twice.
CREATE TABLE IF NOT EXISTS messages (
  id                   bigserial   PRIMARY KEY,
  chat_id              bigint      NOT NULL REFERENCES users (chat_id) ON DELETE CASCADE,
  direction            text        NOT NULL CHECK (direction IN ('in', 'out')),
  text                 text,
  telegram_update_id   bigint,
  telegram_message_id  bigint,
  reply_to_id          bigint      REFERENCES messages (id) ON DELETE CASCADE,
  kind                 text        NOT NULL DEFAULT 'normal'
                       CHECK (kind IN ('normal', 'fallback', 'error', 'text_only', 'nudge')),
  status               text        NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received', 'processed', 'fallback', 'failed', 'ignored', 'sending', 'sent')),
  attempts             int         NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_telegram_update_id_key UNIQUE (telegram_update_id),
  CONSTRAINT messages_reply_to_id_key        UNIQUE (reply_to_id),
  CONSTRAINT messages_in_has_update  CHECK (direction = 'out' OR telegram_update_id IS NOT NULL),
  CONSTRAINT messages_out_no_update  CHECK (direction = 'in'  OR telegram_update_id IS NULL)
);
-- Chat history reads: last N rows of one chat.
CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages (chat_id, created_at DESC, id DESC);

-- 3. One classifier result per inbound message, for follow-up and evals.
CREATE TABLE IF NOT EXISTS routing_history (
  id                  bigserial    PRIMARY KEY,
  inbound_message_id  bigint       NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  route               text         NOT NULL
                      CHECK (route IN ('daily_numbers', 'business_question', 'wellbeing', 'menu_help')),
  reason              text,
  confidence          numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  language            text,
  entities            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  status              text         NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'repaired', 'fallback')),
  model               text,
  latency_ms          int,
  raw_output          text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT routing_history_inbound_message_id_key UNIQUE (inbound_message_id)
);
CREATE INDEX IF NOT EXISTS routing_history_route_idx ON routing_history (route, created_at DESC);

-- 4. At most one open session per chat (the primary key enforces it).
CREATE TABLE IF NOT EXISTS sessions (
  chat_id       bigint      PRIMARY KEY REFERENCES users (chat_id) ON DELETE CASCADE,
  active_brain  text        NOT NULL CHECK (active_brain IN ('numbers', 'care')),
  step          text        NOT NULL CHECK (step IN ('ask_sales', 'ask_expenses', 'open')),
  context       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_step_matches_brain CHECK (
    (active_brain = 'numbers' AND step IN ('ask_sales', 'ask_expenses')) OR
    (active_brain = 'care'    AND step = 'open')
  )
);

-- 5. One record per youth per Kampala business day. Re-sending replaces it.
CREATE TABLE IF NOT EXISTS daily_records (
  id            bigserial   PRIMARY KEY,
  chat_id       bigint      NOT NULL REFERENCES users (chat_id) ON DELETE CASCADE,
  record_date   date        NOT NULL,   -- (now() AT TIME ZONE 'Africa/Kampala')::date
  sales_ugx     bigint      NOT NULL CHECK (sales_ugx >= 0),
  expenses_ugx  bigint      NOT NULL CHECK (expenses_ugx >= 0),
  profit_ugx    bigint      NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_records_chat_date_key UNIQUE (chat_id, record_date),
  CONSTRAINT daily_records_profit_matches CHECK (profit_ugx = sales_ugx - expenses_ugx)
);

-- 6. Anything that went wrong and was handled (LLM failures, trimmed replies, send failures).
CREATE TABLE IF NOT EXISTS error_log (
  id                  bigserial   PRIMARY KEY,
  workflow            text        NOT NULL,
  node                text,
  inbound_message_id  bigint      REFERENCES messages (id) ON DELETE SET NULL,
  error               text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS error_log_created_idx ON error_log (created_at DESC);

-- Test seed: replace 123456789 with your own Telegram chat id (message @userinfobot to get it).
INSERT INTO users (chat_id, first_name, language, business_type)
VALUES (123456789, 'Tester', 'mixed', 'chapati stand in Nakasero')
ON CONFLICT (chat_id) DO UPDATE SET business_type = EXCLUDED.business_type;
