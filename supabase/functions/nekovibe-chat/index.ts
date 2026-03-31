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
const reviewFetchLimit = Number(Deno.env.get("NEKOVIBE_REVIEW_FETCH_LIMIT") ?? "300");
const chunkSize = Number(Deno.env.get("NEKOVIBE_CHUNK_SIZE") ?? "25");


type ReviewFilters = {
  clinic?: string | string[];
  dateFrom?: string;
  dateTo?: string;
};

function normalizeFilters(filters: ReviewFilters | null | undefined) {
  const rawClinic = filters?.clinic;
  const clinicList = Array.isArray(rawClinic) ? rawClinic : rawClinic ? [rawClinic] : [];
  const clinic = clinicList
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim());
  const dateFrom = typeof filters?.dateFrom === "string" ? filters.dateFrom : "";
  const dateTo = typeof filters?.dateTo === "string" ? filters.dateTo : "";
  return { clinic, dateFrom, dateTo };
}

function addDays(dateString: string, days: number): string | null {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function applyDateRange(query: any, column: string, dateFrom?: string, dateTo?: string) {
  let nextQuery = query;
  if (dateFrom) {
    nextQuery = nextQuery.gte(column, dateFrom);
  }
  if (dateTo) {
    const endDate = addDays(dateTo, 1);
    if (endDate) {
      nextQuery = nextQuery.lt(column, endDate);
    }
  }
  return nextQuery;
}

const CLINIC_MATCHERS = [
  { name: "Neko Health Marylebone", tokens: ["marylebone", "w1"] },
  { name: "Neko Health Spitalfields", tokens: ["spitalfields", "liverpool street"] },
  { name: "Neko Health Manchester", tokens: ["manchester", "lincoln square"] },
  { name: "Neko Health Covent Garden", tokens: ["covent garden"] },
  { name: "Neko Health Birmingham", tokens: ["birmingham", "livery street"] },
  { name: "Neko Health Victoria", tokens: ["victoria"] },
  { name: "Neko Health Östermalm", tokens: ["östermalm", "ostermalm", "ostermalmstorg", "stockholm", "sweden", "swedish"] },
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
    const { prompt, sources = ["reviews"], useFallback = false, filters = null, topicSlug = null } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return respond({ error: "prompt is required" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { "X-Client-Info": "nekovibe-edge-function" } },
    });

    // Load topic keywords if a topic chip is active in the frontend
    let topicKeywords: string[] = [];
    if (topicSlug) {
      const { data: topicData } = await supabase
        .from("review_topics")
        .select("keywords")
        .eq("slug", topicSlug)
        .single();
      if (topicData?.keywords) topicKeywords = topicData.keywords;
    }

    // Smart intent extraction: LLM parses the question for clinic, date, topic keywords
    const today = new Date().toISOString().split("T")[0];
    const intent = await extractIntent(prompt, today);

    // Merge with explicit UI filters (UI takes precedence over extracted)
    const normalizedFilters = normalizeFilters(filters);
    const detectedClinics = intent.clinics.length ? intent.clinics : detectClinics(prompt);
    // Intent source takes precedence over keyword detection
    const detectedSourceType = intent.source ?? detectSourceType(prompt, sources);
    const clinics = normalizedFilters.clinic.length ? normalizedFilters.clinic : detectedClinics;

    // Merge dates: UI filters override intent-extracted dates
    const mergedFilters = {
      ...normalizedFilters,
      dateFrom: normalizedFilters.dateFrom || intent.dateFrom || "",
      dateTo: normalizedFilters.dateTo || intent.dateTo || "",
      ratingMax: intent.ratingMax ?? null,
    };
    const hasDateFilter = Boolean(mergedFilters.dateFrom || mergedFilters.dateTo);

    // Combine topic slug keywords with intent keywords for richer search
    const allTopicKeywords = [...new Set([...topicKeywords, ...intent.topicKeywords])];

    // If fallback is requested, run raw data analysis (fast SQL, no LLM)
    if (useFallback) {
      const fallbackAnswer = await generateFallbackAnswer(supabase, prompt, clinics, mergedFilters);
      return respond(
        {
          answer: fallbackAnswer ?? "I couldn't generate a fallback answer right now.",
          usedFallback: true,
          usedSources: ["reviews"],
          model: "raw-data",
          clinicsConsidered: clinics.length ? clinics : "all clinics",
        },
        200,
      );
    }

    // Check if ONLY articles/press is selected
    const hasArticlesSource = sources.includes("articles");
    const hasReviewsSource = sources.includes("reviews");
    const onlyArticles = hasArticlesSource && !hasReviewsSource;

    // Step 1: Fetch relevant summaries (skip if source-specific — summaries are cross-source)
    const summaries = onlyArticles || hasDateFilter || detectedSourceType
      ? []
      : await fetchSummaries(supabase, clinics, detectedSourceType);

    // Step 1.5: Fetch Tavily/Web insights (ALWAYS if articles selected, REQUIRED if articles-only)
    const perplexityInsights = hasArticlesSource ? await fetchPerplexityInsights(supabase) : [];

    // If articles-only and no insights available, return early
    if (onlyArticles && perplexityInsights.length === 0) {
      return respond({
        answer: "No web search insights are currently available.",
        usedSources: ["articles"],
      }, 200);
    }

    // Step 1.6: Fetch exact aggregate stats (rating distribution) — always exact, never sampled
    const aggregateStats = onlyArticles ? null : await fetchAggregateStats(
      supabase, detectedSourceType, clinics, mergedFilters
    );

    // Step 2: Targeted search using intent-extracted keywords + topic keywords
    const searchResults = onlyArticles ? [] : await searchFeedbackItems(
      supabase,
      prompt,
      clinics,
      detectedSourceType,
      mergedFilters,
      allTopicKeywords,
    );

    // Step 3: Build LLM prompt with summaries + snippets + web insights
    const answer = await generateAnswer(prompt, summaries, searchResults, detectedClinics, perplexityInsights, onlyArticles, aggregateStats);

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

async function fetchAggregateStats(
  supabase: any,
  sourceType: string | null,
  clinics: string[],
  filters: { dateFrom?: string; dateTo?: string; ratingMax?: number | null },
): Promise<string> {
  const tables: { name: string; label: string }[] = [];

  if (!sourceType || sourceType === "google_review") tables.push({ name: "google_reviews", label: "Google Reviews" });
  if (!sourceType || sourceType === "trustpilot_review") tables.push({ name: "trustpilot_reviews", label: "Trustpilot" });

  const lines: string[] = [];

  for (const table of tables) {
    try {
      // Fetch all rows (no default 1000-row cap) — rating column only
      let q = supabase.from(table.name).select("rating").limit(10000);
      if (clinics.length > 0) q = q.in("clinic_name", clinics);
      q = applyDateRange(q, "published_at", filters.dateFrom, filters.dateTo);
      if (filters.ratingMax) q = q.lte("rating", filters.ratingMax);

      const { data, error } = await q;
      if (error) {
        console.error(`fetchAggregateStats error for ${table.name}:`, error);
        lines.push(`${table.label} — query error: ${error.message}`);
        continue;
      }
      if (!data || data.length === 0) {
        lines.push(`${table.label} — 0 reviews`);
        continue;
      }

      const total = data.length;
      const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const row of data) {
        const r = Number(row.rating);
        if (r >= 1 && r <= 5) dist[r]++;
      }

      const avg = (data.reduce((s: number, r: any) => s + (Number(r.rating) || 0), 0) / total).toFixed(2);

      lines.push(`${table.label} — ${total} total reviews, avg ${avg}/5`);
      for (let s = 5; s >= 1; s--) {
        const pct = ((dist[s] / total) * 100).toFixed(1);
        lines.push(`  ${s}★: ${dist[s]} (${pct}%)`);
      }
    } catch (e: any) {
      console.error(`fetchAggregateStats exception for ${table.name}:`, e);
      lines.push(`${table.label} — exception: ${e.message}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No aggregate data available.";
}

async function fetchSummaries(
  supabase: any,
  clinics: string[],
  sourceType: string | null,
): Promise<any[]> {
  const summaries: any[] = [];

  // Always include global summaries (no clinic, all sources)
  const globalScopes = ["all_time", "last_90_days", "last_30_days", "last_7_days"];
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

  // Also fetch internal review summaries
  const internalScopes = ["all_time", "latest_upload", "last_week", "last_month"];
  for (const scope of internalScopes) {
    const { data } = await supabase
      .from("internal_review_summaries")
      .select("*")
      .eq("scope", scope)
      .order("last_refreshed_at", { ascending: false })
      .limit(1)
      .single();

    if (data) {
      summaries.push({
        label: `[Internal Reviews, ${scope}]`,
        summary_text: data.summary_text,
        items_covered_count: data.reviews_covered_count,
        scope: data.scope,
      });
    }
  }

  // Limit to most relevant 8 summaries (increased to include internal)
  return summaries.slice(0, 8);
}

async function fetchRecentReviewsSample(
  supabase: any,
  clinics: string[],
  sourceType: string | null,
  filters: { clinic: string[]; dateFrom?: string; dateTo?: string; ratingMax?: number | null },
): Promise<any[]> {
  // For broad questions with no keywords, fetch a spread of recent reviews from all sources
  const perTable = Math.ceil(reviewFetchLimit / 2);
  const results: any[] = [];

  const applyClinicAndDate = (q: any, clinicCol: string, dateCol: string) => {
    if (clinics.length > 0) q = q.in(clinicCol, clinics);
    q = applyDateRange(q, dateCol, filters.dateFrom, filters.dateTo);
    if (filters.ratingMax) q = q.lte("rating", filters.ratingMax);
    return q;
  };

  // Google reviews
  if (!sourceType || sourceType === "google_review") {
    let q = supabase.from("google_reviews")
      .select("id, clinic_name, rating, text, author_name, published_at")
      .order("published_at", { ascending: false })
      .limit(perTable);
    q = applyClinicAndDate(q, "clinic_name", "published_at");
    const { data } = await q;
    if (data) results.push(...data.map((r: any) => ({
      id: `google_${r.id}`, clinic_id: r.clinic_name, source_type: "google_review",
      text: truncate(r.text, 300), rating: r.rating, author: r.author_name,
      date: r.published_at?.split("T")[0] ?? null, table: "google_reviews",
    })));
  }

  // Trustpilot reviews
  if (!sourceType || sourceType === "trustpilot_review") {
    let q = supabase.from("trustpilot_reviews")
      .select("id, clinic_name, rating, text, title, author_name, published_at")
      .order("published_at", { ascending: false })
      .limit(perTable);
    q = applyClinicAndDate(q, "clinic_name", "published_at");
    const { data } = await q;
    if (data) results.push(...data.map((r: any) => ({
      id: `trustpilot_${r.id}`, clinic_id: r.clinic_name, source_type: "trustpilot_review",
      text: truncate(r.text || r.title || "", 300), rating: r.rating, author: r.author_name,
      date: r.published_at?.split("T")[0] ?? null, table: "trustpilot_reviews",
    })));
  }

  return results.sort((a, b) =>
    (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0)
  ).slice(0, reviewFetchLimit);
}

async function searchFeedbackItems(
  supabase: any,
  prompt: string,
  clinics: string[],
  sourceType: string | null,
  filters: { clinic: string[]; dateFrom?: string; dateTo?: string; ratingMax?: number | null },
  extraKeywords: string[] = [],
): Promise<any[]> {
  // Merge prompt keywords with intent/topic keywords for richer search
  const keywords = [...new Set([...extractKeywords(prompt), ...extraKeywords])];

  // Broad question — no meaningful keywords found. Return a representative sample.
  if (keywords.length === 0) {
    return fetchRecentReviewsSample(supabase, clinics, sourceType, filters);
  }

  const results: any[] = [];

  // Search feedback_items table
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

  query = applyDateRange(query, "created_at", filters.dateFrom, filters.dateTo);

  // Use full-text search with keywords
  const orConditions = keywords.map((k) => `text.ilike.%${k}%`).join(",");
  query = query.or(orConditions);
  query = query.order("created_at", { ascending: false });

  const { data: feedbackData, error: feedbackError } = await query;
  if (!feedbackError && feedbackData) {
    results.push(...feedbackData.map((item: any) => ({
      id: item.id,
      clinic_id: item.clinic_id,
      source_type: item.source_type,
      text: truncate(item.text, 300),
      rating: item.metadata?.rating,
      author: item.metadata?.author_name || item.metadata?.author,
      date: item.created_at ? new Date(item.created_at).toISOString().split("T")[0] : null,
      table: "feedback_items",
    })));
  }

  // Also search internal_reviews table
  let internalQuery = supabase
    .from("internal_reviews")
    .select("id, clinic_name, rating, comment, published_at")
    .limit(maxSearchResults);

  // Apply clinic filter if specified
  if (clinics.length > 0) {
    internalQuery = internalQuery.in("clinic_name", clinics);
  }

  internalQuery = applyDateRange(internalQuery, "published_at", filters.dateFrom, filters.dateTo);

  // Use full-text search with keywords on comment field
  const internalOrConditions = keywords.map((k) => `comment.ilike.%${k}%`).join(",");
  internalQuery = internalQuery.or(internalOrConditions);
  internalQuery = internalQuery.order("published_at", { ascending: false });

  const { data: internalData, error: internalError } = await internalQuery;
  if (!internalError && internalData) {
    results.push(...internalData.map((item: any) => ({
      id: `internal_${item.id}`,
      clinic_id: item.clinic_name,
      source_type: "internal_review",
      text: truncate(item.comment, 300),
      rating: item.rating,
      author: null,
      date: item.published_at ? new Date(item.published_at).toISOString().split("T")[0] : null,
      table: "internal_reviews",
    })));
  }

  // Also search google_reviews table directly (for comprehensive coverage)
  let googleQuery = supabase
    .from("google_reviews")
    .select("id, clinic_name, rating, text, author_name, published_at")
    .limit(maxSearchResults);

  if (clinics.length > 0) {
    googleQuery = googleQuery.in("clinic_name", clinics);
  }

  googleQuery = applyDateRange(googleQuery, "published_at", filters.dateFrom, filters.dateTo);
  if (filters.ratingMax) googleQuery = googleQuery.lte("rating", filters.ratingMax);

  const googleOrConditions = keywords.map((k) => `text.ilike.%${k}%`).join(",");
  if (googleOrConditions) googleQuery = googleQuery.or(googleOrConditions);
  googleQuery = googleQuery.order("published_at", { ascending: false });

  const { data: googleData, error: googleError } = await googleQuery;
  if (!googleError && googleData) {
    results.push(...googleData.map((item: any) => ({
      id: `google_${item.id}`,
      clinic_id: item.clinic_name,
      source_type: "google_review",
      text: truncate(item.text, 300),
      rating: item.rating,
      author: item.author_name,
      date: item.published_at ? new Date(item.published_at).toISOString().split("T")[0] : null,
      table: "google_reviews",
    })));
  }

  // Search trustpilot_reviews table
  let tpQuery = supabase
    .from("trustpilot_reviews")
    .select("id, clinic_name, rating, text, title, author_name, published_at")
    .limit(maxSearchResults);

  if (clinics.length > 0) {
    tpQuery = tpQuery.in("clinic_name", clinics);
  }

  tpQuery = applyDateRange(tpQuery, "published_at", filters.dateFrom, filters.dateTo);
  if (filters.ratingMax) tpQuery = tpQuery.lte("rating", filters.ratingMax);

  const tpOrConditions = keywords.map((k) => `text.ilike.%${k}%`).join(",");
  if (tpOrConditions) tpQuery = tpQuery.or(tpOrConditions);
  tpQuery = tpQuery.order("published_at", { ascending: false });

  const { data: tpData, error: tpError } = await tpQuery;
  if (!tpError && tpData) {
    results.push(
      ...tpData.map((item: any) => ({
        id: `trustpilot_${item.id}`,
        clinic_id: item.clinic_name,
        source_type: "trustpilot_review",
        text: truncate(item.text || item.title || "", 300),
        rating: item.rating,
        author: item.author_name,
        date: item.published_at ? new Date(item.published_at).toISOString().split("T")[0] : null,
        table: "trustpilot_reviews",
      })),
    );
  }

  // Also search articles table
  let articlesQuery = supabase
    .from("articles")
    .select("id, title, content, description, author, published_at, source")
    .limit(maxSearchResults);

  const articlesOrConditions = keywords.map((k) => `title.ilike.%${k}%,content.ilike.%${k}%,description.ilike.%${k}%`).join(",");
  articlesQuery = articlesQuery.or(articlesOrConditions);
  articlesQuery = articlesQuery.order("published_at", { ascending: false });

  const { data: articlesData, error: articlesError } = await articlesQuery;
  if (!articlesError && articlesData) {
    results.push(...articlesData.map((item: any) => ({
      id: `article_${item.id}`,
      clinic_id: null,
      source_type: item.source || "article",
      text: truncate(item.content || item.description || item.title, 300),
      rating: null,
      author: item.author,
      date: item.published_at ? new Date(item.published_at).toISOString().split("T")[0] : null,
      table: "articles",
      title: item.title,
    })));
  }

  // Limit total results and sort by date
  return results
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, maxSearchResults);
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

async function fetchPerplexityInsights(supabase: any): Promise<any[]> {
  const insights: any[] = [];

  // Fetch Tavily comprehensive insights
  const { data: tavilyComprehensive, error: tavilyComprehensiveError } = await supabase
    .from("perplexity_insights")
    .select("*")
    .eq("scope", "comprehensive")
    .single();

  if (tavilyComprehensive && !tavilyComprehensiveError) {
    insights.push({
      label: "[Web Search (Tavily): Comprehensive Market Analysis]",
      scope: "comprehensive",
      ...tavilyComprehensive,
    });
  }

  // Fetch Tavily recent insights
  const { data: tavilyRecent, error: tavilyRecentError } = await supabase
    .from("perplexity_insights")
    .select("*")
    .eq("scope", "last_7_days")
    .single();

  if (tavilyRecent && !tavilyRecentError) {
    insights.push({
      label: "[Web Search (Tavily): Latest 7 Days News & Trends]",
      scope: "last_7_days",
      ...tavilyRecent,
    });
  }

  // Fetch GNews comprehensive insights
  const { data: gnewsComprehensive, error: gnewsComprehensiveError } = await supabase
    .from("perplexity_insights")
    .select("*")
    .eq("scope", "gnews_comprehensive")
    .single();

  if (gnewsComprehensive && !gnewsComprehensiveError) {
    insights.push({
      label: "[News Articles (GNews): Comprehensive News Coverage]",
      scope: "gnews_comprehensive",
      ...gnewsComprehensive,
    });
  }

  // Fetch GNews recent insights
  const { data: gnewsRecent, error: gnewsRecentError } = await supabase
    .from("perplexity_insights")
    .select("*")
    .eq("scope", "gnews_last_7_days")
    .single();

  if (gnewsRecent && !gnewsRecentError) {
    insights.push({
      label: "[News Articles (GNews): Latest 7 Days News]",
      scope: "gnews_last_7_days",
      ...gnewsRecent,
    });
  }

  // If no insights available, return placeholder
  if (insights.length === 0) {
    insights.push({
      label: "[Web Search: Market Intelligence]",
      scope: "unavailable",
      response_text: "Web search insights are currently unavailable. The system is configured to fetch comprehensive market analysis and recent news trends, but data collection is pending. Once available, this will include web-wide analysis of Neko Health mentions, sentiment, and trends.",
      citations: [],
    });
  }

  return insights;
}

function filterRelevantInsights(insights: any[], keywords: string[]): string {
  if (insights.length === 0 || keywords.length === 0) {
    return insights
      .map((p) => `${p.label}\n${p.response_text}\n\nCitations: ${JSON.stringify(p.citations || [])}`)
      .join("\n\n---\n\n");
  }

  // Filter insights based on keywords
  const filtered = insights.map((insight) => {
    const text = insight.response_text?.toLowerCase() || "";
    const hasRelevantKeywords = keywords.some((keyword) => text.includes(keyword.toLowerCase()));
    
    if (hasRelevantKeywords) {
      // Highlight relevant sections
      return {
        ...insight,
        label: `${insight.label} [RELEVANT TO QUESTION]`,
      };
    }
    return insight;
  });

  return filtered
    .map((p) => `${p.label}\n${p.response_text}\n\nCitations: ${JSON.stringify(p.citations || [])}`)
    .join("\n\n---\n\n");
}

async function generateAnswer(
  prompt: string,
  summaries: any[],
  searchResults: any[],
  clinics: string[],
  perplexityInsights: any[] = [],
  articlesOnly: boolean = false,
  aggregateStats: string | null = null,
): Promise<string | null> {
  // Extract keywords from prompt for relevance filtering
  const questionKeywords = extractKeywords(prompt);
  // Build context blocks
  const summariesBlock = summaries
    .map((s) => `${s.label}\n${s.summary_text}`)
    .join("\n\n---\n\n");

  const perplexityBlock = perplexityInsights.length > 0
    ? perplexityInsights
        .map((p) => `${p.label}\n${p.response_text}\n\nCitations: ${JSON.stringify(p.citations || [])}`)
        .join("\n\n---\n\n")
    : "";

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

  // Build system message based on whether it's articles-only
  const systemMessage = articlesOnly
    ? `You are Nekovibe, an expert analyst specializing in market intelligence and media analysis for Neko Health.

CRITICAL RULES:
- Answer the user's SPECIFIC question directly and precisely
- Extract ONLY the relevant information from the web search insights that directly relates to the question
- Do NOT provide generic summaries - focus on what the question is asking
- If the question asks about recent news, prioritize the "Latest 7 Days" insights
- If the question asks about overall market position, use the "Comprehensive" insights
- If the question is about a specific topic (e.g., "partnerships", "expansion", "technology"), extract only that relevant information
- Be specific, quantitative, and cite sources when possible
- If the insights don't contain information relevant to the question, say so explicitly
- Do NOT repeat the same generic answer - tailor your response to the specific question asked`
    : `You are Nekovibe, a factual data analyst reporting on Neko Health reviews. Be concise, precise, and number-focused.

CRITICAL RULES:
- Answer directly with facts and numbers. No fluff.
- The "Exact Aggregate Stats" block contains 100% accurate counts from the full dataset — ALWAYS use these for totals, distributions, and averages. Never override them with summary estimates.
- If aggregate stats are provided for a source, use ONLY those numbers for that source — do not substitute summary text.
- Lead with numbers: "X of Y reviews (Z%)" or "X reviews mention..."
- Keep responses under 150 words unless the question requires detail
- If targeting one clinic, state numbers for that clinic first
- NEVER make medical claims; only report what reviews say
- NEVER say "Insufficient data", "Data not provided", or "Query full dataset"

OUTPUT FORMAT — STRICT:
- Plain text only. No markdown. No ** bold **. No # headers. No --- dividers.
- Use plain labels like "Google:" and "Trustpilot:" on their own line
- Use dashes for bullets: "- 5 stars: 21 (30.4%)"
- Numbers format: "X of Y (Z%)" or "avg X/5"
- Example rating block:
  Google: 500 reviews, avg 4.8/5
  - 5 stars: 460 (92%)
  - 4 stars: 32 (6.4%)
  - 3 stars: 3 (0.6%)
  - 2 stars: 2 (0.4%)
  - 1 star: 3 (0.6%)`;

  // Build prompt based on whether it's articles-only or mixed
  let userMessage: string;
  
  if (articlesOnly) {
    // Articles-only: ONLY use web search insights
    // Extract relevant parts based on the question
    const relevantInsights = filterRelevantInsights(perplexityInsights, questionKeywords);
    
    userMessage = `Question: "${prompt}"

Context - Web Search Market Intelligence (comprehensive web analysis):
${relevantInsights || perplexityBlock || "No web search insights available."}

IMPORTANT INSTRUCTIONS:
- Answer the SPECIFIC question: "${prompt}"
- Extract ONLY the information from the insights above that directly answers this question
- Do NOT provide a generic summary - focus on what the question is asking
- If the question asks about recent events/news, prioritize information from "Latest 7 Days" insights
- If the question asks about overall market position/trends, use "Comprehensive" insights
- If the question mentions specific topics (e.g., partnerships, expansion, technology), extract only that relevant information
- Do NOT reference reviews, customer feedback, or any other sources
- Be specific, quantitative, and cite sources when relevant
- If the insights don't contain information relevant to this specific question, say so explicitly`;
  } else {
    // Mixed or reviews-only: use all sources
    userMessage = `EXACT AGGREGATE STATS — USE THESE NUMBERS. DO NOT CONTRADICT THEM:
${aggregateStats || "Not available."}

---
Question: "${prompt}"
---

Supporting context — summaries (patterns, not counts):
${summariesBlock || "None."}

Supporting context — snippets (individual examples):
${snippetsBlock || "None."}

Rules:
- Copy the numbers from Exact Aggregate Stats verbatim for any distribution/count/rating question
- Plain text only — no **, no ##, no bold, no markdown
- Dashes for bullets. "Google:" / "Trustpilot:" as plain labels
- Under 150 words. Lead with numbers.
- Never say "data not provided" or "insufficient data"`;
  }

  return await generateAnswerWithOpenAI(prompt, systemMessage, userMessage, articlesOnly);
}

async function generateAnswerWithOpenAI(
  prompt: string,
  systemMessage: string,
  userMessage: string,
  articlesOnly: boolean = false,
): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: articlesOnly ? 0.5 : 0.2, // Lower temperature for more factual, consistent responses
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

interface Intent {
  clinics: string[];
  country: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  topicKeywords: string[];
  questionType: string;
  source: string | null;
  ratingMax: number | null;
}

async function extractIntent(prompt: string, today: string): Promise<Intent> {
  const fallback: Intent = {
    clinics: [],
    country: null,
    dateFrom: null,
    dateTo: null,
    topicKeywords: extractKeywords(prompt),
    questionType: "general",
    source: null,
    ratingMax: null,
  };

  if (!openaiApiKey) return fallback;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `Today is ${today}. Neko Health clinics: Marylebone, Spitalfields, Covent Garden, Manchester, Birmingham, Victoria (all UK), Östermalm (Stockholm, Sweden).

Extract structured search intent from this question. Return ONLY valid JSON:
{
  "clinics": [],
  "country": null,
  "dateFrom": null,
  "dateTo": null,
  "topicKeywords": [],
  "questionType": "general",
  "source": null,
  "ratingMax": null
}

Rules:
- "clinics": full names like ["Neko Health Manchester"] — only if explicitly mentioned
- "country": "UK", "SE", or null
- "dateFrom"/"dateTo": ISO dates (YYYY-MM-DD) if time period implied (e.g. "last month", "this week", "Q1") — compute from today
- "topicKeywords": 3-8 lowercase search terms that directly relate to the question topic
- "questionType": one of "complaint", "praise", "trend", "comparison", "general"
- "source": "trustpilot_review" if question mentions Trustpilot, "google_review" if mentions Google reviews, otherwise null
- "ratingMax": integer 1-4 if question asks about bad/negative/low/poor reviews or complaints (use 3 for "bad reviews"), null otherwise

Question: "${prompt.replace(/"/g, "'")}"`
          },
        ],
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content);
    return {
      clinics: Array.isArray(parsed.clinics) ? parsed.clinics.filter((c: any) => typeof c === "string") : [],
      country: typeof parsed.country === "string" ? parsed.country : null,
      dateFrom: typeof parsed.dateFrom === "string" ? parsed.dateFrom : null,
      dateTo: typeof parsed.dateTo === "string" ? parsed.dateTo : null,
      topicKeywords: Array.isArray(parsed.topicKeywords) && parsed.topicKeywords.length > 0
        ? parsed.topicKeywords
        : extractKeywords(prompt),
      questionType: typeof parsed.questionType === "string" ? parsed.questionType : "general",
      source: typeof parsed.source === "string" ? parsed.source : null,
      ratingMax: typeof parsed.ratingMax === "number" ? parsed.ratingMax : null,
    };
  } catch {
    return fallback;
  }
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

  const hasTrustpilot = lowered.includes("trustpilot");
  const hasGoogle = lowered.includes("google review") || lowered.includes("google reviews") || lowered.includes("google");

  // If both sources mentioned explicitly → return null (all sources)
  if (hasTrustpilot && hasGoogle) return null;

  if (hasTrustpilot) return "trustpilot_review";
  if (hasGoogle) return "google_review";
  if (lowered.includes("article") || lowered.includes("press") || sources.includes("articles")) return "press_article";
  if (lowered.includes("social") || lowered.includes("post")) return "social_post";
  if (lowered.includes("blog")) return "blog_post";

  // "review/reviews" alone does NOT default to google — return null to search all sources
  return null;
}

function truncate(text: string, max = 400): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

type RatingFocus = "all" | "positive" | "negative" | "nonfive";

function detectRatingFocus(prompt: string): RatingFocus {
  const lowered = prompt.toLowerCase();
  if (/(complain|bad|issue|problem|negative|angry|1 star|2 star|3 star|not happy|frustrat)/.test(lowered)) {
    return "negative";
  }
  if (/(positive|great|best|amazing|5 star|happy|love|delight|recommend)/.test(lowered)) {
    return "positive";
  }
  if (/(not 5|non 5|less than 5|under 5|not five)/.test(lowered)) {
    return "nonfive";
  }
  return "all";
}

async function countReviews(
  supabase: any,
  clinicFilter: string[] | null,
  ratingFocus: RatingFocus,
  exactRating?: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<number> {
  let query = supabase.from("google_reviews").select("id", { count: "exact", head: true });

  if (clinicFilter && clinicFilter.length) {
    query = query.in("clinic_name", clinicFilter);
  }

  query = applyRatingFilter(query, ratingFocus);
  query = applyDateRange(query, "published_at", dateFrom, dateTo);

  if (typeof exactRating === "number") {
    query = query.eq("rating", exactRating);
  }

  const { count, error } = await query;
  if (error) {
    console.error("Count query failed:", error);
    return 0;
  }

  return count ?? 0;
}

function applyRatingFilter(query: any, ratingFocus: RatingFocus) {
  if (ratingFocus === "positive") {
    return query.gte("rating", 4);
  }
  if (ratingFocus === "negative") {
    return query.lte("rating", 3);
  }
  if (ratingFocus === "nonfive") {
    return query.neq("rating", 5);
  }
  return query;
}

async function fetchReviewsForFallback(
  supabase: any,
  clinicFilter: string[] | null,
  ratingFocus: RatingFocus,
  dateFrom?: string,
  dateTo?: string,
): Promise<any[]> {
  let query = supabase
    .from("google_reviews")
    .select("rating, clinic_name, author_name, text, published_at")
    .order("published_at", { ascending: false })
    .limit(reviewFetchLimit);

  if (clinicFilter && clinicFilter.length) {
    query = query.in("clinic_name", clinicFilter);
  }

  query = applyRatingFilter(query, ratingFocus);
  query = applyDateRange(query, "published_at", dateFrom, dateTo);

  const { data, error } = await query;
  if (error) {
    console.error("Error fetching reviews for fallback:", error);
    return [];
  }

  return data ?? [];
}

async function generateFallbackAnswer(
  supabase: any,
  prompt: string,
  clinics: string[],
  filters: { clinic: string[]; dateFrom?: string; dateTo?: string },
): Promise<string | null> {
  const clinicFilter = clinics.length ? clinics : null;
  const ratingFocus = detectRatingFocus(prompt);

  const [totalReviews, focusCount, perRatingCounts] = await Promise.all([
    countReviews(supabase, clinicFilter, "all", undefined, filters.dateFrom, filters.dateTo),
    countReviews(supabase, clinicFilter, ratingFocus, undefined, filters.dateFrom, filters.dateTo),
    Promise.all([1, 2, 3, 4, 5].map((rating) => countReviews(supabase, clinicFilter, "all", rating, filters.dateFrom, filters.dateTo))),
  ]);

  const reviews = await fetchReviewsForFallback(supabase, clinicFilter, ratingFocus, filters.dateFrom, filters.dateTo);
  if (!reviews.length) {
    return `I couldn't find relevant reviews for that request. Try a different clinic or timeframe.`;
  }

  const chunks = chunkArray(reviews, chunkSize);
  const chunkSummaries: string[] = [];

  for (const chunk of chunks) {
    const chunkContext = chunk
      .map((rev: any) => {
        const date = rev.published_at ? new Date(rev.published_at).toISOString().split("T")[0] : "unknown date";
        const snippet = truncate(rev.text ?? "", 380);
        return `Rating: ${rev.rating}/5 | Clinic: ${rev.clinic_name} | Date: ${date}\n${snippet}`;
      })
      .join("\n\n");

    const chunkPrompt = `You are analyzing customer reviews for Neko Health.

Question: "${prompt}"
Rating focus: ${ratingFocus}

Reviews:
${chunkContext}

Summarize the key points that answer the question. Highlight recurring themes, quantify counts when possible, and mention strong quotes or issues. Be concise but specific.`;

    const summary = await callOpenAI(chunkPrompt, false);
    if (summary) {
      chunkSummaries.push(summary);
    }
  }

  const ratingBreakdown = [1, 2, 3, 4, 5]
    .map((rating, idx) => `${rating}★: ${perRatingCounts[idx] ?? 0}`)
    .join(" | ");

  const statsBlock = `Total reviews analyzed: ${totalReviews}\nFocus subset (${ratingFocus}): ${focusCount}\nRating breakdown: ${ratingBreakdown}`;

  const finalPrompt = `You are Nekovibe, an expert analyst. Combine the following chunk insights and stats to answer the question "${prompt}".

Context:
${statsBlock}

Chunk insights:
${chunkSummaries.map((s, idx) => `Chunk ${idx + 1}:\n${s}`).join("\n\n")}

Deliver a single cohesive answer. Reference the rating focus when helpful, quantify sentiment, and mention concrete examples.`;

  const finalAnswer = await callOpenAI(finalPrompt, true);
  return (
    finalAnswer ??
    `${statsBlock}\n\nTop insights:\n${chunkSummaries
      .slice(0, 2)
      .map((s, idx) => `${idx + 1}. ${s}`)
      .join("\n")}`
  );
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function callOpenAI(content: string, finalStep = false): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: finalStep ? 0.3 : 0.15,
      messages: [
        { role: "system", content: "You are Nekovibe, an expert summarizer focused on Neko Health customer sentiment." },
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
