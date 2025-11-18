# Migration from Perplexity to Tavily

## What Changed

✅ **Replaced Perplexity API with Tavily API** - Tavily is a free, AI-powered search API that works great for news/articles scraping

## Files Updated

### Backend
- ✅ `src/ingestion/jobs/fetchTavilyInsightsJob.ts` - New job for Tavily insights
- ✅ `scripts/fetch-tavily-insights.ts` - Script to run Tavily job
- ✅ `supabase/functions/tavily-query/index.ts` - New edge function for on-demand Tavily queries
- ✅ `package.json` - Added `fetch:tavily:comprehensive` and `fetch:tavily:recent` scripts

### Frontend
- ✅ `web/nekovibe/app.js` - Updated to use `tavily-query` instead of `perplexity-query`
- ✅ Button text changed from "Run another Perplexity query" to "Run another web search"

### GitHub Actions
- ✅ `.github/workflows/daily-refresh.yml` - Uses `TAVILY_API_KEY` and `fetch:tavily:recent`
- ✅ `.github/workflows/weekly-perplexity.yml` - Renamed to use Tavily (kept filename for now)

### Database
- ✅ Still uses `perplexity_insights` table (no schema changes needed)
- ✅ Metadata includes `provider: 'tavily'` to track source

## Next Steps

1. **Get Tavily API Key**:
   - Sign up at https://tavily.com/
   - Copy your API key

2. **Add to Supabase**:
   - Edge Functions → `tavily-query` → Settings → Secrets
   - Add: `TAVILY_API_KEY` = `your-key`

3. **Add to GitHub**:
   - Repo → Settings → Secrets → Actions
   - Add: `TAVILY_API_KEY` = `your-key`

4. **Deploy Edge Function**:
   - Copy code from `supabase/functions/tavily-query/index.ts`
   - Create new function `tavily-query` in Supabase
   - Add the secret and deploy

5. **Test**:
   ```bash
   npm run fetch:tavily:recent
   npm run fetch:tavily:comprehensive
   ```

## Benefits

- ✅ **Free tier**: 1,000 searches/month
- ✅ **AI-powered**: Returns summaries and citations
- ✅ **Fast**: Good response times
- ✅ **Reliable**: No API key issues (unlike Perplexity)

## Compatibility

- Same database table structure
- Same frontend UX (just different API)
- Same workflow schedules (daily/weekly)

