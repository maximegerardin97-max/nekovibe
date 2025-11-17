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
  skip_global?: boolean; // Skip global summaries to save time
  clinic_only?: string; // Process only this clinic
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
      return await generateAllSummaries(supabase, params.skip_global || false, params.clinic_only || null);
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

async function generateAllSummaries(supabase: any, skipGlobal: boolean = false, clinicOnly: string | null = null) {
  // Get all unique clinic_ids and source_types
  const { data: clinics, error: clinicError } = await supabase
    .from("feedback_items")
    .select("clinic_id")
    .not("clinic_id", "is", null);

  if (clinicError) {
    console.error("Failed to fetch clinics:", clinicError);
    return respond({ error: "Failed to fetch clinics", details: clinicError.message }, 500);
  }

  let uniqueClinics = [...new Set((clinics || []).map((c: any) => c.clinic_id))];
  
  // Filter to specific clinic if requested
  if (clinicOnly) {
    uniqueClinics = uniqueClinics.filter((c: string) => c === clinicOnly);
    console.log(`Processing only clinic: ${clinicOnly}`);
  }
  
  console.log(`Found ${uniqueClinics.length} unique clinics:`, uniqueClinics);
  
  const sourceTypes = ["google_review", "press_article", "social_post", "blog_post"];
  const scopes: ("all_time" | "last_90_days" | "last_30_days" | "last_7_days")[] = ["all_time", "last_90_days", "last_30_days", "last_7_days"];

  const results: any[] = [];
  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 240000; // 4 minutes - leave buffer before timeout

  // Generate global summaries (no clinic, all sources) - FORCE REFRESH
  if (!skipGlobal) {
    for (const scope of scopes) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.warn('⏰ Approaching timeout, stopping global summaries');
        break;
      }
      try {
        const result = await generateSummary(supabase, null, null, scope, true);
        results.push(result);
        console.log(`✅ Generated global summary for ${scope}`);
      } catch (error) {
        console.error(`❌ Failed global summary for ${scope}:`, error);
        results.push({
          clinic_id: null,
          source_type: null,
          scope,
          status: "error",
          error: `${error}`,
        });
      }
    }
  }

  // Generate per-clinic summaries - FORCE REFRESH
  let processedClinics = 0;
  for (const clinicId of uniqueClinics) {
    // Check timeout
    if (Date.now() - startTime > MAX_EXECUTION_TIME) {
      console.warn(`⏰ Approaching timeout. Processed ${processedClinics}/${uniqueClinics.length} clinics.`);
      return respond({
        message: "Partial completion - approaching timeout",
        processed: processedClinics,
        total: uniqueClinics.length,
        results,
        remaining_clinics: uniqueClinics.slice(processedClinics),
      }, 200);
    }
    
    console.log(`\n🔍 Processing clinic: "${clinicId}" (${processedClinics + 1}/${uniqueClinics.length})`);
    
    // Check if clinic has data
    const { count, error: countError } = await supabase
      .from("feedback_items")
      .select("*", { count: "exact", head: true })
      .eq("clinic_id", clinicId);
    
    if (countError) {
      console.error(`   ❌ Error checking count for ${clinicId}:`, countError);
      processedClinics++;
      continue;
    }
    
    console.log(`   Found ${count || 0} items for "${clinicId}"`);
    
    if (count === 0) {
      console.warn(`   ⚠️ Skipping ${clinicId} - no items found`);
      processedClinics++;
      continue;
    }
    
    // All sources for this clinic
    for (const scope of scopes) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        console.warn(`⏰ Timeout during ${clinicId} processing`);
        return respond({
          message: "Partial completion - timeout",
          processed: processedClinics,
          total: uniqueClinics.length,
          results,
          current_clinic: clinicId,
          remaining_clinics: uniqueClinics.slice(processedClinics),
        }, 200);
      }
      
      try {
        const result = await generateSummary(supabase, clinicId, null, scope, true);
        results.push(result);
        console.log(`   ✅ Generated summary for ${clinicId} (all sources, ${scope})`);
      } catch (error) {
        console.error(`   ❌ Failed summary for ${clinicId} (all sources, ${scope}):`, error);
        results.push({
          clinic_id: clinicId,
          source_type: null,
          scope,
          status: "error",
          error: `${error}`,
        });
      }
    }

    // Per-source for this clinic - only generate for sources that exist
    for (const sourceType of sourceTypes) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME) {
        break;
      }
      
      const { count: sourceCount } = await supabase
        .from("feedback_items")
        .select("*", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("source_type", sourceType);
      
      if (sourceCount === 0) {
        console.log(`   ⏭️  Skipping ${sourceType} for ${clinicId} (no data)`);
        continue;
      }
      
      for (const scope of scopes) {
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          break;
        }
        
        try {
          const result = await generateSummary(supabase, clinicId, sourceType, scope, true);
          results.push(result);
          console.log(`   ✅ Generated summary for ${clinicId} (${sourceType}, ${scope})`);
        } catch (error) {
          console.error(`   ❌ Failed summary for ${clinicId} (${sourceType}, ${scope}):`, error);
          results.push({
            clinic_id: clinicId,
            source_type: sourceType,
            scope,
            status: "error",
            error: `${error}`,
          });
        }
      }
    }
    
    processedClinics++;
  }

  return respond({
    message: "Generated all summaries",
    results,
    total: results.length,
    processed_clinics: processedClinics,
    total_clinics: uniqueClinics.length,
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
  // Delete existing summary first to avoid any conflicts
  let deleteQuery = supabase
    .from("feedback_summaries")
    .delete()
    .eq("scope", scope);
  
  if (clinicId === null) {
    deleteQuery = deleteQuery.is("clinic_id", null);
  } else {
    deleteQuery = deleteQuery.eq("clinic_id", clinicId);
  }
  
  if (sourceType === null) {
    deleteQuery = deleteQuery.is("source_type", null);
  } else {
    deleteQuery = deleteQuery.eq("source_type", sourceType);
  }
  
  await deleteQuery;

  // Insert new summary
  const { error } = await supabase
    .from("feedback_summaries")
    .insert({
      clinic_id: clinicId,
      source_type: sourceType,
      scope,
      summary_text: summaryText,
      items_covered_count: itemsCount,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error("Failed to insert summary:", error);
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

