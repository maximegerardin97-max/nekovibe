-- Internal Reviews Schema
-- Separate table for internal reviews - completely isolated from public reviews
-- Run this SQL in your Supabase SQL Editor

-- Internal Reviews Table
CREATE TABLE IF NOT EXISTS internal_reviews (
  id BIGSERIAL PRIMARY KEY,
  review_hash TEXT NOT NULL, -- Hash of date+rating+clinic+comment for duplicate detection
  published_at TIMESTAMPTZ NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  clinic_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  upload_batch_id TEXT, -- Track which CSV upload this came from
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure uniqueness per review
  UNIQUE(review_hash)
);

-- Internal Review Summaries Table
CREATE TABLE IF NOT EXISTS internal_review_summaries (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('all_time', 'latest_upload', 'last_week', 'last_month')),
  summary_text TEXT NOT NULL,
  reviews_covered_count INTEGER DEFAULT 0,
  upload_batch_id TEXT, -- For latest_upload scope
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one summary per scope
  CONSTRAINT internal_review_summaries_unique UNIQUE (scope, upload_batch_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_internal_reviews_published_at ON internal_reviews(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_reviews_rating ON internal_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_internal_reviews_clinic_name ON internal_reviews(clinic_name);
CREATE INDEX IF NOT EXISTS idx_internal_reviews_upload_batch_id ON internal_reviews(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_internal_reviews_uploaded_at ON internal_reviews(uploaded_at DESC);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_internal_reviews_comment_search ON internal_reviews USING gin(to_tsvector('english', comment));

-- Updated_at trigger
CREATE TRIGGER update_internal_reviews_updated_at BEFORE UPDATE ON internal_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_internal_review_summaries_updated_at BEFORE UPDATE ON internal_review_summaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE internal_reviews IS 'Stores internal reviews uploaded via CSV - completely separate from public reviews';
COMMENT ON TABLE internal_review_summaries IS 'Pre-computed summaries of internal reviews for fast chat responses';
COMMENT ON COLUMN internal_reviews.review_hash IS 'Hash of date+rating+clinic+comment for duplicate detection';
COMMENT ON COLUMN internal_reviews.upload_batch_id IS 'Identifier for the CSV upload batch';

