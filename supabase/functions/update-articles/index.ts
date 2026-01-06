/**
 * Update Articles Edge Function
 * Updates existing articles with summaries, post types, and better metadata
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Neko Health official LinkedIn identifiers
const NEKO_COMPANY_NAMES = ['neko health', 'nekoh', 'nekohealth'];
const NEKO_LINKEDIN_PATTERNS = ['/company/neko', '/company/neko-health', '/neko-health'];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return respond({ error: "Supabase credentials not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Get all articles
    const { data: articles, error: fetchError } = await supabase
      .from("articles")
      .select("id, external_id, source, title, author, url, content, description, published_at, metadata")
      .order("published_at", { ascending: false });

    if (fetchError) {
      return respond({ error: `Failed to fetch articles: ${fetchError.message}` }, 500);
    }

    if (!articles || articles.length === 0) {
      return respond({ message: "No articles found", updated: 0 }, 200);
    }

    let totalUpdated = 0;
    let totalSkipped = 0;
    const errors: string[] = [];

    console.log(`Processing ${articles.length} articles...`);

    for (const article of articles) {
      try {
        const updates: any = {};
        let needsUpdate = false;

        // Check if LinkedIn post needs categorization
        if (article.source === "linkedin") {
          const currentPostType = article.metadata?.post_type;
          if (!currentPostType) {
            const postType = categorizeLinkedInPost(
              article.url,
              article.author || "",
              article.content || article.description || ""
            );
            updates.metadata = {
              ...(article.metadata || {}),
              post_type: postType,
            };
            needsUpdate = true;
            console.log(`  Categorizing LinkedIn post: ${article.title} -> ${postType}`);
          }
        }

        // Check if article needs summary
        const hasSummary = article.metadata?.summary;
        const hasContent = (article.content || article.description || "").length > 200;
        
        if (!hasSummary && hasContent && openaiApiKey) {
          try {
            const summary = await summarizeContent(
              article.content || article.description || "",
              article.title || "Untitled"
            );
            
            if (summary) {
              updates.metadata = {
                ...(updates.metadata || article.metadata || {}),
                summary: summary,
              };
              needsUpdate = true;
              console.log(`  Generated summary for: ${article.title}`);
            }
          } catch (error) {
            console.warn(`  Failed to generate summary for ${article.title}:`, error);
            errors.push(`Failed to summarize: ${article.title}`);
          }
        }

        // Update if needed
        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from("articles")
            .update(updates)
            .eq("id", article.id);

          if (updateError) {
            console.error(`  Error updating article ${article.id}:`, updateError);
            errors.push(`Failed to update: ${article.title}`);
          } else {
            totalUpdated++;
          }
        } else {
          totalSkipped++;
        }
      } catch (error) {
        console.error(`Error processing article ${article.id}:`, error);
        errors.push(`Error processing: ${article.title}`);
      }
    }

    return respond({
      success: true,
      total: articles.length,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: errors.length > 0 ? errors : undefined,
    }, 200);
  } catch (error) {
    console.error("update-articles failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

function categorizeLinkedInPost(url: string, author: string, content: string): 'company_post' | 'organic_post' {
  const urlLower = url.toLowerCase();
  const authorLower = author.toLowerCase();
  const contentLower = content.toLowerCase();
  
  // Check if URL contains company patterns
  for (const pattern of NEKO_LINKEDIN_PATTERNS) {
    if (urlLower.includes(pattern)) {
      return 'company_post';
    }
  }
  
  // Check if author name matches company
  for (const companyName of NEKO_COMPANY_NAMES) {
    if (authorLower.includes(companyName)) {
      return 'company_post';
    }
  }
  
  // Check content for company mentions
  if (contentLower.includes('neko health') && (
    contentLower.includes('we ') || 
    contentLower.includes('our ') ||
    contentLower.includes('company') ||
    contentLower.includes('team')
  )) {
    return 'company_post';
  }
  
  return 'organic_post';
}

async function summarizeContent(content: string, title: string): Promise<string | null> {
  if (!openaiApiKey) return null;
  
  const prompt = `Summarize the following content about Neko Health in 2-3 sentences. Focus on key points and main message.

Title: ${title}

Content:
${content.substring(0, 4000)}`;

  try {
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
          {
            role: "system",
            content: "You are an expert at summarizing articles and social media posts. Provide concise, informative summaries.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const completion = await response.json();
    return completion?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    console.error("OpenAI summarization error:", error);
    return null;
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

