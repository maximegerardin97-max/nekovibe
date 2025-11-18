# Tavily API Setup Guide

Tavily is an AI-powered search API that's a great alternative to Perplexity. It provides comprehensive web search with citations and summaries.

## 1. Get Your Tavily API Key

1. Go to https://tavily.com/
2. Sign up for a free account
3. Navigate to your dashboard and copy your API key
4. Free tier includes:
   - 1,000 searches/month
   - Advanced search depth
   - AI-generated answers

## 2. Add API Key to Supabase

1. Go to your Supabase project → Edge Functions
2. Open the `tavily-query` function
3. Go to Settings → Secrets
4. Add: `TAVILY_API_KEY` = `your-api-key-here`
5. Redeploy the function

## 3. Add API Key to GitHub Actions

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add a new secret: `TAVILY_API_KEY` = `your-api-key-here`

## 4. Test Locally

Add to your `.env` file:
```
TAVILY_API_KEY=your-api-key-here
```

Then test:
```bash
npm run fetch:tavily:recent
npm run fetch:tavily:comprehensive
```

## 5. Deploy Edge Function

The `tavily-query` edge function is ready to deploy. Copy the code from:
- `supabase/functions/tavily-query/index.ts`

Deploy it in Supabase:
1. Edge Functions → Create new function
2. Name: `tavily-query`
3. Paste the code
4. Add the `TAVILY_API_KEY` secret
5. Deploy

## 6. Update Frontend

The frontend is already updated to use Tavily. Just make sure:
- The button text says "Run another web search" (already done)
- The function URL points to `/tavily-query` (already done)

## How It Works

- **Daily**: Fetches latest 7-day news/articles about Neko Health
- **Weekly**: Comprehensive market analysis and trends
- **On-demand**: Users can click "Run another web search" to query Tavily with their specific question

All insights are stored in the `perplexity_insights` table (we kept the same table structure for compatibility).

