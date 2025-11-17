# Feedback System Setup Guide

This guide explains how to set up and use the new unified feedback system that makes Q&A fast and uses all data.

## Overview

The system uses a two-layer approach:
1. **Raw data** in `feedback_items` table (unified storage for reviews, articles, social posts)
2. **Pre-computed summaries** in `feedback_summaries` table (LLM-generated summaries by clinic/source/scope)

The chat function now:
- Fetches relevant summaries (fast, covers all data)
- Performs targeted text search for specific examples
- Makes **1 LLM call** instead of 10+ (much faster!)

## Setup Steps

### 1. Create New Tables

Run the SQL in `supabase/schema_feedback.sql` in your Supabase SQL Editor:

```sql
-- This creates:
-- - feedback_items (unified raw data)
-- - feedback_summaries (pre-computed summaries)
```

### 2. Migrate Existing Data

Run the migration script `supabase/migrate_to_feedback_items.sql`:

```sql
-- This moves:
-- - google_reviews → feedback_items (source_type: 'google_review')
-- - articles → feedback_items (source_type: 'press_article' or 'blog_post')
```

### 3. Deploy Edge Functions

Deploy both edge functions to Supabase:

```bash
# Deploy summary generator
supabase functions deploy generate-summaries

# Deploy updated chat function
supabase functions deploy nekovibe-chat
```

Set environment variables for both functions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)
- `NEKOVIBE_SUMMARY_MAX_ITEMS` (optional, defaults to 500)
- `NEKOVIBE_SEARCH_MAX_RESULTS` (optional, defaults to 30)

### 4. Generate Initial Summaries

Call the summary generator to create summaries for all combinations:

**Option A: Via HTTP request**
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/generate-summaries \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Option B: Via Supabase Dashboard**
- Go to Edge Functions → `generate-summaries` → Invoke
- Leave body empty `{}` to generate all summaries

This will create summaries for:
- Global (all clinics, all sources)
- Per clinic (all sources)
- Per clinic + source type
- Both `all_time` and `last_90_days` scopes

### 5. Set Up Nightly Refresh (Optional)

Use Supabase Cron or an external scheduler to refresh summaries nightly:

```sql
-- Example: Supabase Cron (if enabled)
SELECT cron.schedule(
  'refresh-feedback-summaries',
  '0 2 * * *', -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/generate-summaries',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Or use a simple cron job on your server:
```bash
0 2 * * * curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/generate-summaries \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Usage

### Generating Specific Summaries

To generate/refresh a specific summary:

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/generate-summaries \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clinic_id": "Neko Health Marylebone",
    "source_type": "google_review",
    "scope": "last_90_days",
    "force_refresh": true
  }'
```

### Using the Chat Function

The chat function now automatically:
1. Detects clinic and source type from the prompt
2. Fetches relevant summaries
3. Performs targeted text search
4. Generates answer in **1 LLM call** (fast!)

Example prompts:
- "What do people say about Marylebone?" → Uses Marylebone summaries + search
- "Overall experience at Neko Health" → Uses global summaries
- "Waiting times at Spitalfields" → Uses Spitalfields summaries + targeted search

## Performance

**Before (old system):**
- 400 reviews → 10 chunks → 10 sequential OpenAI calls → 30-60+ seconds
- Only used first chunk if timeout occurred

**After (new system):**
- Fetches 3-6 summaries (pre-computed, covers all data)
- Fetches 10-30 targeted search results
- **1 OpenAI call** → **2-4 seconds** ⚡

## Adding New Sources

When you add new source types (e.g., social posts):

1. **Ingest data** into `feedback_items` with `source_type = 'social_post'`
2. **Generate summaries** by calling the summary generator:
   ```json
   {
     "source_type": "social_post",
     "scope": "all_time"
   }
   ```
3. **Chat function automatically supports it** - no code changes needed!

## Troubleshooting

### "No summaries found"
- Run the summary generator first
- Check that `feedback_summaries` table has data

### "Search returns no results"
- Check that `feedback_items` has data
- Verify keywords are being extracted correctly (check logs)

### Summaries are stale
- Run summary generator with `force_refresh: true`
- Set up nightly refresh cron job

## Future Enhancements

- **Vector search**: Replace keyword search with embeddings for better semantic matching
- **Caching**: Cache summaries in Redis for even faster responses
- **Streaming**: Stream LLM responses for better UX
- **Analytics**: Track which summaries/clinics are queried most

