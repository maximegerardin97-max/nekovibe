/**
 * Parser for Google Reviews data
 * Normalizes raw review data into structured GoogleReview objects
 */

import { GoogleReview } from '../../types';

export interface RawGoogleReviewData {
  externalId: string;
  clinicPlaceId: string;
  clinicName?: string;
  authorName?: string;
  authorUrl?: string;
  rating?: number | string;
  text?: string;
  publishedAt?: string | Date;
  responseText?: string;
  responsePublishedAt?: string | Date;
  [key: string]: any; // Allow additional fields
}

/**
 * Parse and normalize raw Google Review data
 */
export function parseGoogleReview(raw: RawGoogleReviewData): GoogleReview | null {
  try {
    // Validate required fields
    if (!raw.externalId || !raw.clinicPlaceId) {
      console.warn('Missing required fields (externalId or clinicPlaceId)', raw);
      return null;
    }

    // Normalize rating
    let rating = 0;
    if (typeof raw.rating === 'number') {
      rating = Math.max(1, Math.min(5, raw.rating));
    } else if (typeof raw.rating === 'string') {
      const parsed = parseFloat(raw.rating);
      if (!isNaN(parsed)) {
        rating = Math.max(1, Math.min(5, parsed));
      }
    }

    if (rating === 0) {
      console.warn('Invalid or missing rating', raw);
      return null;
    }

    // Normalize dates
    let publishedAt: Date;
    if (raw.publishedAt instanceof Date) {
      publishedAt = raw.publishedAt;
    } else if (typeof raw.publishedAt === 'string') {
      publishedAt = new Date(raw.publishedAt);
      if (isNaN(publishedAt.getTime())) {
        publishedAt = new Date(); // Fallback to now if invalid
      }
    } else {
      publishedAt = new Date(); // Fallback to now
    }

    let responsePublishedAt: Date | undefined;
    if (raw.responsePublishedAt) {
      if (raw.responsePublishedAt instanceof Date) {
        responsePublishedAt = raw.responsePublishedAt;
      } else if (typeof raw.responsePublishedAt === 'string') {
        responsePublishedAt = new Date(raw.responsePublishedAt);
        if (isNaN(responsePublishedAt.getTime())) {
          responsePublishedAt = undefined;
        }
      }
    }

    // Clean text
    const text = cleanText(raw.text || '');
    if (!text) {
      console.warn('Review has no text content', raw);
      return null;
    }

    // Extract raw data (excluding fields we're using)
    const { externalId, clinicPlaceId, authorName, authorUrl, rating: _, text: __, publishedAt: ___, responseText, responsePublishedAt: ____, ...rawData } = raw;

    return {
      externalId: String(raw.externalId),
      clinicPlaceId: String(raw.clinicPlaceId),
      clinicName: raw.clinicName || 'Unknown Clinic',
      authorName: raw.authorName || 'Anonymous',
      authorUrl: raw.authorUrl,
      rating,
      text,
      publishedAt,
      responseText: raw.responseText ? cleanText(raw.responseText) : undefined,
      responsePublishedAt,
      rawData,
    };
  } catch (error) {
    console.error('Error parsing Google Review:', error, raw);
    return null;
  }
}

/**
 * Clean and normalize text content
 */
function cleanText(text: string): string {
  if (!text) return '';
  
  return text
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .trim();
}

