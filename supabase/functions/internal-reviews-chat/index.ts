/**
 * Internal Reviews Chat Edge Function
 * Smart chat that uses latest reviews + summaries for fast, accurate responses
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";


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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, analyzeAll = false, filters = null } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return respond({ error: "prompt is required" }, 400);
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return respond({ error: "Supabase credentials not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const normalizedFilters = normalizeFilters(filters);

    // Fetch relevant data based on analyzeAll flag
    let reviews: any[] = [];
    let summaries: any[] = [];

    if (analyzeAll) {
      // Get all reviews for comprehensive analysis
      let allQuery = supabase
        .from("internal_reviews")
        .select("published_at, rating, clinic_name, comment")
        .order("published_at", { ascending: false })
        .limit(1000);

      if (normalizedFilters.clinic.length) {
        allQuery = allQuery.in("clinic_name", normalizedFilters.clinic);
      }
      allQuery = applyDateRange(allQuery, "published_at", normalizedFilters.dateFrom, normalizedFilters.dateTo);

      const { data: allReviews } = await allQuery;
      
      reviews = allReviews || [];
    } else {
      // Get latest reviews (from most recent upload or last week/month)
      const { data: latestBatch } = await supabase
        .from("internal_reviews")
        .select("upload_batch_id")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .single();

      if (latestBatch?.upload_batch_id) {
        let latestQuery = supabase
          .from("internal_reviews")
          .select("published_at, rating, clinic_name, comment")
          .eq("upload_batch_id", latestBatch.upload_batch_id)
          .order("published_at", { ascending: false });

        if (normalizedFilters.clinic.length) {
          latestQuery = latestQuery.in("clinic_name", normalizedFilters.clinic);
        }
        latestQuery = applyDateRange(latestQuery, "published_at", normalizedFilters.dateFrom, normalizedFilters.dateTo);

        const { data: latestReviews } = await latestQuery;
        
        reviews = latestReviews || [];
      }

      // Also get last week and last month reviews
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const monthAgo = new Date();
      monthAgo.setDate(monthAgo.getDate() - 30);

      let weekQuery = supabase
        .from("internal_reviews")
        .select("published_at, rating, clinic_name, comment")
        .gte("published_at", weekAgo.toISOString())
        .order("published_at", { ascending: false })
        .limit(200);

      if (normalizedFilters.clinic.length) {
        weekQuery = weekQuery.in("clinic_name", normalizedFilters.clinic);
      }
      weekQuery = applyDateRange(weekQuery, "published_at", normalizedFilters.dateFrom, normalizedFilters.dateTo);

      const { data: weekReviews } = await weekQuery;

      let monthQuery = supabase
        .from("internal_reviews")
        .select("published_at, rating, clinic_name, comment")
        .gte("published_at", monthAgo.toISOString())
        .order("published_at", { ascending: false })
        .limit(500);

      if (normalizedFilters.clinic.length) {
        monthQuery = monthQuery.in("clinic_name", normalizedFilters.clinic);
      }
      monthQuery = applyDateRange(monthQuery, "published_at", normalizedFilters.dateFrom, normalizedFilters.dateTo);

      const { data: monthReviews } = await monthQuery;

      // Combine and deduplicate
      const allRecent = [...(weekReviews || []), ...(monthReviews || [])];
      const seen = new Set<string>();
      reviews = allRecent.filter(r => {
        const key = `${r.published_at}_${r.clinic_name}_${r.comment.substring(0, 50)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Fetch summaries
    const { data: summaryData } = await supabase
      .from("internal_review_summaries")
      .select("scope, summary_text, reviews_covered_count, upload_batch_id")
      .order("last_refreshed_at", { ascending: false });

    summaries = summaryData || [];

    // Generate answer using OpenAI
    const answer = await generateAnswer(prompt, reviews, summaries, analyzeAll);

    return respond({
      answer,
      reviews_used: reviews.length,
      summaries_used: summaries.length,
      analyze_all: analyzeAll,
    }, 200);
  } catch (error) {
    console.error("internal-reviews-chat failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

async function generateAnswer(
  prompt: string,
  reviews: any[],
  summaries: any[],
  analyzeAll: boolean
): Promise<string> {
  if (!openaiApiKey) {
    return "OpenAI API key not configured.";
  }

  // Build context from summaries
  let contextText = "";
  if (summaries.length > 0) {
    contextText = "PRE-COMPUTED SUMMARIES:\n\n";
    summaries.forEach((s, idx) => {
      contextText += `Summary ${idx + 1} (${s.scope}, ${s.reviews_covered_count} reviews):\n${s.summary_text}\n\n`;
    });
  }

  // Add specific review examples (focus on sentiment)
  let reviewsText = "";
  if (reviews.length > 0) {
    reviewsText = `\n\nSPECIFIC REVIEW EXAMPLES (${reviews.length} reviews):\n\n`;
    reviews.slice(0, 100).forEach((r, idx) => {
      const date = r.published_at ? new Date(r.published_at).toLocaleDateString() : "Unknown";
      reviewsText += `${idx + 1}. [${date}] ${r.clinic_name} - ${r.rating}/5: "${r.comment}"\n`;
    });
  }

  const systemMessage = `You are Nekovibe, an expert analyst for internal reviews at Neko Health.

CRITICAL RULES:
- Focus on SENTIMENT ANALYSIS - identify exact wording and formulations
- Be QUANTITATIVE - always provide numbers: "X out of Y reviews mentioned [issue]"
- Be CONCISE - max 100 words unless more detail is explicitly requested
- Use the summaries for overall patterns, use specific reviews for examples
- When mentioning negative feedback, ALWAYS quantify: "5 out of 320 reviews (1.6%) were negative"
- When citing specific problems, state how many reviews mentioned it
- Lead with numbers and key facts
- Use bullet points for multiple distinct data points

SENTIMENT ANALYSIS REQUIREMENT:
- Pay close attention to exact wording and formulations
- Distinguish between: complaints, criticisms, suggestions, neutral observations, praise
- Quote or paraphrase specific phrases when relevant
- Identify patterns in how customers express concerns

RESPONSE FORMAT:
- Keep replies concise, max 100 words unless more detail is explicitly requested
- Lead with numbers and key facts
- Example: "Marylebone: 45 of 200 reviews (22.5%) mention wait times. Spitalfields: 12 of 150 (8%)."
- Example: "Average rating 4.2/5 (180 five-star, 45 four-star, 12 three-star, 3 two-star, 0 one-star)"
- Example: "5 out of 320 reviews (1.6%) were negative. 3 criticized booking flow, 2 mentioned wait times."`;

  const userMessage = `${contextText}${reviewsText}

User Question: ${prompt}

${analyzeAll ? "NOTE: User requested analysis of ALL reviews. Provide comprehensive answer." : "NOTE: Focus on latest reviews and recent patterns."}

Answer the question based on the summaries and review examples above. Be quantitative, concise, and focus on sentiment analysis.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", errorText);
      return "I couldn't generate an answer right now. Please try again.";
    }

    const completion = await response.json();
    return completion?.choices?.[0]?.message?.content?.trim() ?? "No answer returned.";
  } catch (error) {
    console.error("Error calling OpenAI:", error);
    return "I encountered an error. Please try again.";
  }
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

