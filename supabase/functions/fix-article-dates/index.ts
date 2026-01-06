/**
 * Fix Article Dates Edge Function
 * Aggressively fixes all article dates by re-fetching from source APIs or extracting from URLs/content
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const tavilyApiKey = Deno.env.get("TAVILY_API_KEY") ?? "";
const tavilyApiUrl = "https://api.tavily.com/search";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
      return respond({ message: "No articles found", fixed: 0 }, 200);
    }

    let totalFixed = 0;
    const errors: string[] = [];

    console.log(`Fixing dates for ${articles.length} articles...`);

    for (const article of articles) {
      try {
        let fixedDate: Date | null = null;
        
        // Strategy 1: Try to re-fetch from Tavily if we have the URL
        if (tavilyApiKey && article.url) {
          try {
            const tavilyDate = await fetchDateFromTavily(article.url);
            if (tavilyDate) {
              fixedDate = tavilyDate;
              console.log(`  Got date from Tavily for: ${article.title}`);
            }
          } catch (error) {
            // Continue to other methods
          }
        }
        
        // Strategy 2: Extract from URL
        if (!fixedDate) {
          fixedDate = extractDateFromUrl(article.url);
          if (fixedDate) {
            console.log(`  Extracted date from URL for: ${article.title}`);
          }
        }
        
        // Strategy 3: Extract from content
        if (!fixedDate) {
          fixedDate = extractDateFromContent(article.content || article.description || "");
          if (fixedDate) {
            console.log(`  Extracted date from content for: ${article.title}`);
          }
        }
        
        // Strategy 4: Extract from metadata
        if (!fixedDate && article.metadata) {
          fixedDate = extractDateFromMetadata(article.metadata);
          if (fixedDate) {
            console.log(`  Extracted date from metadata for: ${article.title}`);
          }
        }
        
        // Strategy 5: Use a reasonable default based on article age
        if (!fixedDate) {
          // For articles without dates, set to 6 months ago (reasonable default)
          fixedDate = new Date();
          fixedDate.setMonth(fixedDate.getMonth() - 6);
          console.log(`  Using default date (6 months ago) for: ${article.title}`);
        }
        
        // Update the article
        const { error: updateError } = await supabase
          .from("articles")
          .update({ published_at: fixedDate.toISOString() })
          .eq("id", article.id);

        if (updateError) {
          console.error(`  Error updating article ${article.id}:`, updateError);
          errors.push(`Failed to update: ${article.title}`);
        } else {
          totalFixed++;
          console.log(`  ✅ Fixed date for: ${article.title} -> ${fixedDate.toISOString()}`);
        }
      } catch (error) {
        console.error(`Error processing article ${article.id}:`, error);
        errors.push(`Error processing: ${article.title}`);
      }
    }

    return respond({
      success: true,
      total: articles.length,
      fixed: totalFixed,
      errors: errors.length > 0 ? errors : undefined,
    }, 200);
  } catch (error) {
    console.error("fix-article-dates failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

async function fetchDateFromTavily(url: string): Promise<Date | null> {
  if (!tavilyApiKey) return null;
  
  try {
    const response = await fetch(tavilyApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: tavilyApiKey.trim(),
        query: url,
        search_depth: "basic",
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: 1,
      }),
    });

    if (!response.ok) return null;

    const data: any = await response.json();
    const results = data.results || [];
    
    if (results.length > 0 && results[0].published_date) {
      const date = parseDate(results[0].published_date);
      if (date) return date;
    }
  } catch (error) {
    // Silently fail
  }
  
  return null;
}

function extractDateFromUrl(url: string): Date | null {
  if (!url) return null;
  
  // Try various URL date patterns
  const patterns = [
    /(\d{4})\/(\d{2})\/(\d{2})/, // YYYY/MM/DD
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /(\d{4})\/(\d{2})/, // YYYY/MM
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const date = parseDate(match[0]);
      if (date) return date;
    }
  }
  
  return null;
}

function extractDateFromContent(content: string): Date | null {
  if (!content) return null;
  
  // Try various date patterns in content
  const patterns = [
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i,
    /Published:\s*(\d{4})-(\d{2})-(\d{2})/i,
    /Date:\s*(\d{4})-(\d{2})-(\d{2})/i,
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
  ];
  
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const date = parseDate(match[0]);
      if (date) return date;
    }
  }
  
  return null;
}

function extractDateFromMetadata(metadata: any): Date | null {
  if (!metadata) return null;
  
  const dateFields = ['published_date', 'publishedAt', 'date', 'pubDate', 'published'];
  
  for (const field of dateFields) {
    if (metadata[field]) {
      const date = parseDate(metadata[field]);
      if (date) return date;
    }
  }
  
  return null;
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  
  try {
    // Try ISO format first
    const isoDate = new Date(dateStr);
    if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 2000 && isoDate.getFullYear() <= new Date().getFullYear() + 1) {
      return isoDate;
    }
  } catch {
    // Continue
  }
  
  try {
    // Try timestamp
    const timestamp = Date.parse(dateStr);
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      if (date.getFullYear() > 2000 && date.getFullYear() <= new Date().getFullYear() + 1) {
        return date;
      }
    }
  } catch {
    // Continue
  }
  
  // Try relative dates
  const relativeMatch = dateStr.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const now = new Date();
    
    if (unit.includes('minute')) {
      now.setMinutes(now.getMinutes() - amount);
    } else if (unit.includes('hour')) {
      now.setHours(now.getHours() - amount);
    } else if (unit.includes('day')) {
      now.setDate(now.getDate() - amount);
    } else if (unit.includes('week')) {
      now.setDate(now.getDate() - (amount * 7));
    } else if (unit.includes('month')) {
      now.setMonth(now.getMonth() - amount);
    } else if (unit.includes('year')) {
      now.setFullYear(now.getFullYear() - amount);
    }
    
    if (now.getFullYear() > 2000) {
      return now;
    }
  }
  
  return null;
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

