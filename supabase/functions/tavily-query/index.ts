/**
 * Tavily Query Edge Function
 * On-demand web search using Tavily API (alternative to Perplexity)
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const tavilyApiKey = Deno.env.get("TAVILY_API_KEY") ?? "";
const tavilyApiUrl = "https://api.tavily.com/search";

const TAVILY_UNAVAILABLE_MESSAGE = `Tavily API is currently unavailable. 

This feature allows you to search the web in real-time for the latest news, articles, and discussions about Neko Health. Once the Tavily API is configured, you'll be able to get fresh insights from across the internet.

For now, please use the "Query full dataset" button to get comprehensive answers from our stored reviews and summaries.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return respond({ error: "prompt is required" }, 400);
    }

    // Check if Tavily API is available
    if (!tavilyApiKey) {
      console.warn("TAVILY_API_KEY not set - returning placeholder");
      return respond({
        answer: TAVILY_UNAVAILABLE_MESSAGE,
        citations: [],
        unavailable: true,
      }, 200);
    }

    // Log API key status (first 10 chars only for security)
    console.log("Tavily API key present:", tavilyApiKey ? `${tavilyApiKey.substring(0, 10)}...` : "MISSING");

    // Build context-aware query for Tavily
    const contextualQuery = `Neko Health: ${prompt}. Include recent news, articles, press mentions, social media discussions, reviews, and market analysis.`;

    console.log("Calling Tavily API with query:", contextualQuery.substring(0, 100) + "...");

    const response = await fetch(tavilyApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: tavilyApiKey.trim(),
        query: contextualQuery,
        search_depth: "advanced",
        include_answer: true,
        include_images: false,
        include_raw_content: false,
        max_results: 15,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Tavily API error:", response.status, errorText);
      // Return placeholder instead of error
      return respond({
        answer: TAVILY_UNAVAILABLE_MESSAGE,
        citations: [],
        unavailable: true,
      }, 200);
    }

    const data = await response.json();
    
    // Extract answer and citations
    const answer = data.answer || formatResults(data.results || []);
    const citations = (data.results || []).map((r: any) => ({
      url: r.url,
      title: r.title,
      published_date: r.published_date,
    }));

    return respond(
      {
        answer,
        citations,
        provider: "tavily",
        results_count: data.results?.length || 0,
        response_time: data.response_time || 0,
      },
      200,
    );
  } catch (error) {
    console.error("tavily-query failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

function formatResults(results: any[]): string {
  if (results.length === 0) {
    return "No results found for this query.";
  }

  const summary = results
    .slice(0, 10)
    .map((r, idx) => {
      const title = r.title || "Untitled";
      const url = r.url || "";
      const snippet = r.content ? r.content.substring(0, 300) + "..." : "";
      return `[${idx + 1}] ${title}\n${url}\n${snippet}`;
    })
    .join("\n\n");

  return `Found ${results.length} relevant sources:\n\n${summary}`;
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

