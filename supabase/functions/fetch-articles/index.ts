/**
 * Fetch Articles Edge Function
 * Fetches articles about Neko Health from GNews API and stores them in the articles table
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const gnewsApiKey = Deno.env.get("GNEWS_API_KEY") ?? "";
const tavilyApiKey = Deno.env.get("TAVILY_API_KEY") ?? "";
const gnewsApiUrl = "https://gnews.io/api/v4";
const tavilyApiUrl = "https://api.tavily.com/search";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface GNewsArticle {
  title: string;
  description: string;
  content: string;
  url: string;
  image?: string;
  publishedAt: string;
  source: {
    name: string;
    url: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return respond({ error: "Supabase credentials not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const searchTerms = [
      'Neko Health',
      '"Neko Health"',
      'Neko Health clinic',
    ];

    let totalAdded = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const allArticles: any[] = [];

    // Fetch from GNews (if available)
    if (gnewsApiKey) {
      for (const searchTerm of searchTerms) {
        console.log(`Searching GNews for: "${searchTerm}"`);

        try {
          const params = new URLSearchParams({
            q: searchTerm,
            token: gnewsApiKey,
            max: '50',
            lang: 'en',
            sortby: 'publishedAt',
          });

          const url = `${gnewsApiUrl}/search?${params.toString()}`;
          const response = await fetch(url);

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`GNews API error: ${response.status} ${errorText}`);
            continue; // Don't add to errors, just skip
          }

          const data: any = await response.json();
          const articles = data.articles || [];
          console.log(`GNews found ${articles.length} articles for "${searchTerm}"`);
          
          // Convert GNews format to our format
          allArticles.push(...articles.map((a: any) => ({
            title: a.title,
            description: a.description,
            content: a.content || a.description,
            url: a.url,
            image: a.image,
            publishedAt: a.publishedAt,
            source: {
              name: a.source?.name || 'Unknown',
              url: a.source?.url || '',
            },
            provider: 'gnews',
          })));
        } catch (error) {
          console.error(`Error fetching from GNews "${searchTerm}":`, error);
        }
      }
    }

    // Fetch from Tavily (more comprehensive, no date restrictions)
    if (tavilyApiKey) {
      for (const searchTerm of searchTerms) {
        console.log(`Searching Tavily for: "${searchTerm}"`);

        try {
          const query = `${searchTerm} news articles press blog posts`;
          const response = await fetch(tavilyApiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              api_key: tavilyApiKey.trim(),
              query: query,
              search_depth: "advanced",
              include_answer: false,
              include_images: false,
              include_raw_content: true,
              max_results: 30,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Tavily API error: ${response.status} ${errorText}`);
            continue;
          }

          const data: any = await response.json();
          const results = data.results || [];
          
          // Filter out LinkedIn (handled by fetch-linkedin function)
          const nonLinkedInResults = results.filter((r: any) => 
            r.url && !r.url.includes('linkedin.com')
          );
          
          console.log(`Tavily found ${nonLinkedInResults.length} articles for "${searchTerm}"`);
          
          // Convert Tavily format to our format
          allArticles.push(...nonLinkedInResults.map((r: any) => ({
            title: r.title || 'Untitled',
            description: r.content?.substring(0, 500) || '',
            content: r.content || '',
            url: r.url,
            publishedAt: r.published_date || new Date().toISOString(),
            source: {
              name: r.author || new URL(r.url).hostname,
              url: new URL(r.url).origin,
            },
            provider: 'tavily',
          })));
        } catch (error) {
          console.error(`Error fetching from Tavily "${searchTerm}":`, error);
        }
      }
    }

    if (!gnewsApiKey && !tavilyApiKey) {
      return respond({ error: "Neither GNEWS_API_KEY nor TAVILY_API_KEY configured" }, 400);
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const uniqueArticles: GNewsArticle[] = [];
    for (const article of allArticles) {
      const url = article.url.toLowerCase().split('?')[0];
      if (!seen.has(url)) {
        seen.add(url);
        uniqueArticles.push(article);
      }
    }

    console.log(`Processing ${uniqueArticles.length} unique articles`);

    // Store each article
    for (const article of uniqueArticles) {
      try {
        // Check if already exists
        const { data: existing } = await supabase
          .from('articles')
          .select('id')
          .eq('external_id', article.url)
          .single();

        if (existing) {
          totalSkipped++;
          continue;
        }

        // Determine source type
        const sourceName = article.source.name.toLowerCase();
        const urlLower = article.url.toLowerCase();
        let sourceType = 'article';
        if (urlLower.includes('blog') || sourceName.includes('blog')) {
          sourceType = 'blog';
        } else if (urlLower.includes('press') || sourceName.includes('press') || sourceName.includes('news')) {
          sourceType = 'press';
        }

        // Insert article
        const { error: insertError } = await supabase.from('articles').insert({
          external_id: article.url,
          source: sourceType,
          title: article.title || 'Untitled',
          description: article.description || '',
          url: article.url,
          author: article.source.name,
          published_at: article.publishedAt ? new Date(article.publishedAt).toISOString() : null,
          content: article.content || article.description || '',
          metadata: {
            image: article.image,
            source_url: article.source.url,
            provider: article.provider || 'unknown',
          },
        });

        if (insertError) {
          console.error(`Error storing article ${article.url}:`, insertError);
          errors.push(`Failed to store: ${article.title}`);
        } else {
          totalAdded++;
          console.log(`✅ Stored: ${article.title}`);
        }
      } catch (error) {
        console.error(`Error processing article ${article.url}:`, error);
        errors.push(`Error processing: ${article.title}`);
      }
    }

    return respond({
      success: true,
      added: totalAdded,
      skipped: totalSkipped,
      total_found: uniqueArticles.length,
      errors: errors.length > 0 ? errors : undefined,
    }, 200);
  } catch (error) {
    console.error("fetch-articles failed:", error);
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

