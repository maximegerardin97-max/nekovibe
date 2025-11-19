# How to Test GitHub Actions Workflow

## Option 1: Manual Trigger (Recommended)

1. Go to your GitHub repository: `https://github.com/maximegerardin97-max/nekovibe`
2. Click on the **"Actions"** tab
3. In the left sidebar, click **"Daily Feedback Refresh"**
4. Click the **"Run workflow"** button (top right)
5. Select the branch: **"main"**
6. Click **"Run workflow"**

This will immediately trigger the workflow and you can watch it run in real-time.

## Option 2: Check Next Scheduled Run

The workflow runs automatically every day at **00:00 UTC** (midnight UTC).

To see when it will run next:
- Go to Actions tab
- Click on "Daily Feedback Refresh"
- Check the scheduled runs

## What to Look For

✅ **Success indicators:**
- All steps show green checkmarks
- "Fetch latest Google reviews" completes successfully
- "Fetch Tavily recent insights" completes successfully  
- "Generate/refresh summaries" completes successfully

❌ **Failure indicators:**
- Red X marks on any step
- Error messages in the logs
- "Missing Supabase configuration" error (means secrets aren't set correctly)

## Check the Logs

Click on any step to see detailed logs:
- Look for "✅ Added: X" in Google Reviews step
- Look for "✅ Stored last_7_days insights successfully" in Tavily step
- Look for "Generated all summaries" in summaries step

## Quick Test

After the workflow runs, you can verify data was added:
1. Go to Supabase Dashboard
2. Check `google_reviews` table - should have new reviews
3. Check `perplexity_insights` table - should have updated `last_7_days` entry
4. Check `feedback_summaries` table - should have refreshed summaries

