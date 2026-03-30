-- ============================================================
-- Review Topics Table
-- Run in Supabase SQL editor once, before running generate-topics.
-- ============================================================

CREATE TABLE IF NOT EXISTS review_topics (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  sentiment   TEXT DEFAULT 'mixed' CHECK (sentiment IN ('positive', 'negative', 'mixed')),
  keywords    TEXT[] DEFAULT '{}',
  review_count INT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_topics_sentiment ON review_topics(sentiment);
CREATE INDEX IF NOT EXISTS idx_review_topics_count     ON review_topics(review_count DESC);

ALTER TABLE review_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access for review_topics" ON review_topics;
CREATE POLICY "Public read access for review_topics"
  ON review_topics FOR SELECT TO anon USING (true);
