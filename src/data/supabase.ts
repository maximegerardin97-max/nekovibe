/**
 * Supabase client and data access layer
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { GoogleReview, Article } from '../types';

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'
  );
}

export const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Store a feedback item in the unified feedback_items table
 * This is the new unified storage for all feedback types
 */
export async function storeFeedbackItem(item: {
  clinicId: string;
  sourceType: 'google_review' | 'press_article' | 'social_post' | 'blog_post';
  text: string;
  metadata: Record<string, any>;
}): Promise<{ stored: boolean; error?: string }> {
  try {
    const externalId = item.metadata.external_id;
    if (!externalId) {
      return { stored: false, error: 'external_id is required in metadata' };
    }

    // Check if item already exists
    const { data: existing, error: checkError } = await supabase
      .from('feedback_items')
      .select('id')
      .eq('metadata->>external_id', externalId)
      .eq('clinic_id', item.clinicId)
      .eq('source_type', item.sourceType)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      return { stored: false, error: checkError.message };
    }

    if (existing) {
      return { stored: false }; // Already exists, skip
    }

    // Insert new item
    const { error: insertError } = await supabase.from('feedback_items').insert({
      clinic_id: item.clinicId,
      source_type: item.sourceType,
      text: item.text,
      metadata: item.metadata,
    });

    if (insertError) {
      return { stored: false, error: insertError.message };
    }

    return { stored: true };
  } catch (error) {
    return { stored: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Store a Google Review, avoiding duplicates
 */
export async function storeGoogleReview(review: GoogleReview): Promise<{ stored: boolean; error?: string }> {
  try {
    // Check if review already exists
    const { data: existing, error: checkError } = await supabase
      .from('google_reviews')
      .select('id')
      .eq('external_id', review.externalId)
      .eq('clinic_place_id', review.clinicPlaceId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is expected for new reviews
      return { stored: false, error: checkError.message };
    }

    if (existing) {
      return { stored: false }; // Already exists, skip
    }

    // Insert new review
    const { error: insertError } = await supabase.from('google_reviews').insert({
      external_id: review.externalId,
      clinic_place_id: review.clinicPlaceId,
      clinic_name: review.clinicName,
      author_name: review.authorName,
      author_url: review.authorUrl,
      rating: review.rating,
      text: review.text,
      published_at: review.publishedAt.toISOString(),
      response_text: review.responseText,
      response_published_at: review.responsePublishedAt?.toISOString(),
      raw_data: review.rawData || {},
    });

    if (insertError) {
      return { stored: false, error: insertError.message };
    }

    // Also store in unified feedback_items table
    await storeFeedbackItem({
      clinicId: review.clinicName,
      sourceType: 'google_review',
      text: review.text,
      metadata: {
        external_id: review.externalId,
        clinic_place_id: review.clinicPlaceId,
        author_name: review.authorName,
        author_url: review.authorUrl,
        rating: review.rating,
        published_at: review.publishedAt.toISOString(),
        response_text: review.responseText,
        response_published_at: review.responsePublishedAt?.toISOString(),
        raw_data: review.rawData || {},
      },
    }).catch((err) => {
      // Log but don't fail if feedback_items write fails (graceful degradation)
      console.warn('Failed to write to feedback_items:', err);
    });

    return { stored: true };
  } catch (error) {
    return { stored: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Store an Article, avoiding duplicates
 */
export async function storeArticle(article: Article): Promise<{ stored: boolean; error?: string }> {
  try {
    // Check if article already exists
    const { data: existing, error: checkError } = await supabase
      .from('articles')
      .select('id')
      .eq('external_id', article.externalId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      return { stored: false, error: checkError.message };
    }

    if (existing) {
      return { stored: false }; // Already exists, skip
    }

    // Insert new article
    const { error: insertError } = await supabase.from('articles').insert({
      external_id: article.externalId,
      source: article.source,
      title: article.title,
      description: article.description,
      url: article.url,
      author: article.author,
      published_at: article.publishedAt?.toISOString(),
      content: article.content,
      raw_html: article.rawHtml,
      metadata: article.metadata || {},
    });

    if (insertError) {
      return { stored: false, error: insertError.message };
    }

    // Also store in unified feedback_items table
    const sourceType = article.source === 'blog' ? 'blog_post' : 'press_article';
    const clinicName = (article.metadata as any)?.clinic_name || 'Unknown Clinic';
    
    await storeFeedbackItem({
      clinicId: clinicName,
      sourceType,
      text: article.description || article.content,
      metadata: {
        external_id: article.externalId,
        title: article.title,
        url: article.url,
        author: article.author,
        published_at: article.publishedAt?.toISOString(),
        source: article.source,
        raw_html: article.rawHtml,
        ...(article.metadata || {}),
      },
    }).catch((err) => {
      // Log but don't fail if feedback_items write fails (graceful degradation)
      console.warn('Failed to write to feedback_items:', err);
    });

    return { stored: true };
  } catch (error) {
    return { stored: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get all stored clinic place IDs (for reference)
 */
export async function getClinicPlaceIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('google_reviews')
    .select('clinic_place_id')
    .order('clinic_place_id');

  if (error) {
    console.warn('Error fetching clinic place IDs:', error.message);
    return [];
  }

  // Return unique place IDs
  return [...new Set((data || []).map((r) => r.clinic_place_id))];
}

