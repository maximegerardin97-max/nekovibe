# How to Call the Fetch Functions

## Quick Method: Browser Console

1. Go to your site: https://maximegerardin97-max.github.io/nekovibe/
2. Open browser console (F12 or Cmd+Option+I)
3. Run these commands:

```javascript
// Fetch Articles
fetch('https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/fetch-articles', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbG9wc3FxcXp6a2ZwbWNudGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjUxNDMsImV4cCI6MjA3ODcwMTE0M30.J3vuzmF7cG3e6ZMx_NwHtmTIqQKJvKP1cGOXcoXBaX0',
    'Content-Type': 'application/json'
  }
}).then(r => r.json()).then(console.log);

// Fetch LinkedIn Posts
fetch('https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/fetch-linkedin', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbG9wc3FxcXp6a2ZwbWNudGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjUxNDMsImV4cCI6MjA3ODcwMTE0M30.J3vuzmF7cG3e6ZMx_NwHtmTIqQKJvKP1cGOXcoXBaX0',
    'Content-Type': 'application/json'
  }
}).then(r => r.json()).then(console.log);
```

## Option 2: Using curl

```bash
# Fetch Articles
curl -X POST https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/fetch-articles \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbG9wc3FxcXp6a2ZwbWNudGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjUxNDMsImV4cCI6MjA3ODcwMTE0M30.J3vuzmF7cG3e6ZMx_NwHtmTIqQKJvKP1cGOXcoXBaX0" \
  -H "Content-Type: application/json"

# Fetch LinkedIn Posts
curl -X POST https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/fetch-linkedin \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbG9wc3FxcXp6a2ZwbWNudGJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjUxNDMsImV4cCI6MjA3ODcwMTE0M30.J3vuzmF7cG3e6ZMx_NwHtmTIqQKJvKP1cGOXcoXBaX0" \
  -H "Content-Type: application/json"
```

## Option 3: Supabase Dashboard

1. Go to Supabase Dashboard → Edge Functions
2. Click on `fetch-articles` → "Invoke function"
3. Click on `fetch-linkedin` → "Invoke function"

## What Happens Next?

1. **Functions fetch data** from GNews API (articles) and Tavily API (LinkedIn)
2. **Data is stored** in the `articles` table in Supabase
3. **Frontend automatically displays** the data in the "Articles / Press / LinkedIn" tab
4. **You can filter** by source (blog, press, article, linkedin)
5. **Chat can use the data** - the articles chat will have access to all stored articles/posts

## Expected Response

```json
{
  "success": true,
  "added": 5,
  "skipped": 2,
  "total_found": 7,
  "errors": []
}
```

