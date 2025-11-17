# Quick Start Guide

## 1. Install Dependencies

```bash
npm install
```

## 2. Set Up Environment

Create a `.env` file in the project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
GOOGLE_PLACES_IDS=https://maps.google.com/...,https://maps.google.com/...
GOOGLE_PLACES_API_KEY=your_google_places_api_key
```

**To get your Supabase credentials:**
- Go to your Supabase project dashboard
- Settings → API
- Copy the "Project URL" and "service_role" key

**To get Google Places API key + clinic URLs:**
- In Google Cloud Console, enable the Places API and create an API key
- Find each clinic on Google Maps and copy the full URL into `GOOGLE_PLACES_IDS`
- The ingestion job will resolve the actual Place IDs automatically

## 3. Set Up Database

1. Go to your Supabase project
2. Navigate to SQL Editor
3. Copy and paste the contents of `supabase/schema.sql`
4. Run the SQL

This creates the `google_reviews` and `articles` tables.

## 4. Install Playwright Browsers

```bash
npx playwright install chromium
```

## 5. Run Ingestion Jobs

```bash
# Fetch Google Reviews
npm run fetch:reviews

# Fetch Articles/Blogs/Press
npm run fetch:articles

# Run both
npm run fetch:all

# Start daily Google Reviews job (runs at 06:00 UTC)
npm run schedule:reviews
```

## Troubleshooting

**"Missing Supabase configuration"**
- Make sure `.env` file exists and has correct values

**"No clinic place IDs configured"**
- Add `GOOGLE_PLACES_IDS` to `.env` (comma-separated)

**Playwright errors**
- Run `npx playwright install chromium`

**Database errors**
- Make sure you've run `supabase/schema.sql` in Supabase SQL Editor

