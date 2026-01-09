# Internal Reviews Setup Guide

## Step 1: Create Database Tables (REQUIRED FIRST)

**⚠️ IMPORTANT: Run this SQL BEFORE deploying the edge functions!**

1. Go to **Supabase Dashboard → SQL Editor**
2. Copy and paste the entire contents of `supabase/schema_internal_reviews.sql`
3. Click **Run**

This creates:
- `internal_reviews` table (stores uploaded reviews)
- `internal_review_summaries` table (stores AI-generated summaries)

## Step 2: Deploy Edge Functions

### Function 1: `upload-internal-reviews`

1. Go to **Supabase Dashboard → Edge Functions**
2. Click **"Create new function"** (or edit if it exists)
3. Name it: `upload-internal-reviews`
4. Copy the entire code from the function I provided earlier
5. Click **Deploy**

### Function 2: `internal-reviews-chat`

1. Go to **Supabase Dashboard → Edge Functions**
2. Click **"Create new function"** (or edit if it exists)
3. Name it: `internal-reviews-chat`
4. Copy the entire code from the function I provided earlier
5. Click **Deploy**

## Step 3: Set Environment Variables

For **both** functions, set these environment variables in **Supabase Dashboard → Edge Functions → Settings**:

- `SUPABASE_URL` (auto-provided)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)
- `OPENAI_API_KEY` (set manually - required for summaries and chat)
- `OPENAI_MODEL` (optional - defaults to `gpt-4o-mini`)

## Step 4: Test

1. Open your frontend
2. Click the **"Internal Reviews"** tab
3. Enter password: `nekovibe1`
4. Try uploading a CSV file with columns: Date, Rating, Clinic, Comment

## Troubleshooting

### Error: "relation 'internal_reviews' does not exist"
- **Solution**: You haven't run the SQL schema yet. Go to Step 1 above.

### Error: "duplicate key value violates unique constraint"
- **Solution**: This is normal - it means the review already exists (duplicate detection working).

### CSV upload fails
- **Check**: CSV must have columns named: Date, Rating, Clinic, Comment (or similar variations)
- **Check**: Dates must be valid (after year 2000)
- **Check**: Ratings must be 1-5

### Chat not working
- **Check**: `OPENAI_API_KEY` is set in edge function environment variables
- **Check**: Edge function is deployed successfully

