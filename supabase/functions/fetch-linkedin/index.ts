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
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const tavilyApiUrl = "https://api.tavily.com/search";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Neko Health official LinkedIn identifiers
const NEKO_COMPANY_NAMES = ['neko health', 'nekoh', 'nekohealth'];
const NEKO_LINKEDIN_PATTERNS = ['/company/neko', '/company/neko-health', '/neko-health'];

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
              search_depth: "advanced", // Get more content
              include_answer: false,
              include_images: false,
              include_raw_content: true, // Get full post content
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
        allPosts.push(...linkedinResults.map((r: any) => {
          // Extract author name from LinkedIn URL or content
          const authorName = extractLinkedInAuthor(r.url, r.author, r.content);
          
          // Determine if it's a company post or organic post
          const postType = categorizeLinkedInPost(r.url, authorName, r.content);
          
          // Parse and validate date from Tavily
          const publishedDate = r.published_date ? parseDate(r.published_date) : null;
          
          return {
            title: r.title || 'LinkedIn Post',
            url: r.url,
            published_date: publishedDate, // Keep as Date object for now
            author: authorName,
            content: r.content || '',
            post_type: postType,
          };
        }));
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

        // Generate summary if we have content and OpenAI key
        let summary = null;
        const fullContent = post.content || '';
        if (fullContent && fullContent.length > 100 && openaiApiKey) {
          try {
            summary = await summarizeContent(fullContent, post.title);
            console.log(`  Generated summary for: ${post.title}`);
          } catch (error) {
            console.warn(`  Failed to generate summary: ${error}`);
          }
        }

        // Insert LinkedIn post
        const { error: insertError } = await supabase.from('articles').insert({
          external_id: post.url,
          source: 'linkedin',
          title: post.title,
          description: post.content?.substring(0, 500) || '',
          url: post.url,
          author: post.author || undefined,
          published_at: post.published_date ? (post.published_date instanceof Date ? post.published_date.toISOString() : new Date(post.published_date).toISOString()) : null,
          content: fullContent,
          metadata: {
            post_type: post.post_type, // 'company_post' or 'organic_post'
            summary: summary,
          },
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

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  
  try {
    // Try ISO format first (most common)
    const isoDate = new Date(dateStr);
    if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 2000) {
      return isoDate;
    }
  } catch {
    // Continue to other formats
  }
  
  try {
    // Try parsing as timestamp
    const timestamp = Date.parse(dateStr);
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      if (date.getFullYear() > 2000) {
        return date;
      }
    }
  } catch {
    // Continue
  }
  
  // Try common date formats
  const dateFormats = [
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
    /(\d{2})\/(\d{2})\/(\d{2})/, // MM/DD/YY
  ];
  
  for (const format of dateFormats) {
    const match = dateStr.match(format);
    if (match) {
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime()) && date.getFullYear() > 2000) {
          return date;
        }
      } catch {
        // Continue
      }
    }
  }
  
  // Try relative dates (e.g., "2 days ago", "1 week ago")
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
    
    return now;
  }
  
  console.warn(`Could not parse date: ${dateStr}`);
  return null;
}

function extractLinkedInAuthor(url: string, author: string | undefined, content: string): string {
  // Try to extract from URL first
  const urlMatch = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
  if (urlMatch) {
    const username = urlMatch[1];
    // Convert username to readable name (e.g., "john-doe" -> "John Doe")
    return username.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }
  
  // Try to extract from company URL
  const companyMatch = url.match(/linkedin\.com\/company\/([^\/\?]+)/);
  if (companyMatch) {
    return companyMatch[1].split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }
  
  // Use provided author if available
  if (author) return author;
  
  // Try to extract from content (look for "Posted by" or similar patterns)
  const contentMatch = content.match(/(?:Posted by|By|Author:)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  if (contentMatch) {
    return contentMatch[1];
  }
  
  return 'Unknown';
}

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
  
  const prompt = `Summarize the following LinkedIn post about Neko Health in 2-3 sentences. Focus on key points and main message.

Title: ${title}

Content:
${content.substring(0, 3000)}`;

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
            content: "You are an expert at summarizing social media posts. Provide concise, informative summaries.",
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

