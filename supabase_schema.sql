-- ============================================================
-- RAGdoc Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id   TEXT UNIQUE NOT NULL,
    email           TEXT NOT NULL,
    name            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── pdfs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pdfs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    filename            TEXT NOT NULL,
    pinecone_namespace  TEXT NOT NULL,
    upload_date         TIMESTAMPTZ DEFAULT NOW(),
    file_size           BIGINT DEFAULT 0
);

-- ── chat_history ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── user_settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT UNIQUE NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    theme        TEXT DEFAULT 'light',
    preferences  JSONB DEFAULT '{}',
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pdfs_user_id         ON pdfs(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id  ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created  ON chat_history(created_at DESC);

-- ── Enable RLS ────────────────────────────────────────────────
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdfs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies (service_role bypasses RLS) ──────────────────
-- users: each user sees only their own row
CREATE POLICY "users_own" ON users
    FOR ALL USING (clerk_user_id = current_setting('app.clerk_user_id', TRUE));

-- pdfs: each user sees only their own PDFs
CREATE POLICY "pdfs_own" ON pdfs
    FOR ALL USING (user_id = current_setting('app.clerk_user_id', TRUE));

-- chat_history: each user sees only their own history
CREATE POLICY "chat_own" ON chat_history
    FOR ALL USING (user_id = current_setting('app.clerk_user_id', TRUE));

-- user_settings: each user sees only their own settings
CREATE POLICY "settings_own" ON user_settings
    FOR ALL USING (user_id = current_setting('app.clerk_user_id', TRUE));
