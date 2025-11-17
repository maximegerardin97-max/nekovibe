-- Unified Feedback System Schema
-- Run this SQL in your Supabase SQL Editor to add the new tables
-- This extends the existing schema to support a scalable Q&A system

-- Unified feedback items table (replaces direct queries to google_reviews/articles)
CREATE TABLE IF NOT EXISTS feedback_items (
  id BIGSERIAL PRIMARY KEY,
  clinic_id TEXT NOT NULL, -- Clinic identifier (e.g., "Neko Health Marylebone")
  source_type TEXT NOT NULL CHECK (source_type IN ('google_review', 'press_article', 'social_post', 'blog_post')),
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', -- Stores: rating, url, author, date, language, external_id, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index for feedback_items (can't use JSONB operator in constraint, so use index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_items_unique 
ON feedback_items ((metadata->>'external_id'), clinic_id, source_type)
WHERE metadata->>'external_id' IS NOT NULL;

-- Summaries table for pre-computed LLM summaries
CREATE TABLE IF NOT EXISTS feedback_summaries (
  id BIGSERIAL PRIMARY KEY,
  clinic_id TEXT, -- NULL for global summaries
  source_type TEXT, -- NULL for "all sources" summaries
  scope TEXT NOT NULL CHECK (scope IN ('all_time', 'last_90_days', 'last_30_days', 'last_7_days')),
  summary_text TEXT NOT NULL,
  items_covered_count INTEGER DEFAULT 0,
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one summary per combination
  CONSTRAINT feedback_summaries_unique UNIQUE (clinic_id, source_type, scope)
);

-- Unique index for feedback_items (can't use JSONB operator in constraint, so use index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_items_unique 
ON feedback_items ((metadata->>'external_id'), clinic_id, source_type)
WHERE metadata->>'external_id' IS NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_feedback_items_clinic_id ON feedback_items(clinic_id);
CREATE INDEX IF NOT EXISTS idx_feedback_items_source_type ON feedback_items(source_type);
CREATE INDEX IF NOT EXISTS idx_feedback_items_created_at ON feedback_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_items_clinic_source ON feedback_items(clinic_id, source_type);

CREATE INDEX IF NOT EXISTS idx_feedback_summaries_clinic_id ON feedback_summaries(clinic_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_source_type ON feedback_summaries(source_type);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_scope ON feedback_summaries(scope);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_lookup ON feedback_summaries(clinic_id, source_type, scope);

-- Full-text search index for feedback_items
CREATE INDEX IF NOT EXISTS idx_feedback_items_text_search ON feedback_items USING gin(to_tsvector('english', text));

-- Updated_at trigger for feedback_items
CREATE TRIGGER update_feedback_items_updated_at BEFORE UPDATE ON feedback_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for feedback_summaries
CREATE TRIGGER update_feedback_summaries_updated_at BEFORE UPDATE ON feedback_summaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE feedback_items IS 'Unified table for all feedback: Google reviews, press articles, social posts, etc.';
COMMENT ON TABLE feedback_summaries IS 'Pre-computed LLM summaries of feedback, organized by clinic, source, and time scope';
COMMENT ON COLUMN feedback_items.clinic_id IS 'Clinic identifier (e.g., "Neko Health Marylebone")';
COMMENT ON COLUMN feedback_items.source_type IS 'Type of feedback: google_review, press_article, social_post, blog_post';
COMMENT ON COLUMN feedback_items.metadata IS 'JSONB with source-specific fields: rating, url, author, date, language, external_id, etc.';
COMMENT ON COLUMN feedback_summaries.clinic_id IS 'Clinic identifier, or NULL for global summaries';
COMMENT ON COLUMN feedback_summaries.source_type IS 'Source type, or NULL for "all sources" summaries';
COMMENT ON COLUMN feedback_summaries.scope IS 'Time scope: all_time, last_90_days, last_30_days, last_7_days';

