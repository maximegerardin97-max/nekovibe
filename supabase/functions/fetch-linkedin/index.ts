/**
 * Fetch LinkedIn Edge Function
 * Searches for LinkedIn posts about Neko Health using Tavily API and stores them in the articles table
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

interface TavilyResult {
  title: string;
  url: string;
  published_date?: string;
  author?: string;
  content: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!tavilyApiKey) {
      return respond({ error: "TAVILY_API_KEY not configured" }, 400);
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return respond({ error: "Supabase credentials not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const searchTerms = [
      'Neko Health',
      '"Neko Health"',
    ];

    let totalAdded = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const allPosts: TavilyResult[] = [];

    // Search LinkedIn for each search term
    for (const searchTerm of searchTerms) {
      console.log(`Searching LinkedIn for: "${searchTerm}"`);

      try {
        const query = `site:linkedin.com ${searchTerm}`;
        const response = await fetch(tavilyApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: tavilyApiKey.trim(),
            query: query,
            search_depth: "basic",
            include_answer: false,
            include_images: false,
            include_raw_content: false,
            max_results: 20,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Tavily API error: ${response.status} ${errorText}`);
          errors.push(`Failed to fetch "${searchTerm}": ${errorText}`);
          continue;
        }

        const data: any = await response.json();
        const results = data.results || [];
        
        // Filter to only LinkedIn URLs
        const linkedinResults = results.filter((r: any) => 
          r.url && r.url.includes('linkedin.com')
        );
        
        console.log(`Found ${linkedinResults.length} LinkedIn posts for "${searchTerm}"`);
        allPosts.push(...linkedinResults.map((r: any) => ({
          title: r.title || 'LinkedIn Post',
          url: r.url,
          published_date: r.published_date,
          author: r.author,
          content: r.content || '',
        })));
      } catch (error) {
        console.error(`Error fetching "${searchTerm}":`, error);
        errors.push(`Error fetching "${searchTerm}": ${error}`);
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const uniquePosts: TavilyResult[] = [];
    for (const post of allPosts) {
      const url = post.url.toLowerCase().split('?')[0].split('#')[0];
      if (!seen.has(url)) {
        seen.add(url);
        uniquePosts.push(post);
      }
    }

    console.log(`Processing ${uniquePosts.length} unique LinkedIn posts`);

    // Store each post
    for (const post of uniquePosts) {
      try {
        // Check if already exists
        const { data: existing } = await supabase
          .from('articles')
          .select('id')
          .eq('external_id', post.url)
          .single();

        if (existing) {
          totalSkipped++;
          continue;
        }

        // Insert LinkedIn post
        const { error: insertError } = await supabase.from('articles').insert({
          external_id: post.url,
          source: 'linkedin',
          title: post.title,
          description: post.content?.substring(0, 500) || '',
          url: post.url,
          author: post.author || undefined,
          published_at: post.published_date ? new Date(post.published_date).toISOString() : null,
          content: post.content || '',
          metadata: {},
        });

        if (insertError) {
          console.error(`Error storing LinkedIn post ${post.url}:`, insertError);
          errors.push(`Failed to store: ${post.title}`);
        } else {
          totalAdded++;
          console.log(`✅ Stored: ${post.title}`);
        }
      } catch (error) {
        console.error(`Error processing LinkedIn post ${post.url}:`, error);
        errors.push(`Error processing: ${post.title}`);
      }
    }

    return respond({
      success: true,
      added: totalAdded,
      skipped: totalSkipped,
      total_found: uniquePosts.length,
      errors: errors.length > 0 ? errors : undefined,
    }, 200);
  } catch (error) {
    console.error("fetch-linkedin failed:", error);
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

