# How We Use Tavily in Nekovibe

Tavily is an AI-powered web search API that we use in **3 different ways** to gather external intelligence about Neko Health:

---

## 1. 📅 **Daily Automated Search (Last 7 Days)**

**What it does:**
- Runs **every day at midnight UTC** via GitHub Actions
- Searches for: "Neko Health latest news articles press releases blog posts social media mentions past 7 days"
- Uses **basic search depth** with **15 results max**
- Filters to only show results from the **last 7 days**

**What it stores:**
- AI-generated summary of recent news/trends
- 15 citations (URLs, titles, dates)
- Stored in `perplexity_insights` table with `scope = 'last_7_days'`

**Purpose:**
- Keep the system updated with the **latest news** about Neko Health
- Capture breaking news, press releases, social media buzz
- Refresh daily so users always have recent context

---

## 2. 🌐 **Weekly Comprehensive Market Analysis**

**What it does:**
- Runs **every Monday at 2 AM UTC** via GitHub Actions
- Searches for: "Neko Health health check clinics: overall public perception, customer reviews, media coverage, market positioning, competitive analysis, key differentiators, strengths, weaknesses, controversies, trends"
- Uses **advanced search depth** with **20 results max**
- No time filter (searches all time)

**What it stores:**
- AI-generated comprehensive market analysis
- 20 citations (URLs, titles, dates)
- Stored in `perplexity_insights` table with `scope = 'comprehensive'`

**Purpose:**
- Get a **big picture view** of Neko Health's market position
- Understand overall sentiment, competitive landscape, trends
- Refresh weekly to track long-term changes

---

## 3. 🔍 **On-Demand User Queries (Real-Time Search)**

**What it does:**
- Triggered when user clicks **"Run another web search"** button in the frontend
- Only appears when **"Articles / Press"** checkbox is ticked
- Takes the user's question and adds Neko Health context
- Performs a **real-time search** with advanced depth, 15 results

**What it returns:**
- Immediate AI-generated answer based on current web sources
- Citations included
- Displayed directly to the user (not stored in database)

**Purpose:**
- Let users ask **specific questions** and get fresh web results
- Example: "What did TechCrunch say about Neko Health recently?"
- Provides real-time intelligence beyond our stored summaries

---

## How It All Works Together

### In the Chat Function (`nekovibe-chat`):

When a user asks a question with **"Articles / Press"** checked:

1. **Fetches stored insights** from `perplexity_insights` table:
   - Comprehensive analysis (weekly refresh)
   - Recent 7-day news (daily refresh)

2. **Includes them in the LLM prompt** alongside:
   - Review summaries
   - Specific review snippets

3. **LLM synthesizes** all sources to answer the question

### Data Flow:

```
Daily (00:00 UTC)
  └─> Tavily API: "Neko Health latest news past 7 days"
      └─> Store in DB: scope = 'last_7_days'

Weekly (Monday 02:00 UTC)
  └─> Tavily API: "Neko Health comprehensive market analysis"
      └─> Store in DB: scope = 'comprehensive'

User Query (on-demand)
  └─> Tavily API: "Neko Health: [user's question]"
      └─> Return directly to user (not stored)
```

---

## Database Storage

All automated searches are stored in the **`perplexity_insights`** table:

| Column | Description |
|--------|-------------|
| `scope` | `'comprehensive'` or `'last_7_days'` |
| `query_text` | The search query used |
| `response_text` | AI-generated summary/answer |
| `citations` | JSONB array of {url, title, published_at} |
| `metadata` | {provider: 'tavily', response_time, results_count} |
| `last_refreshed_at` | When it was last updated |

**Note:** We kept the table name `perplexity_insights` for compatibility, but it now stores Tavily data.

---

## Benefits of This Approach

✅ **Automated Intelligence**: Daily/weekly updates without manual work  
✅ **Fresh Data**: Latest news captured automatically  
✅ **Comprehensive View**: Both recent trends and overall market position  
✅ **User Control**: On-demand searches for specific questions  
✅ **Cost Efficient**: Free tier = 1,000 searches/month (we use ~60/month)  
✅ **AI-Powered**: Tavily provides summaries, not just raw links  

---

## Example Queries Tavily Handles

**Daily (7-day):**
- "Neko Health latest news articles press releases blog posts social media mentions past 7 days"

**Weekly (comprehensive):**
- "Neko Health health check clinics: overall public perception, customer reviews, media coverage, market positioning, competitive analysis, key differentiators, strengths, weaknesses, controversies, trends"

**User (on-demand):**
- "What did TechCrunch say about Neko Health recently?"
- "Are there any new Neko Health locations opening?"
- "What's the latest press coverage about Neko Health?"

