/**
 * Google Reviews Ingestion Job
 * Fetches reviews from Google Places API for each Neko clinic
 */

import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult, GoogleReview } from '../../types';
import { storeGoogleReview } from '../../data/supabase';
import { parseGoogleReview, RawGoogleReviewData } from '../parsers/reviewParser';

dotenv.config();

interface GooglePlacesReview {
  author_name: string;
  author_url?: string;
  language?: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number;
}

interface GooglePlacesResponse {
  result?: {
    reviews?: GooglePlacesReview[];
    place_id?: string;
    name?: string;
  };
  status: string;
  error_message?: string;
}

interface PlaceInfo {
  placeId: string;
  clinicName: string;
}

export class FetchGoogleReviewsJob implements IngestionJob {
  name = 'fetchGoogleReviews';

  private readonly apiKey: string;
  private readonly apiBaseUrl = 'https://maps.googleapis.com/maps/api/place';

  constructor() {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACES_API_KEY not set in .env file');
    }
    this.apiKey = apiKey;
  }

  async run(): Promise<IngestionResult> {
    const result: IngestionResult = {
      added: 0,
      skipped: 0,
      errors: [],
    };

    const placeIds = this.getClinicPlaceIds();
    if (placeIds.length === 0) {
      console.warn('No clinic place IDs configured. Set GOOGLE_PLACES_IDS in .env');
      return result;
    }

    console.log(`Starting Google Reviews ingestion for ${placeIds.length} clinic(s)...`);

    for (const placeIdOrUrl of placeIds) {
      console.log(`\nFetching reviews for: ${placeIdOrUrl.substring(0, 60)}...`);
      const clinicResult = await this.fetchReviewsForClinic(placeIdOrUrl);
      
      result.added += clinicResult.added;
      result.skipped += clinicResult.skipped;
      result.errors.push(...clinicResult.errors);
    }

    console.log(`\n✅ Google Reviews ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async fetchReviewsForClinic(placeIdOrUrl: string): Promise<IngestionResult> {
    const result: IngestionResult = {
      added: 0,
      skipped: 0,
      errors: [],
    };

    try {
      // Get the actual Place ID (ChIJ... format)
      const placeInfo = await this.getPlaceInfo(placeIdOrUrl);
      if (!placeInfo) {
        result.errors.push({ 
          item: placeIdOrUrl, 
          error: 'Could not determine Place ID from URL' 
        });
        return result;
      }

      console.log(`  Using Place ID: ${placeInfo.placeId}`);
      console.log(`  Clinic Name: ${placeInfo.clinicName}`);

      // Fetch reviews from Google Places API
      const reviews = await this.fetchReviewsFromAPI(placeInfo.placeId);
      
      if (reviews.length === 0) {
        console.log(`  No reviews found for this place`);
        return result;
      }

      console.log(`  Found ${reviews.length} reviews from API`);

      // Extract clinic identifier for storage
      const clinicPlaceId = placeInfo.placeId;

      // Store each review
      for (const review of reviews) {
        const parsed = parseGoogleReview({
          externalId: this.generateReviewId(review, placeInfo.placeId),
          clinicPlaceId,
          clinicName: placeInfo.clinicName,
          authorName: review.author_name,
          authorUrl: review.author_url,
          rating: review.rating,
          text: review.text,
          publishedAt: new Date(review.time * 1000), // Convert Unix timestamp to Date
        });

        if (!parsed) {
          result.errors.push({ item: 'review', error: 'Failed to parse review' });
          continue;
        }

        const storeResult = await storeGoogleReview(parsed);
        if (storeResult.stored) {
          result.added++;
        } else if (storeResult.error) {
          result.errors.push({ item: parsed.externalId, error: storeResult.error });
        } else {
          result.skipped++; // Duplicate
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  Error fetching reviews:`, errorMessage);
      result.errors.push({ item: placeIdOrUrl, error: errorMessage });
    }

    return result;
  }

  /**
   * Get the standard Place ID (ChIJ... format) from a URL or existing Place ID
   */
  private async getPlaceInfo(placeIdOrUrl: string): Promise<PlaceInfo | null> {
    // If it's already a Place ID (starts with ChIJ)
    if (placeIdOrUrl.startsWith('ChIJ')) {
      const clinicName = await this.getPlaceNameById(placeIdOrUrl);
      return {
        placeId: placeIdOrUrl,
        clinicName: clinicName || 'Unknown Clinic',
      };
    }

    // If it's a URL, try to extract Place ID or use Text Search
    if (placeIdOrUrl.startsWith('http://') || placeIdOrUrl.startsWith('https://')) {
      // Try to extract from URL first
      const extractedId = this.extractPlaceIdFromUrl(placeIdOrUrl);
      if (extractedId && extractedId.startsWith('ChIJ')) {
        const clinicName = await this.getPlaceNameById(extractedId);
        return {
          placeId: extractedId,
          clinicName: clinicName || this.extractNameFromUrl(placeIdOrUrl) || 'Unknown Clinic',
        };
      }

      // If extraction failed, use Text Search to find the place
      return await this.findPlaceInfoByUrl(placeIdOrUrl);
    }

    return null;
  }

  /**
   * Use Google Places Text Search to find Place ID and name from a URL
   */
  private async findPlaceInfoByUrl(url: string): Promise<PlaceInfo | null> {
    try {
      // Extract clinic name from URL
      const placeName = this.extractNameFromUrl(url);
      if (!placeName) return null;

      console.log(`  Searching for place: ${placeName}`);

      // Use Text Search API
      const searchUrl = `${this.apiBaseUrl}/textsearch/json?query=${encodeURIComponent(placeName)}&key=${this.apiKey}`;
      const response = await fetch(searchUrl);
      const data = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        // Return the first result's Place ID
        return {
          placeId: data.results[0].place_id,
          clinicName: data.results[0].name || placeName,
        };
      }

      return null;
    } catch (error) {
      console.warn(`  Error finding Place ID:`, error);
      return null;
    }
  }

  /**
   * Fetch reviews from Google Places API
   */
  private async fetchReviewsFromAPI(placeId: string): Promise<GooglePlacesReview[]> {
    try {
      // Use Place Details API to get reviews
      const url = `${this.apiBaseUrl}/details/json?place_id=${placeId}&fields=reviews,name&key=${this.apiKey}`;
      
      const response = await fetch(url);
      const data: GooglePlacesResponse = await response.json();

      if (data.status !== 'OK') {
        console.warn(`  API returned status: ${data.status} - ${data.error_message || ''}`);
        return [];
      }

      if (!data.result || !data.result.reviews) {
        return [];
      }

      return data.result.reviews;
    } catch (error) {
      console.error(`  Error fetching from API:`, error);
      return [];
    }
  }

  /**
   * Generate a unique review ID from review data
   */
  private generateReviewId(review: GooglePlacesReview, placeId: string): string {
    // Use author name + time + first 20 chars of text as unique identifier
    const textHash = review.text.substring(0, 20).replace(/\s/g, '');
    return `${placeId}_${review.author_name}_${review.time}_${textHash}`.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Extract Place ID from URL (tries multiple patterns)
   */
  private extractPlaceIdFromUrl(url: string): string | null {
    try {
      // Pattern 1: Extract from !1s... part (location identifier)
      const match1 = url.match(/!1s([^!]+)/);
      if (match1) {
        return match1[1].replace(/:/g, '_');
      }
      
      // Pattern 2: Extract from /g/... part
      const match2 = url.match(/\/g\/([^/?]+)/);
      if (match2) {
        return `g_${match2[1]}`;
      }
      
      // Pattern 3: Extract from place_id= parameter
      const match3 = url.match(/place_id=([^&]+)/);
      if (match3) {
        return match3[1];
      }
      
      return null;
    } catch {
      return null;
    }
  }

  private extractNameFromUrl(url: string): string | null {
    const match = url.match(/place\/([^/@]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1].replace(/\+/g, ' '));
  }

  private async getPlaceNameById(placeId: string): Promise<string | null> {
    try {
      const url = `${this.apiBaseUrl}/details/json?place_id=${placeId}&fields=name&key=${this.apiKey}`;
      const response = await fetch(url);
      const data: GooglePlacesResponse = await response.json();
      if (data.status === 'OK' && data.result?.name) {
        return data.result.name;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getClinicPlaceIds(): string[] {
    const placeIdsEnv = process.env.GOOGLE_PLACES_IDS;
    if (!placeIdsEnv) {
      return [];
    }
    
    // URLs contain commas, so we need to split intelligently
    // Split by ",https://" to separate URLs, then add "https://" back
    const urls: string[] = [];
    const parts = placeIdsEnv.split(/,https?:\/\//);
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;
      
      if (i === 0 && (part.startsWith('http://') || part.startsWith('https://'))) {
        // First part might already have http/https
        urls.push(part);
      } else if (i > 0) {
        // Add back the https:// prefix
        urls.push(`https://${part}`);
      } else {
        // First part without http - might be a Place ID
        urls.push(part);
      }
    }
    
    return urls.filter(Boolean);
  }
}
