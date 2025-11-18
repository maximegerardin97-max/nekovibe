# Deployment Guide

## Prerequisites

- Supabase account and project
- GitHub account
- Supabase CLI (optional, for easier deployment)

## Step 1: Push to GitHub

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Nekovibe brand intelligence platform"

# Create a new repository on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/nekovibe.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy Edge Functions to Supabase

### Option A: Using Supabase Dashboard (Recommended)

1. Go to **Supabase Dashboard → Edge Functions**
2. For each function (`nekovibe-chat` and `generate-summaries`):
   - Click on the function name
   - Click **"Edit"** or **"Deploy"**
   - Copy the entire code from `supabase/functions/[function-name]/index.ts`
   - Paste into the editor
   - Click **"Deploy"**

### Option B: Using Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy functions
supabase functions deploy nekovibe-chat
supabase functions deploy generate-summaries
```

## Step 3: Set Environment Variables

In **Supabase Dashboard → Edge Functions → Settings**, set:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your service role key (from Settings → API)
- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_MODEL`: `gpt-4o-mini` (or your preferred model)

## Step 4: Deploy Frontend

### Option A: Static Hosting (Netlify, Vercel, etc.)

1. Connect your GitHub repo
2. Set build directory to `web/nekovibe`
3. Add environment variables:
   - `VITE_SUPABASE_URL`: Your Supabase URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anon key

### Option B: Update HTML with Your Keys

Edit `web/nekovibe/index.html`:
- Replace `YOUR_SUPABASE_URL` with your actual Supabase URL
- Replace `YOUR_SUPABASE_ANON_KEY` with your Supabase anon key

Then host the `web/nekovibe` folder on any static hosting service.

## Step 5: Initialize Database

Run the SQL files in order:

1. `supabase/schema.sql` - Base tables
2. `supabase/schema_feedback.sql` - Feedback system tables
3. `supabase/migrate_to_feedback_items.sql` - Migrate existing data (if any)

## Step 6: Generate Summaries

After deploying, generate summaries:

```bash
# Using the script
npm run generate:summaries

# Or manually via curl (see GENERATE_SUMMARIES.md)
```

## Troubleshooting

- **Edge Function timeout**: Use the clinic-by-clinic generation script (`GENERATE_BY_CLINIC.sh`)
- **Missing data**: Check that ingestion scripts have run (`npm run fetch:all`)
- **Frontend not connecting**: Verify API keys in `index.html` match your Supabase project

## Automated Daily Refresh

A GitHub Actions workflow (`.github/workflows/daily-refresh.yml`) keeps `feedback_items` and `feedback_summaries` up to date.

1. In your repository settings → **Secrets and variables → Actions**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_PLACES_API_KEY`
   - `GOOGLE_PLACES_IDS` (comma-separated list, same format as `.env`)
2. The workflow runs every day at 00:00 UTC (and can be triggered manually via the **Run workflow** button).
3. Steps performed:
   - Install dependencies
   - Run `scripts/fetch-google-reviews.ts` (ingests latest reviews into `google_reviews` + `feedback_items`)
   - Run `scripts/generate-summaries.ts` (refreshes all feedback summaries)

Adjust the cron expression in the workflow if you need a different schedule.

