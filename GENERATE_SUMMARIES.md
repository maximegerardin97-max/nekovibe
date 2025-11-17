# Generate Summaries - Quick Guide

## Option 1: Using npm script (easiest)

Make sure your `.env` file has:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Then run:
```bash
npm run generate:summaries
```

## Option 2: Using curl (if you prefer)

Replace `YOUR_PROJECT_URL` and `YOUR_SERVICE_ROLE_KEY`:

```bash
curl -X POST https://YOUR_PROJECT_URL.supabase.co/functions/v1/generate-summaries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -d '{}'
```

## Option 3: Direct from Supabase SQL Editor

If your Supabase has the `net` extension enabled, you can run this SQL:

```sql
SELECT net.http_post(
  url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/generate-summaries',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
  ),
  body := '{}'::jsonb
);
```

**Note:** Replace `YOUR_PROJECT_URL` and `YOUR_SERVICE_ROLE_KEY` with your actual values.

---

**Expected time:** 5-10 minutes (generates summaries for all combinations)

**Check progress:** Look at the `feedback_summaries` table in Supabase - rows will appear as summaries are generated.

