import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      global: { headers: { "X-Client-Info": "nekovibe-generate-topics" } },
    });

    // Fetch recent reviews from both public tables
    const [gRes, tRes] = await Promise.all([
      supabase
        .from("google_reviews")
        .select("text, rating, clinic_name")
        .not("text", "is", null)
        .order("published_at", { ascending: false })
        .limit(350),
      supabase
        .from("trustpilot_reviews")
        .select("text, rating, clinic_name")
        .not("text", "is", null)
        .order("published_at", { ascending: false })
        .limit(150),
    ]);

    const allReviews = [
      ...(gRes.data || []).map((r: any) => ({ ...r, source: "google" })),
      ...(tRes.data || []).map((r: any) => ({ ...r, source: "trustpilot" })),
    ];

    if (allReviews.length === 0) {
      return respond({ error: "No reviews found in database" }, 400);
    }

    console.log(`Analyzing ${allReviews.length} reviews for topic extraction`);

    // Format reviews for LLM — keep them concise
    const reviewsText = allReviews
      .filter((r: any) => r.text && r.text.trim().length > 20)
      .slice(0, 400)
      .map((r: any, i: number) =>
        `[${i + 1}] (${r.rating}★ · ${r.clinic_name || "Neko Health"}) ${r.text.substring(0, 220).replace(/\n/g, " ")}`
      )
      .join("\n");

    const prompt = `You are a customer experience analyst for Neko Health (preventive health check clinics in UK and Sweden).

Analyze these customer reviews and identify the TOP 20 recurring topics — both what customers praise and what they complain about.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "topics": [
    {
      "name": "Wait Times",
      "slug": "wait-times",
      "description": "How long patients wait at the clinic or for results",
      "sentiment": "negative",
      "keywords": ["wait", "waiting", "queue", "delay", "slow", "time"]
    }
  ]
}

Rules:
- Exactly 20 topics
- Mix of positive and negative (aim for ~10 each, adjust based on data)
- "sentiment" must be one of: "positive", "negative", "mixed"
- "keywords" must be 5-8 lowercase strings that would find reviews about this topic
- Topics should be distinct — no overlap
- Focus on topics a Customer Support Lead would want to track

Reviews:
${reviewsText}`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      throw new Error(`OpenAI error: ${errText}`);
    }

    const completion = await openaiRes.json();
    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const parsed = JSON.parse(content);
    const topics: any[] = parsed.topics || [];

    if (topics.length === 0) throw new Error("No topics extracted from OpenAI response");

    // Count how many reviews mention each topic (approximate, keyword match)
    const topicsWithCounts = topics.map((topic: any) => {
      const keywords: string[] = topic.keywords || [];
      const count = allReviews.filter((r: any) => {
        const text = (r.text || "").toLowerCase();
        return keywords.some((kw) => text.includes(kw.toLowerCase()));
      }).length;
      return { ...topic, review_count: count };
    });

    // Sort by review_count descending
    topicsWithCounts.sort((a: any, b: any) => b.review_count - a.review_count);

    // Upsert each topic — update if slug exists
    let upserted = 0;
    for (const topic of topicsWithCounts) {
      const { error } = await supabase.from("review_topics").upsert(
        {
          name: topic.name,
          slug: topic.slug,
          description: topic.description || null,
          sentiment: topic.sentiment || "mixed",
          keywords: topic.keywords || [],
          review_count: topic.review_count,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" },
      );
      if (!error) upserted++;
      else console.error(`Failed to upsert topic ${topic.slug}:`, error);
    }

    console.log(`Upserted ${upserted}/${topicsWithCounts.length} topics`);

    return respond({
      success: true,
      reviews_analyzed: allReviews.length,
      topics_generated: topicsWithCounts.length,
      topics_upserted: upserted,
      topics: topicsWithCounts.map((t: any) => ({
        name: t.name,
        slug: t.slug,
        sentiment: t.sentiment,
        review_count: t.review_count,
      })),
    }, 200);
  } catch (error) {
    console.error("generate-topics failed:", error);
    return respond({ error: `${error}` }, 500);
  }
});

function respond(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
