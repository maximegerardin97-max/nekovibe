-- Brand Intelligence Platform - Database Schema
-- Run this SQL in your Supabase SQL Editor to create the required tables

-- Google Reviews Table
CREATE TABLE IF NOT EXISTS google_reviews (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL,
  clinic_place_id TEXT NOT NULL,
  clinic_name TEXT NOT NULL DEFAULT 'Unknown Clinic',
  author_name TEXT NOT NULL,
  author_url TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  text TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  response_text TEXT,
  response_published_at TIMESTAMPTZ,
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure uniqueness per review
  UNIQUE(external_id, clinic_place_id)
);

-- Articles Table
CREATE TABLE IF NOT EXISTS articles (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL, -- 'blog', 'press', 'article', etc.
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  author TEXT,
  published_at TIMESTAMPTZ,
  content TEXT NOT NULL,
  raw_html TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_google_reviews_clinic_place_id ON google_reviews(clinic_place_id);
CREATE INDEX IF NOT EXISTS idx_google_reviews_published_at ON google_reviews(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_reviews_rating ON google_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_google_reviews_external_id ON google_reviews(external_id);

CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_external_id ON articles(external_id);

-- Full-text search indexes (optional, for future LLM analysis)
CREATE INDEX IF NOT EXISTS idx_google_reviews_text_search ON google_reviews USING gin(to_tsvector('english', text));
CREATE INDEX IF NOT EXISTS idx_articles_content_search ON articles USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_articles_title_search ON articles USING gin(to_tsvector('english', title));

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_google_reviews_updated_at BEFORE UPDATE ON google_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE google_reviews IS 'Stores Google Reviews for Neko clinics';
COMMENT ON TABLE articles IS 'Stores articles, blog posts, and press mentions about Neko';
COMMENT ON COLUMN google_reviews.external_id IS 'Unique identifier from Google (review ID)';
COMMENT ON COLUMN google_reviews.clinic_place_id IS 'Google Places ID for the clinic';
COMMENT ON COLUMN google_reviews.clinic_name IS 'Human readable clinic name';
COMMENT ON COLUMN articles.external_id IS 'Unique identifier (typically the URL)';
COMMENT ON COLUMN articles.source IS 'Type of source: blog, press, article, etc.';

