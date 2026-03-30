-- ============================================================
-- Trustpilot Reviews Table
-- Run this in your Supabase SQL editor before the first
-- Trustpilot ingestion run.
-- ============================================================

CREATE TABLE IF NOT EXISTS trustpilot_reviews (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  clinic_name TEXT NOT NULL,
  author_name TEXT,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title       TEXT,
  text        TEXT,
  published_at TIMESTAMPTZ,
  raw_data    JSONB,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trustpilot_reviews_clinic      ON trustpilot_reviews(clinic_name);
CREATE INDEX IF NOT EXISTS idx_trustpilot_reviews_published   ON trustpilot_reviews(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_trustpilot_reviews_rating      ON trustpilot_reviews(rating);

-- Updated-at trigger (reuses function if it already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_trustpilot_reviews_updated_at ON trustpilot_reviews;
CREATE TRIGGER update_trustpilot_reviews_updated_at
  BEFORE UPDATE ON trustpilot_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security: allow anonymous reads (same as google_reviews)
ALTER TABLE trustpilot_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for trustpilot_reviews" ON trustpilot_reviews;
CREATE POLICY "Public read access for trustpilot_reviews"
  ON trustpilot_reviews FOR SELECT TO anon USING (true);

-- ============================================================
-- Unified public_reviews view (Google + Trustpilot)
-- Used by the frontend "All Sources" filter.
-- ============================================================

CREATE OR REPLACE VIEW public_reviews AS
SELECT
  external_id,
  clinic_name,
  author_name,
  rating,
  text,
  published_at,
  'google'::TEXT AS source
FROM google_reviews
UNION ALL
SELECT
  external_id,
  clinic_name,
  author_name,
  rating,
  text,
  published_at,
  'trustpilot'::TEXT AS source
FROM trustpilot_reviews;
