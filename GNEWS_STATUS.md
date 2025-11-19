# GNews Integration Status

## Current Situation

✅ **Integration is working correctly**
- API calls are successful
- Articles are being found (7 articles about "Neko Health")
- Data is being stored in database

❌ **Free Plan Limitations**
- GNews free plan only allows articles that are **12 hours to 30 days old**
- All "Neko Health" articles are outside this window:
  - Either too recent (<12 hours) - delayed on free plan
  - Or too old (>30 days) - not allowed on free plan

## What This Means

The system is **working as designed**, but GNews free plan restrictions prevent articles from being returned. The articles exist, but they're filtered out by GNews's free plan limitations.

## Solutions

### Option 1: Upgrade GNews Plan (Recommended)
- Go to https://gnews.io/change-plan
- Upgrade to a paid plan
- This removes:
  - 12-hour delay for real-time articles
  - 30-day limit for historical data
- Articles will automatically start appearing once upgraded

### Option 2: Wait for New Articles
- If new articles about Neko Health are published
- They'll appear once they're 12+ hours old (and within 30 days)
- System checks daily, so they'll be picked up automatically

### Option 3: Keep Using Tavily
- Tavily works perfectly and has no such restrictions
- GNews can remain as backup/complement
- When GNews articles become accessible, they'll automatically appear

## Current API Key

- Key: `fbe507dc791ffc4a5a9f5f085c28cb01`
- Status: Working, but free plan limitations apply
- Articles found: 7 (but filtered out)

## What's Stored

- Placeholders are stored in `perplexity_insights` table:
  - `gnews_comprehensive` - explains the limitation
  - `gnews_last_7_days` - explains the limitation
- When articles become accessible, they'll replace the placeholders automatically

## Next Steps

1. **If you upgrade GNews**: Just update the API key in GitHub Actions secrets, and articles will start appearing
2. **If you keep free plan**: System will continue checking daily, and articles will appear when they fall within the 12h-30d window
3. **For now**: Tavily provides excellent coverage, so GNews is a nice-to-have complement

