import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm";

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

const CLINIC_MATCHERS = [
  { name: "Neko Health Marylebone", tokens: ["marylebone", "w1"] },
  { name: "Neko Health Spitalfields", tokens: ["spitalfields", "liverpool street"] },
  { name: "Neko Health Manchester", tokens: ["manchester", "lincoln square"] },
  { name: "Neko Health Ostermalmstorg", tokens: ["östermalm", "ostermalm", "ostermalmstorg", "stockholm", "sweden"] },
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
    const { prompt, sources = ["reviews"], useFallback = false } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return respond({ error: "prompt is required" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { "X-Client-Info": "nekovibe-edge-function" } },
    });

    // Detect clinic and source type from prompt
    const detectedClinics = detectClinics(prompt);
    const detectedSourceType = detectSourceType(prompt, sources);

    // If fallback is requested, run raw data analysis (fast SQL, no LLM)
    if (useFallback) {
      const fallbackAnswer = await generateFallbackAnswer(supabase, prompt, detectedClinics);
      return respond(
        {
          answer: fallbackAnswer ?? "I couldn't generate a fallback answer right now.",
          usedFallback: true,
          usedSources: ["reviews"],
          model: "raw-data",
          clinicsConsidered: detectedClinics.length ? detectedClinics : "all clinics",
        },
        200,
      );
    }

    // Check if ONLY articles/press is selected
    const hasArticlesSource = sources.includes("articles");
    const hasReviewsSource = sources.includes("reviews");
    const onlyArticles = hasArticlesSource && !hasReviewsSource;

    // Step 1: Fetch relevant summaries (ONLY if not articles-only)
    const summaries = onlyArticles ? [] : await fetchSummaries(supabase, detectedClinics, detectedSourceType);

    // Step 1.5: Fetch Tavily/Web insights (ALWAYS if articles selected, REQUIRED if articles-only)
    const perplexityInsights = hasArticlesSource ? await fetchPerplexityInsights(supabase) : [];
    
    // If articles-only and no insights available, return early
    if (onlyArticles && perplexityInsights.length === 0) {
      return respond({
        answer: "No web search insights are currently available. The system is configured to fetch comprehensive market analysis and recent news trends, but data collection is pending. Please try again later or use the 'Run another web search' button for a real-time search.",
        usedSources: ["articles"],
      }, 200);
    }

    // Step 2: Perform targeted text search on feedback_items (ONLY if not articles-only)
    const searchResults = onlyArticles ? [] : await searchFeedbackItems(
      supabase,
      prompt,
      detectedClinics,
      detectedSourceType,
    );

    // Step 3: Build single LLM prompt with summaries + snippets + Tavily/Web insights
    // If articles-only, only use Tavily insights
    const answer = await generateAnswer(prompt, summaries, searchResults, detectedClinics, perplexityInsights, onlyArticles);

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

async function fetchPerplexityInsights(supabase: any): Promise<any[]> {
  const insights: any[] = [];

  // Fetch both comprehensive and recent insights
  const { data: comprehensive, error: comprehensiveError } = await supabase
    .from("perplexity_insights")
    .select("*")
    .eq("scope", "comprehensive")
    .single();

  if (comprehensive && !comprehensiveError) {
    insights.push({
      label: "[Web Search: Comprehensive Market Analysis]",
      scope: "comprehensive",
      ...comprehensive,
    });
  }

  const { data: recent, error: recentError } = await supabase
    .from("perplexity_insights")
    .select("*")
    .eq("scope", "last_7_days")
    .single();

  if (recent && !recentError) {
    insights.push({
      label: "[Web Search: Latest 7 Days News & Trends]",
      scope: "last_7_days",
      ...recent,
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
    : `You are Nekovibe, an expert analyst summarizing what people say about Neko Health based on reviews, articles, and social posts.

CRITICAL RULES:
- Only use the provided summaries and snippets as ground truth
- Do NOT invent details that are not in the data
- Use summaries to describe overall patterns and trends
- Use snippets as concrete examples (you can quote/paraphrase)
- If the question is very specific and there is little or no data, say that explicitly
- If the question targets one clinic, focus on that clinic first, then compare to others only if clearly present in data
- NEVER make medical claims; you are only reflecting user feedback and public mentions
- Be honest and balanced - mention both positive and negative feedback when present`;

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
    userMessage = `Question: "${prompt}"

Context - Summaries (overall patterns):
${summariesBlock || "No summaries available."}

Context - Web Search Market Intelligence (comprehensive web analysis):
${perplexityBlock || "No web search insights available."}

Context - Example Snippets (concrete examples):
${snippetsBlock || "No specific examples found."}

Instructions:
- Answer the question using ONLY the summaries and snippets above
- Use summaries to describe overall patterns and trends
- Use snippets as concrete examples (you can quote/paraphrase)
- If the question targets specific clinics (${clinics.length ? clinics.join(", ") : "all clinics"}), prioritize those clinics
- Be specific and quantitative when possible
- If there's insufficient data, say so explicitly`;
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
      temperature: articlesOnly ? 0.5 : 0.3, // Higher temperature for articles-only to get more varied answers
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
): Promise<number> {
  let query = supabase.from("google_reviews").select("id", { count: "exact", head: true });

  if (clinicFilter && clinicFilter.length) {
    query = query.in("clinic_name", clinicFilter);
  }

  query = applyRatingFilter(query, ratingFocus);

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
): Promise<string | null> {
  const clinicFilter = clinics.length ? clinics : null;
  const ratingFocus = detectRatingFocus(prompt);

  const [totalReviews, focusCount, perRatingCounts] = await Promise.all([
    countReviews(supabase, clinicFilter, "all"),
    countReviews(supabase, clinicFilter, ratingFocus),
    Promise.all([1, 2, 3, 4, 5].map((rating) => countReviews(supabase, clinicFilter, "all", rating))),
  ]);

  const reviews = await fetchReviewsForFallback(supabase, clinicFilter, ratingFocus);
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
