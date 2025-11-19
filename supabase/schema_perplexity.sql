-- Perplexity Insights Table
-- Stores comprehensive and recent Perplexity API responses about Neko Health

CREATE TABLE IF NOT EXISTS perplexity_insights (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('comprehensive', 'last_7_days', 'gnews_comprehensive', 'gnews_last_7_days')),
  query_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  citations JSONB DEFAULT '[]', -- Array of {url, title, published_at}
  metadata JSONB DEFAULT '{}', -- Store model, tokens used, etc.
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Only one row per scope (upsert on refresh)
  CONSTRAINT perplexity_insights_unique UNIQUE (scope)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_perplexity_insights_scope ON perplexity_insights(scope);
CREATE INDEX IF NOT EXISTS idx_perplexity_insights_refreshed ON perplexity_insights(last_refreshed_at DESC);

