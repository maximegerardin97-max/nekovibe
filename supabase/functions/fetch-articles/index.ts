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
const gnewsApiUrl = "https://gnews.io/api/v4";
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
    if (!gnewsApiKey) {
      return respond({ error: "GNEWS_API_KEY not configured" }, 400);
    }

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
    const allArticles: GNewsArticle[] = [];

    // Fetch articles for each search term
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
          errors.push(`Failed to fetch "${searchTerm}": ${errorText}`);
          continue;
        }

        const data: any = await response.json();
        const articles = data.articles || [];
        console.log(`Found ${articles.length} articles for "${searchTerm}"`);
        allArticles.push(...articles);
      } catch (error) {
        console.error(`Error fetching "${searchTerm}":`, error);
        errors.push(`Error fetching "${searchTerm}": ${error}`);
      }
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

