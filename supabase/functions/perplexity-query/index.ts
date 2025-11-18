import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const perplexityApiKey = Deno.env.get("PERPLEXITY_API_KEY") ?? "";
const perplexityApiUrl = "https://api.perplexity.ai/chat/completions";

if (!perplexityApiKey) {
  console.warn("PERPLEXITY_API_KEY not set.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return respond({ error: "prompt is required" }, 400);
    }

    // Build context-aware query for Perplexity
    const contextualPrompt = `You are researching Neko Health, a health check clinic company. 

Context about Neko Health:
- Neko Health operates health check clinics in multiple locations (Marylebone, Spitalfields, Manchester, Covent Garden, Ostermalmstorg/Stockholm)
- They use advanced technology for comprehensive health assessments
- They focus on preventive healthcare and early detection
- They have received positive reviews for their modern approach and professional staff

User Question: "${prompt}"

Provide a comprehensive, factual answer based on current web sources. Focus on:
- Recent news, articles, and press mentions
- Social media discussions
- Industry analysis
- Competitive positioning
- Public perception and sentiment

Cite all sources. Be specific and quantitative when possible.`;

    console.log("Calling Perplexity API with query:", contextualPrompt.substring(0, 100) + "...");

    const response = await fetch(perplexityApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${perplexityApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-large-128k-online",
        messages: [
          {
            role: "system",
            content: "You are a research assistant that provides comprehensive, factual analysis based on web sources. Always cite your sources.",
          },
          {
            role: "user",
            content: contextualPrompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Perplexity API error:", response.status, errorText);
      return respond(
        { error: "Failed to query Perplexity", details: errorText },
        response.status,
      );
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "No response from Perplexity";

    // Extract citations if available
    const citations = data.citations || [];

    return respond(
      {
        answer,
        citations,
        model: data.model,
        tokens_used: data.usage?.total_tokens || 0,
      },
      200,
    );
  } catch (error) {
    console.error("perplexity-query failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

function respond(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

