-- Migration script: Move existing google_reviews to feedback_items
-- Run this after creating the feedback_items table
-- This preserves all existing data while moving to the new unified structure

INSERT INTO feedback_items (clinic_id, source_type, text, metadata, created_at, updated_at)
SELECT 
  clinic_name AS clinic_id,
  'google_review' AS source_type,
  text,
  jsonb_build_object(
    'external_id', external_id,
    'clinic_place_id', clinic_place_id,
    'author_name', author_name,
    'author_url', author_url,
    'rating', rating,
    'published_at', published_at::text,
    'response_text', response_text,
    'response_published_at', response_published_at::text,
    'raw_data', raw_data
  ) AS metadata,
  created_at,
  updated_at
FROM google_reviews
ON CONFLICT DO NOTHING; -- Skip duplicates if re-run

-- Optional: Also migrate articles if they exist
INSERT INTO feedback_items (clinic_id, source_type, text, metadata, created_at, updated_at)
SELECT 
  COALESCE(metadata->>'clinic_name', 'Unknown Clinic') AS clinic_id,
  CASE 
    WHEN source = 'blog' THEN 'blog_post'
    WHEN source IN ('press', 'article') THEN 'press_article'
    ELSE 'press_article'
  END AS source_type,
  COALESCE(description, content) AS text, -- Use description if available, fallback to content
  jsonb_build_object(
    'external_id', external_id,
    'title', title,
    'url', url,
    'author', author,
    'published_at', published_at::text,
    'source', source,
    'raw_html', raw_html,
    'metadata', metadata
  ) AS metadata,
  created_at,
  updated_at
FROM articles
WHERE NOT EXISTS (
  SELECT 1 FROM feedback_items 
  WHERE feedback_items.metadata->>'external_id' = articles.external_id
)
ON CONFLICT DO NOTHING;

-- Verify migration
SELECT 
  source_type,
  COUNT(*) as count,
  COUNT(DISTINCT clinic_id) as unique_clinics
FROM feedback_items
GROUP BY source_type;

