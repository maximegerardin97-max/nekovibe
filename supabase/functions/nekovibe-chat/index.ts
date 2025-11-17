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
const reviewFetchLimit = Number(Deno.env.get("NEKOVIBE_REVIEW_FETCH_LIMIT") ?? "400");
const chunkSize = Number(Deno.env.get("NEKOVIBE_CHUNK_SIZE") ?? "40");

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

    // If fallback is requested, use old chunking approach
    if (useFallback) {
      const fallbackAnswer = await generateFallbackAnswer(supabase, prompt, detectedClinics);
      return respond(
        {
          answer: fallbackAnswer ?? "I couldn't generate a fallback answer right now.",
          usedFallback: true,
          usedSources: ["reviews"],
          model: openaiModel,
          clinicsConsidered: detectedClinics.length ? detectedClinics : "all clinics",
        },
        200,
      );
    }

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

  return await generateAnswerWithOpenAI(prompt, systemMessage, userMessage);
}

async function generateAnswerWithOpenAI(
  prompt: string,
  systemMessage: string,
  userMessage: string,
): Promise<string | null> {
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

async function generateFallbackAnswer(
  supabase: any,
  prompt: string,
  clinics: string[],
): Promise<string | null> {
  // Fallback: Use old chunking approach with google_reviews table
  // Fetch ALL reviews (no clinic filter, no limit) for comprehensive analysis
  console.log("Fallback: Fetching ALL reviews from google_reviews table");
  
  // Only filter by clinic if the question is specifically about one clinic
  // For general questions (like "how many reviews are not 5 stars"), get ALL reviews
  const isSpecificClinicQuestion = clinics.length > 0 && /\b(only|just|specifically|that clinic|this clinic)\b/i.test(prompt);
  
  if (isSpecificClinicQuestion && clinics.length > 0) {
    console.log(`Filtering by clinics: ${clinics.join(", ")}`);
  } else {
    console.log("No clinic filter - fetching all reviews");
  }

  // Fetch ALL reviews with pagination
  let allReviews: any[] = [];
  let page = 0;
  const pageSize = 1000; // Supabase max per request
  
  while (true) {
    // Rebuild query for each page to avoid state issues
    let pageQuery = supabase
      .from("google_reviews")
      .select("clinic_name, author_name, rating, text, published_at")
      .order("published_at", { ascending: false });
    
    if (isSpecificClinicQuestion && clinics.length > 0) {
      pageQuery = pageQuery.in("clinic_name", clinics);
    }
    
    const { data: pageReviews, error } = await pageQuery
      .range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error) {
      console.error("Error fetching reviews:", error);
      break;
    }
    
    if (!pageReviews || pageReviews.length === 0) {
      break; // No more reviews
    }
    
    allReviews = allReviews.concat(pageReviews);
    console.log(`Fetched page ${page + 1}: ${pageReviews.length} reviews (total: ${allReviews.length})`);
    
    if (pageReviews.length < pageSize) {
      break; // Last page
    }
    
    page++;
    
    // Safety limit: don't fetch more than 10,000 reviews
    if (allReviews.length >= 10000) {
      console.warn("Reached safety limit of 10,000 reviews");
      break;
    }
  }
  
  if (allReviews.length === 0) {
    console.log("No reviews found");
    return null;
  }

  console.log(`Fallback: Processing ${allReviews.length} total reviews in chunks of ${chunkSize}`);
  const reviews = allReviews;

  const chunks = chunkArray(reviews, chunkSize);
  const chunkSummaries: string[] = [];

  for (const chunk of chunks) {
      const chunkContext = chunk
      .map((rev: any) => {
          const date = rev.published_at ? new Date(rev.published_at).toISOString().split("T")[0] : "unknown";
          const snippet = truncate(rev.text ?? "", 480);
          return `Clinic: ${rev.clinic_name}\nDate: ${date}\nRating: ${rev.rating}/5\nAuthor: ${rev.author_name}\nReview: ${snippet}`;
        })
        .join("\n\n");

      const chunkPrompt = `Question: """${prompt}"""\n\nReviews:\n${chunkContext}\n\nSummarize only what is relevant to the question above. Highlight concrete insights, sentiment, and actionable details. Be specific with numbers and counts when the question asks for them.`;

      const summary = await callOpenAI(chunkPrompt, false);
      chunkSummaries.push(summary ?? "(no insight)");
      console.log(`Processed chunk ${chunkSummaries.length}/${chunks.length}`);
    }

    const finalPrompt = `You are Nekovibe, an expert analyst. Combine the insights below into a single, crisp answer for the question "${prompt}". 

CRITICAL: If the question asks for a count, number, or total, you MUST provide the exact number. Add up counts from all chunks if needed. Be precise and quantitative.

Prioritize specifics, quantify whenever possible, and surface patterns or outliers.

Total reviews analyzed: ${reviews.length}

Chunk insights:
${chunkSummaries.map((s, idx) => `Chunk ${idx + 1}:\n${s}`).join("\n\n")}
`;

  console.log(`Fallback: Generating final answer from ${chunkSummaries.length} chunk summaries`);
  return await callOpenAI(finalPrompt, true);
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
