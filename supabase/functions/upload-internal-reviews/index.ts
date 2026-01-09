/**
 * Upload Internal Reviews Edge Function
 * Handles CSV upload, duplicate checking, and automatic summary generation
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return respond({ error: "Supabase credentials not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Parse CSV from request
    const formData = await req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return respond({ error: "No file uploaded" }, 400);
    }

    const csvText = await file.text();
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Parse CSV
    const reviews = parseCSV(csvText);
    console.log(`Parsed ${reviews.length} reviews from CSV`);

    // Process reviews
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const review of reviews) {
      try {
        // Create hash for duplicate detection
        const hash = createReviewHash(review);
        
        // Check for duplicates
        const { data: existing } = await supabase
          .from("internal_reviews")
          .select("id")
          .eq("review_hash", hash)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        // Insert new review
        const { error: insertError } = await supabase
          .from("internal_reviews")
          .insert({
            review_hash: hash,
            published_at: review.date,
            rating: review.rating,
            clinic_name: review.clinic,
            comment: review.comment,
            upload_batch_id: batchId,
          });

        if (insertError) {
          errors.push(`Failed to insert review: ${insertError.message}`);
        } else {
          added++;
        }
      } catch (error) {
        errors.push(`Error processing review: ${error}`);
      }
    }

    // Generate summaries for the new upload
    if (added > 0 && openaiApiKey) {
      try {
        await generateSummaries(supabase, batchId);
      } catch (error) {
        console.error("Error generating summaries:", error);
        errors.push("Failed to generate summaries (reviews were still added)");
      }
    }

    return respond({
      success: true,
      added,
      skipped,
      total: reviews.length,
      batch_id: batchId,
      errors: errors.length > 0 ? errors : undefined,
    }, 200);
  } catch (error) {
    console.error("upload-internal-reviews failed:", error);
    return respond({ error: "Unexpected error", details: `${error}` }, 500);
  }
});

interface ParsedReview {
  date: string;
  rating: number;
  clinic: string;
  comment: string;
}

function parseCSV(csvText: string): ParsedReview[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  // Parse header
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const reviews: ParsedReview[] = [];

  // Find column indices
  const dateIdx = findColumnIndex(header, ['date', 'published_at', 'published date', 'review date']);
  const ratingIdx = findColumnIndex(header, ['rating', 'stars', 'star rating', 'score']);
  const clinicIdx = findColumnIndex(header, ['clinic', 'clinic_name', 'clinic name', 'location']);
  const commentIdx = findColumnIndex(header, ['comment', 'text', 'review', 'feedback', 'notes', 'description']);

  if (dateIdx === -1 || ratingIdx === -1 || clinicIdx === -1 || commentIdx === -1) {
    throw new Error(`Missing required columns. Found: ${header.join(', ')}`);
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < Math.max(dateIdx, ratingIdx, clinicIdx, commentIdx) + 1) continue;

    const date = parseDate(values[dateIdx]);
    const rating = parseInt(values[ratingIdx]);
    const clinic = values[clinicIdx].trim();
    
    // Consolidate all comment columns into one
    const commentParts: string[] = [];
    for (let j = commentIdx; j < values.length; j++) {
      if (values[j] && values[j].trim()) {
        commentParts.push(values[j].trim());
      }
    }
    // Also check if there are other text columns we should include
    header.forEach((colName, idx) => {
      if (idx !== dateIdx && idx !== ratingIdx && idx !== clinicIdx && idx !== commentIdx) {
        if (colName.includes('comment') || colName.includes('text') || colName.includes('note') || colName.includes('description')) {
          if (values[idx] && values[idx].trim()) {
            commentParts.push(values[idx].trim());
          }
        }
      }
    });
    
    const comment = commentParts.join(' ').trim();

    if (!date || isNaN(rating) || rating < 1 || rating > 5 || !clinic || !comment) {
      continue; // Skip invalid rows
    }

    reviews.push({ date, rating, clinic, comment });
  }

  return reviews;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  
  return values;
}

function findColumnIndex(header: string[], possibleNames: string[]): number {
  for (const name of possibleNames) {
    const idx = header.findIndex(h => h.includes(name) || name.includes(h));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  try {
    // Try various date formats
    const date = new Date(dateStr);
    if (!isNaN(date.getTime()) && date.getFullYear() > 2000) {
      return date.toISOString();
    }
    
    // Try DD/MM/YYYY or MM/DD/YYYY
    const parts = dateStr.split(/[-\/]/);
    if (parts.length === 3) {
      const year = parseInt(parts[2] || parts[0]);
      const month = parseInt(parts[1] || parts[0]) - 1;
      const day = parseInt(parts[0] || parts[1]);
      
      if (year > 2000 && month >= 0 && month < 12 && day > 0 && day <= 31) {
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) {
          return d.toISOString();
        }
      }
    }
  } catch {
    // Invalid date
  }
  
  return null;
}

function createReviewHash(review: ParsedReview): string {
  // Create a hash from date + rating + clinic + first 100 chars of comment
  const hashString = `${review.date}|${review.rating}|${review.clinic}|${review.comment.substring(0, 100)}`;
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < hashString.length; i++) {
    const char = hashString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return `ir_${Math.abs(hash).toString(36)}`;
}

async function generateSummaries(supabase: any, batchId: string) {
  if (!openaiApiKey) return;

  // Get latest upload reviews
  const { data: latestReviews } = await supabase
    .from("internal_reviews")
    .select("published_at, rating, clinic_name, comment")
    .eq("upload_batch_id", batchId)
    .order("published_at", { ascending: false });

  if (!latestReviews || latestReviews.length === 0) return;

  // Generate summary for latest upload
  const summaryText = await generateSummaryText(latestReviews);
  
  if (summaryText) {
    await supabase
      .from("internal_review_summaries")
      .upsert({
        scope: "latest_upload",
        summary_text: summaryText,
        reviews_covered_count: latestReviews.length,
        upload_batch_id: batchId,
        last_refreshed_at: new Date().toISOString(),
      }, {
        onConflict: "scope,upload_batch_id",
      });
  }

  // Also update all_time summary
  const { data: allReviews } = await supabase
    .from("internal_reviews")
    .select("published_at, rating, clinic_name, comment")
    .order("published_at", { ascending: false })
    .limit(1000); // Limit for performance

  if (allReviews && allReviews.length > 0) {
    const allTimeSummary = await generateSummaryText(allReviews);
    if (allTimeSummary) {
      await supabase
        .from("internal_review_summaries")
        .upsert({
          scope: "all_time",
          summary_text: allTimeSummary,
          reviews_covered_count: allReviews.length,
          last_refreshed_at: new Date().toISOString(),
        }, {
          onConflict: "scope,upload_batch_id",
        });
    }
  }
}

async function generateSummaryText(reviews: any[]): Promise<string | null> {
  if (!openaiApiKey) return null;

  const reviewsText = reviews
    .slice(0, 500) // Limit to 500 reviews for summary
    .map((r, idx) => {
      const date = r.published_at ? new Date(r.published_at).toLocaleDateString() : "Unknown date";
      return `${idx + 1}. [${date}] ${r.clinic_name} - Rating: ${r.rating}/5 - "${r.comment.substring(0, 200)}"`;
    })
    .join("\n\n");

  const prompt = `You are analyzing internal reviews for Neko Health. Below are ${reviews.length} reviews.

CRITICAL: Focus on sentiment analysis. Identify:
- Positive sentiment (what customers liked)
- Negative sentiment (complaints, issues, criticisms)
- Neutral sentiment (factual statements)

For each sentiment category, be specific about:
- Exact wording/phrases used
- Frequency (how many reviews mention it)
- Context (which clinics, time periods)

Reviews:
${reviewsText}

Provide a comprehensive summary (3-5 paragraphs) that captures:
1. Overall sentiment distribution
2. Key positive themes with specific examples
3. Key negative themes with specific examples and exact wording
4. Clinic-specific patterns if any
5. Time-based trends if visible

Be quantitative: "X out of Y reviews mentioned [issue]" or "X reviews (Y%) reported [problem]".`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are an expert at sentiment analysis of customer reviews. Be precise about wording and quantify everything.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) return null;

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

