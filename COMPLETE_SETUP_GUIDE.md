# Complete Setup Guide - Copy & Paste Ready

Follow these steps in order. All code is ready to copy-paste.

---

## STEP 1: Create Database Tables

Go to **Supabase Dashboard → SQL Editor** and run this SQL:

```sql
-- Unified Feedback System Schema
-- Unified feedback items table (replaces direct queries to google_reviews/articles)
CREATE TABLE IF NOT EXISTS feedback_items (
  id BIGSERIAL PRIMARY KEY,
  clinic_id TEXT NOT NULL, -- Clinic identifier (e.g., "Neko Health Marylebone")
  source_type TEXT NOT NULL CHECK (source_type IN ('google_review', 'press_article', 'social_post', 'blog_post')),
  text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', -- Stores: rating, url, author, date, language, external_id, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Summaries table for pre-computed LLM summaries
CREATE TABLE IF NOT EXISTS feedback_summaries (
  id BIGSERIAL PRIMARY KEY,
  clinic_id TEXT, -- NULL for global summaries
  source_type TEXT, -- NULL for "all sources" summaries
  scope TEXT NOT NULL CHECK (scope IN ('all_time', 'last_90_days', 'last_30_days', 'last_7_days')),
  summary_text TEXT NOT NULL,
  items_covered_count INTEGER DEFAULT 0,
  last_refreshed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one summary per combination
  CONSTRAINT feedback_summaries_unique UNIQUE (clinic_id, source_type, scope)
);

-- Unique index for feedback_items (can't use JSONB operator in constraint, so use index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_items_unique 
ON feedback_items ((metadata->>'external_id'), clinic_id, source_type)
WHERE metadata->>'external_id' IS NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_feedback_items_clinic_id ON feedback_items(clinic_id);
CREATE INDEX IF NOT EXISTS idx_feedback_items_source_type ON feedback_items(source_type);
CREATE INDEX IF NOT EXISTS idx_feedback_items_created_at ON feedback_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_items_clinic_source ON feedback_items(clinic_id, source_type);

CREATE INDEX IF NOT EXISTS idx_feedback_summaries_clinic_id ON feedback_summaries(clinic_id);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_source_type ON feedback_summaries(source_type);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_scope ON feedback_summaries(scope);
CREATE INDEX IF NOT EXISTS idx_feedback_summaries_lookup ON feedback_summaries(clinic_id, source_type, scope);

-- Full-text search index for feedback_items
CREATE INDEX IF NOT EXISTS idx_feedback_items_text_search ON feedback_items USING gin(to_tsvector('english', text));

-- Updated_at trigger for feedback_items
CREATE TRIGGER update_feedback_items_updated_at BEFORE UPDATE ON feedback_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Updated_at trigger for feedback_summaries
CREATE TRIGGER update_feedback_summaries_updated_at BEFORE UPDATE ON feedback_summaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**✅ Expected result:** Tables `feedback_items` and `feedback_summaries` are created.

---

## STEP 2: Migrate Existing Data

Still in **SQL Editor**, run this migration script:

```sql
-- Migration script: Move existing google_reviews to feedback_items
INSERT INTO feedback_items (clinic_id, source_type, text, metadata, created_at, updated_at)
SELECT 
  clinic_name AS clinic_id,
  'google_review' AS source_type,
  text,
  jsonb_build_object(
    'external_id', external_id,
    'clinic_place_id', clinic_place_id,
    'author_name', author_name,
    'author_url', author_url,
    'rating', rating,
    'published_at', published_at::text,
    'response_text', response_text,
    'response_published_at', response_published_at::text,
    'raw_data', raw_data
  ) AS metadata,
  created_at,
  updated_at
FROM google_reviews
ON CONFLICT DO NOTHING; -- Skip duplicates if re-run

-- Optional: Also migrate articles if they exist
INSERT INTO feedback_items (clinic_id, source_type, text, metadata, created_at, updated_at)
SELECT 
  COALESCE(metadata->>'clinic_name', 'Unknown Clinic') AS clinic_id,
  CASE 
    WHEN source = 'blog' THEN 'blog_post'
    WHEN source IN ('press', 'article') THEN 'press_article'
    ELSE 'press_article'
  END AS source_type,
  COALESCE(description, content) AS text, -- Use description if available, fallback to content
  jsonb_build_object(
    'external_id', external_id,
    'title', title,
    'url', url,
    'author', author,
    'published_at', published_at::text,
    'source', source,
    'raw_html', raw_html,
    'metadata', metadata
  ) AS metadata,
  created_at,
  updated_at
FROM articles
WHERE NOT EXISTS (
  SELECT 1 FROM feedback_items 
  WHERE feedback_items.metadata->>'external_id' = articles.external_id
)
ON CONFLICT DO NOTHING;

-- Verify migration
SELECT 
  source_type,
  COUNT(*) as count,
  COUNT(DISTINCT clinic_id) as unique_clinics
FROM feedback_items
GROUP BY source_type;
```

**✅ Expected result:** You should see your reviews migrated. The last query shows counts per source_type.

---

## STEP 3: Deploy Edge Function - generate-summaries

1. Go to **Supabase Dashboard → Edge Functions**
2. Click **"Create a new function"**
3. Name it: `generate-summaries`
4. Copy-paste this code:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const maxItemsPerSummary = Number(Deno.env.get("NEKOVIBE_SUMMARY_MAX_ITEMS") ?? "500");

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Supabase credentials are missing.");
}
if (!openaiApiKey) {
  console.error("OPENAI_API_KEY not set.");
}

interface SummaryRequest {
  clinic_id?: string | null;
  source_type?: string | null;
  scope?: "all_time" | "last_90_days" | "last_30_days" | "last_7_days";
  force_refresh?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: SummaryRequest | null = req.method === "POST" ? await req.json() : null;
    
    // Support both POST with body and GET with query params
    const params: SummaryRequest = body || {
      clinic_id: new URL(req.url).searchParams.get("clinic_id") || undefined,
      source_type: new URL(req.url).searchParams.get("source_type") || undefined,
      scope: (new URL(req.url).searchParams.get("scope") as any) || "all_time",
      force_refresh: new URL(req.url).searchParams.get("force_refresh") === "true",
    };

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { "X-Client-Info": "nekovibe-summaries" } },
    });

    // Generate summaries for all combinations if no specific params
    if (!params.clinic_id && !params.source_type && !params.scope) {
      return await generateAllSummaries(supabase);
    }

    // Generate a specific summary
    const result = await generateSummary(
      supabase,
      params.clinic_id || null,
      params.source_type || null,
      params.scope || "all_time",
      params.force_refresh || false,
    );

    return respond(result, 200);
  } catch (error) {
    console.error("generate-summaries failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

async function generateAllSummaries(supabase: any) {
  // Get all unique clinic_ids and source_types
  const { data: clinics } = await supabase
    .from("feedback_items")
    .select("clinic_id")
    .not("clinic_id", "is", null);

  const uniqueClinics = [...new Set((clinics || []).map((c: any) => c.clinic_id))];
  const sourceTypes = ["google_review", "press_article", "social_post", "blog_post"];
  const scopes: ("all_time" | "last_90_days")[] = ["all_time", "last_90_days"];

  const results: any[] = [];

  // Generate global summaries (no clinic, all sources)
  for (const scope of scopes) {
    const result = await generateSummary(supabase, null, null, scope, false);
    results.push(result);
  }

  // Generate per-clinic summaries
  for (const clinicId of uniqueClinics) {
    // All sources for this clinic
    for (const scope of scopes) {
      const result = await generateSummary(supabase, clinicId, null, scope, false);
      results.push(result);
    }

    // Per-source for this clinic
    for (const sourceType of sourceTypes) {
      for (const scope of scopes) {
        const result = await generateSummary(supabase, clinicId, sourceType, scope, false);
        results.push(result);
      }
    }
  }

  return respond({
    message: "Generated all summaries",
    results,
    total: results.length,
  }, 200);
}

async function generateSummary(
  supabase: any,
  clinicId: string | null,
  sourceType: string | null,
  scope: "all_time" | "last_90_days" | "last_30_days" | "last_7_days",
  forceRefresh: boolean,
): Promise<any> {
  // Check if summary exists and is recent (unless force refresh)
  if (!forceRefresh) {
    const { data: existing } = await supabase
      .from("feedback_summaries")
      .select("*")
      .eq("clinic_id", clinicId || "")
      .eq("source_type", sourceType || "")
      .eq("scope", scope)
      .single();

    if (existing && existing.last_refreshed_at) {
      const hoursSinceRefresh = (Date.now() - new Date(existing.last_refreshed_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceRefresh < 24) {
        return {
          clinic_id: clinicId,
          source_type: sourceType,
          scope,
          status: "skipped",
          reason: "Summary is recent (less than 24 hours old)",
          summary: existing.summary_text,
        };
      }
    }
  }

  // Build query for feedback_items
  let query = supabase.from("feedback_items").select("id, text, metadata, created_at");

  if (clinicId) {
    query = query.eq("clinic_id", clinicId);
  }

  if (sourceType) {
    query = query.eq("source_type", sourceType);
  }

  // Apply time scope filter
  if (scope === "last_90_days") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    query = query.gte("created_at", cutoff.toISOString());
  } else if (scope === "last_30_days") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    query = query.gte("created_at", cutoff.toISOString());
  } else if (scope === "last_7_days") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    query = query.gte("created_at", cutoff.toISOString());
  }

  query = query.order("created_at", { ascending: false }).limit(maxItemsPerSummary);

  const { data: items, error } = await query;

  if (error) {
    console.error("Failed to fetch items:", error);
    return {
      clinic_id: clinicId,
      source_type: sourceType,
      scope,
      status: "error",
      error: error.message,
    };
  }

  if (!items || items.length === 0) {
    // Create empty summary
    const summaryText = `No feedback items found for this combination.`;
    await upsertSummary(supabase, clinicId, sourceType, scope, summaryText, 0);
    return {
      clinic_id: clinicId,
      source_type: sourceType,
      scope,
      status: "empty",
      items_count: 0,
      summary: summaryText,
    };
  }

  // Format items for LLM
  const itemsText = items
    .map((item: any, idx: number) => {
      const rating = item.metadata?.rating ? `Rating: ${item.metadata.rating}/5\n` : "";
      const author = item.metadata?.author_name || item.metadata?.author || "";
      const date = item.created_at ? new Date(item.created_at).toISOString().split("T")[0] : "";
      const clinic = item.metadata?.clinic_name || clinicId || "";
      
      return `[${idx + 1}] ${rating}${author ? `Author: ${author}\n` : ""}${date ? `Date: ${date}\n` : ""}${clinic ? `Clinic: ${clinic}\n` : ""}Content: ${item.text.substring(0, 800)}`;
    })
    .join("\n\n");

  // Generate summary via OpenAI
  const summaryPrompt = `You are analyzing user feedback about Neko Health (health check clinics). Below are ${items.length} feedback items (reviews, articles, or social posts).

Your task: Create a comprehensive summary that captures:
- Recurring themes and patterns
- Strengths and positive aspects mentioned
- Weaknesses, issues, or concerns raised
- Specific "wow" moments or standout experiences
- Any notable trends or changes over time
- Concrete examples when relevant

Important:
- This is a summary of USER FEEDBACK, not marketing copy
- Be honest and balanced
- Quantify when possible (e.g., "many users mention...", "several reviews note...")
- Highlight both positive and negative feedback
- If there are conflicting views, mention both sides

Feedback items:
${itemsText}

Provide a clear, structured summary (2-4 paragraphs) that would help someone understand what people are saying about Neko Health based on this data.`;

  const summaryText = await callOpenAI(summaryPrompt);

  if (!summaryText) {
    return {
      clinic_id: clinicId,
      source_type: sourceType,
      scope,
      status: "error",
      error: "Failed to generate summary from OpenAI",
    };
  }

  // Store summary
  await upsertSummary(supabase, clinicId, sourceType, scope, summaryText, items.length);

  return {
    clinic_id: clinicId,
    source_type: sourceType,
    scope,
    status: "success",
    items_count: items.length,
    summary: summaryText,
  };
}

async function upsertSummary(
  supabase: any,
  clinicId: string | null,
  sourceType: string | null,
  scope: string,
  summaryText: string,
  itemsCount: number,
) {
  const { error } = await supabase
    .from("feedback_summaries")
    .upsert(
      {
        clinic_id: clinicId,
        source_type: sourceType,
        scope,
        summary_text: summaryText,
        items_covered_count: itemsCount,
        last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "clinic_id,source_type,scope",
      },
    );

  if (error) {
    console.error("Failed to upsert summary:", error);
    throw error;
  }
}

async function callOpenAI(content: string): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.2, // Lower temp for more consistent summaries
      messages: [
        {
          role: "system",
          content:
            "You are an expert analyst summarizing user feedback. Be objective, balanced, and focus on patterns and concrete details from the data.",
        },
        { role: "user", content },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenAI API error:", errText);
    return null;
  }

  const completion = await response.json();
  return completion?.choices?.[0]?.message?.content?.trim() ?? null;
}

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
```

5. Click **"Deploy function"**
6. Go to **Settings → Edge Functions** and set these environment variables:
   - `SUPABASE_URL` (your Supabase project URL)
   - `SUPABASE_SERVICE_ROLE_KEY` (from Settings → API)
   - `OPENAI_API_KEY` (your OpenAI API key)
   - `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)
   - `NEKOVIBE_SUMMARY_MAX_ITEMS` (optional, defaults to `500`)

**✅ Expected result:** Function `generate-summaries` is deployed.

---

## STEP 4: Deploy Edge Function - nekovibe-chat (Updated)

1. Go to **Supabase Dashboard → Edge Functions**
2. Find `nekovibe-chat` (or create it if it doesn't exist)
3. Click **"Edit"** and replace ALL code with this:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const maxSearchResults = Number(Deno.env.get("NEKOVIBE_SEARCH_MAX_RESULTS") ?? "30");

const CLINIC_MATCHERS = [
  { name: "Neko Health Marylebone", tokens: ["marylebone", "w1"] },
  { name: "Neko Health Spitalfields", tokens: ["spitalfields", "liverpool street"] },
  { name: "Neko Health Manchester", tokens: ["manchester", "lincoln square"] },
  { name: "Neko Health Ostermalmstorg", tokens: ["östermalm", "ostermalm", "stockholm", "sweden"] },
  { name: "Neko Health Covent Garden", tokens: ["covent garden"] },
];

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("Supabase credentials are missing.");
}
if (!openaiApiKey) {
  console.warn("OPENAI_API_KEY not set.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, sources = ["reviews"] } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return respond({ error: "prompt is required" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { "X-Client-Info": "nekovibe-edge-function" } },
    });

    // Detect clinic and source type from prompt
    const detectedClinics = detectClinics(prompt);
    const detectedSourceType = detectSourceType(prompt, sources);

    // Step 1: Fetch relevant summaries
    const summaries = await fetchSummaries(supabase, detectedClinics, detectedSourceType);

    // Step 2: Perform targeted text search on feedback_items
    const searchResults = await searchFeedbackItems(
      supabase,
      prompt,
      detectedClinics,
      detectedSourceType,
    );

    // Step 3: Build single LLM prompt with summaries + snippets
    const answer = await generateAnswer(prompt, summaries, searchResults, detectedClinics);

    return respond(
      {
        answer: answer ?? "I couldn't generate an answer right now.",
        usedSources: detectedSourceType ? [detectedSourceType] : sources,
        model: openaiModel,
        clinicsConsidered: detectedClinics.length ? detectedClinics : "all clinics",
        summariesUsed: summaries.length,
        searchResultsUsed: searchResults.length,
      },
      200,
    );
  } catch (error) {
    console.error("nekovibe-chat failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

async function fetchSummaries(
  supabase: any,
  clinics: string[],
  sourceType: string | null,
): Promise<any[]> {
  const summaries: any[] = [];

  // Always include global summaries (no clinic, all sources)
  const globalScopes = ["all_time", "last_90_days"];
  for (const scope of globalScopes) {
    const { data } = await supabase
      .from("feedback_summaries")
      .select("*")
      .is("clinic_id", null)
      .is("source_type", null)
      .eq("scope", scope)
      .single();

    if (data) {
      summaries.push({
        label: `[Global, All Sources, ${scope}]`,
        ...data,
      });
    }
  }

  // If source type detected, include global summaries for that source
  if (sourceType) {
    for (const scope of globalScopes) {
      const { data } = await supabase
        .from("feedback_summaries")
        .select("*")
        .is("clinic_id", null)
        .eq("source_type", sourceType)
        .eq("scope", scope)
        .single();

      if (data) {
        summaries.push({
          label: `[Global, ${sourceType}, ${scope}]`,
          ...data,
        });
      }
    }
  }

  // Include clinic-specific summaries
  for (const clinicId of clinics) {
    // All sources for this clinic
    for (const scope of globalScopes) {
      const { data } = await supabase
        .from("feedback_summaries")
        .select("*")
        .eq("clinic_id", clinicId)
        .is("source_type", null)
        .eq("scope", scope)
        .single();

      if (data) {
        summaries.push({
          label: `[Clinic: ${clinicId}, All Sources, ${scope}]`,
          ...data,
        });
      }
    }

    // Per-source for this clinic
    if (sourceType) {
      for (const scope of globalScopes) {
        const { data } = await supabase
          .from("feedback_summaries")
          .select("*")
          .eq("clinic_id", clinicId)
          .eq("source_type", sourceType)
          .eq("scope", scope)
          .single();

        if (data) {
          summaries.push({
            label: `[Clinic: ${clinicId}, ${sourceType}, ${scope}]`,
            ...data,
          });
        }
      }
    }
  }

  // Limit to most relevant 6 summaries
  return summaries.slice(0, 6);
}

async function searchFeedbackItems(
  supabase: any,
  prompt: string,
  clinics: string[],
  sourceType: string | null,
): Promise<any[]> {
  // Extract keywords from prompt for search
  const keywords = extractKeywords(prompt);
  if (keywords.length === 0) {
    return [];
  }

  // Build search query using full-text search
  let query = supabase
    .from("feedback_items")
    .select("id, clinic_id, source_type, text, metadata, created_at")
    .limit(maxSearchResults);

  // Apply filters
  if (clinics.length > 0) {
    query = query.in("clinic_id", clinics);
  }

  if (sourceType) {
    query = query.eq("source_type", sourceType);
  }

  // Use full-text search with keywords
  // Build OR conditions for each keyword
  const orConditions = keywords.map((k) => `text.ilike.%${k}%`).join(",");
  query = query.or(orConditions);

  // Order by relevance (could be improved with ranking)
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    console.error("Search failed:", error);
    return [];
  }

  return (data || []).map((item: any) => ({
    id: item.id,
    clinic_id: item.clinic_id,
    source_type: item.source_type,
    text: truncate(item.text, 300),
    rating: item.metadata?.rating,
    author: item.metadata?.author_name || item.metadata?.author,
    date: item.created_at ? new Date(item.created_at).toISOString().split("T")[0] : null,
  }));
}

function extractKeywords(prompt: string): string[] {
  // Simple keyword extraction: remove common words, keep meaningful terms
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "what",
    "do",
    "does",
    "is",
    "are",
    "was",
    "were",
    "about",
    "say",
    "says",
    "people",
    "they",
    "their",
    "them",
  ]);

  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  // Return unique keywords, limit to 5 most relevant
  return [...new Set(words)].slice(0, 5);
}

async function generateAnswer(
  prompt: string,
  summaries: any[],
  searchResults: any[],
  clinics: string[],
): Promise<string | null> {
  // Build context blocks
  const summariesBlock = summaries
    .map((s) => `${s.label}\n${s.summary_text}`)
    .join("\n\n---\n\n");

  const snippetsBlock = searchResults
    .map((item, idx) => {
      const parts = [
        `[${idx + 1}]`,
        item.clinic_id ? `Clinic: ${item.clinic_id}` : "",
        item.source_type ? `Source: ${item.source_type}` : "",
        item.rating ? `Rating: ${item.rating}/5` : "",
        item.author ? `Author: ${item.author}` : "",
        item.date ? `Date: ${item.date}` : "",
        `Content: ${item.text}`,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");

  const systemMessage = `You are Nekovibe, an expert analyst summarizing what people say about Neko Health based on reviews, articles, and social posts.

CRITICAL RULES:
- Only use the provided summaries and snippets as ground truth
- Do NOT invent details that are not in the data
- Use summaries to describe overall patterns and trends
- Use snippets as concrete examples (you can quote/paraphrase)
- If the question is very specific and there is little or no data, say that explicitly
- If the question targets one clinic, focus on that clinic first, then compare to others only if clearly present in data
- NEVER make medical claims; you are only reflecting user feedback and public mentions
- Be honest and balanced - mention both positive and negative feedback when present`;

  const userMessage = `Question: "${prompt}"

Context - Summaries (overall patterns):
${summariesBlock || "No summaries available."}

Context - Example Snippets (concrete examples):
${snippetsBlock || "No specific examples found."}

Instructions:
- Answer the question using ONLY the summaries and snippets above
- Use summaries to describe overall patterns and trends
- Use snippets as concrete examples (you can quote/paraphrase)
- If the question targets specific clinics (${clinics.length ? clinics.join(", ") : "all clinics"}), prioritize those clinics
- Be specific and quantitative when possible
- If there's insufficient data, say so explicitly`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("OpenAI API error:", errText);
    return null;
  }

  const completion = await response.json();
  return completion?.choices?.[0]?.message?.content?.trim() ?? null;
}

function detectClinics(prompt: string): string[] {
  const lowered = prompt.toLowerCase();
  const matches = CLINIC_MATCHERS.filter((c) =>
    c.tokens.some((token) => lowered.includes(token))
  ).map((c) => c.name);
  return matches;
}

function detectSourceType(prompt: string, sources: string[]): string | null {
  const lowered = prompt.toLowerCase();
  
  if (sources.includes("reviews") || lowered.includes("review")) {
    return "google_review";
  }
  if (sources.includes("articles") || lowered.includes("article") || lowered.includes("press")) {
    return "press_article";
  }
  if (sources.includes("social") || lowered.includes("social") || lowered.includes("post")) {
    return "social_post";
  }
  if (lowered.includes("blog")) {
    return "blog_post";
  }
  
  return null;
}

function truncate(text: string, max = 400): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
```

4. Click **"Deploy function"**
5. Make sure the same environment variables are set (they should be shared across functions)

**✅ Expected result:** Function `nekovibe-chat` is updated and deployed.

---

## STEP 5: Generate Initial Summaries

1. Go to **Supabase Dashboard → Edge Functions → generate-summaries**
2. Click **"Invoke function"**
3. In the request body, paste:
```json
{}
```
4. Click **"Invoke"**

**⚠️ This will take 5-10 minutes** as it generates summaries for all clinic/source/scope combinations. You'll see progress in the logs.

**✅ Expected result:** The `feedback_summaries` table is populated with summaries.

---

## STEP 6: Test the Chat Function

1. Go to your frontend (or use the Supabase function tester)
2. Try a question like: "What do people say about Marylebone?"
3. **Expected:** Fast response (2-4 seconds) using summaries + search

**✅ Expected result:** Chat is fast and uses all data!

---

## Troubleshooting

### "No summaries found" error
- Make sure you ran Step 5 (generate summaries)
- Check `feedback_summaries` table has data

### "Search returns no results"
- Verify `feedback_items` has data (check after Step 2)
- Check keywords are being extracted (look at function logs)

### Summaries are stale
- Re-run Step 5 with `{"force_refresh": true}` in the body
- Or call the function for a specific summary:
```json
{
  "clinic_id": "Neko Health Marylebone",
  "source_type": "google_review",
  "scope": "all_time",
  "force_refresh": true
}
```

---

## Done! 🎉

Your system is now:
- ✅ Fast (1 LLM call instead of 10+)
- ✅ Uses all data (via pre-computed summaries)
- ✅ Ready to scale (just add new sources and generate summaries)

