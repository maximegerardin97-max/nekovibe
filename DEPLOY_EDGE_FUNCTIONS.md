# Edge Functions Deployment Checklist

## What to Deploy

All code is in the repo and ready to copy-paste. Follow this order:

---

## 1. `nekovibe-chat` Edge Function

**File to copy:** `supabase/functions/nekovibe-chat/index.ts`

**What it does:**
- Main chat function
- Fetches summaries + Perplexity insights (only if articles selected)
- Handles fallback queries
- Rating-aware analysis

**Environment variables needed:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)

**Deploy steps:**
1. Go to Supabase Dashboard → Edge Functions → `nekovibe-chat`
2. Click "Edit"
3. Copy **ENTIRE** contents of `supabase/functions/nekovibe-chat/index.ts`
4. Paste into editor
5. Click "Deploy"

---

## 2. `perplexity-query` Edge Function

**File to copy:** `supabase/functions/perplexity-query/index.ts`

**What it does:**
- On-demand Perplexity web searches
- Returns placeholder if API key not set
- Context-aware queries about Neko Health

**Environment variables needed:**
- `PERPLEXITY_API_KEY` (optional - will show placeholder if missing)

**Deploy steps:**
1. Go to Supabase Dashboard → Edge Functions
2. Click "Create new function"
3. Name it: `perplexity-query`
4. Copy **ENTIRE** contents of `supabase/functions/perplexity-query/index.ts`
5. Paste into editor
6. Click "Deploy"
7. Add `PERPLEXITY_API_KEY` to environment variables (when available)

---

## 3. `generate-summaries` Edge Function

**File to copy:** `supabase/functions/generate-summaries/index.ts`

**What it does:**
- Generates LLM summaries for feedback items
- Runs nightly via GitHub Actions
- Creates summaries for all clinics, sources, and scopes

**Environment variables needed:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)

**Deploy steps:**
1. Go to Supabase Dashboard → Edge Functions → `generate-summaries`
2. Click "Edit"
3. Copy **ENTIRE** contents of `supabase/functions/generate-summaries/index.ts`
4. Paste into editor
5. Click "Deploy"

---

## Verification

After deploying, test:

1. **Chat function:**
   - Ask a question with only "Reviews" selected → should work, no Perplexity
   - Ask a question with "Articles/Press" selected → should include Perplexity insights (or placeholder)
   - Click "Query full dataset" → should work

2. **Perplexity function:**
   - Click "Run another Perplexity query" (when Articles selected) → should return placeholder or real data

3. **Summaries function:**
   - Run manually or wait for nightly job → should generate summaries

---

## Current Code Status

✅ All edge functions are in the repo and ready to deploy
✅ Latest commit: `be0cb6a` - "Only fetch Perplexity insights when Articles/Press source is selected"
✅ Import fix applied: Using `@supabase/supabase-js@2` instead of specific version
✅ Perplexity handling: Graceful placeholders when unavailable

