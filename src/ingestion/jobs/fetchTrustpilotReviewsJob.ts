/**
 * Trustpilot Reviews Ingestion Job
 * Fetches reviews from Trustpilot Consumer API for Neko Health
 *
 * Requires TRUSTPILOT_API_KEY env var.
 * Get a free API key at: https://developer.trustpilot.com/
 */

import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult } from '../../types';

dotenv.config();

interface TrustpilotReview {
  id: string;
  stars: number;
  title?: string;
  text: string;
  createdAt: string;
  consumer: {
    displayName: string;
  };
  reviewedLocation?: {
    name: string;
  };
}

interface TrustpilotBusinessUnit {
  id: string;
  displayName: string;
  numberOfReviews: { total: number };
}

export class FetchTrustpilotReviewsJob implements IngestionJob {
  name = 'fetchTrustpilotReviews';

  private readonly apiKey: string;
  private readonly apiBase = 'https://api.trustpilot.com/v1';
  private readonly businessDomain = 'nekohealth.com';
  private supabaseClient: any = null;

  constructor() {
    const apiKey = process.env.TRUSTPILOT_API_KEY;
    if (!apiKey) {
      throw new Error('TRUSTPILOT_API_KEY not set in .env file');
    }
    this.apiKey = apiKey;
  }

  private async getSupabaseClient() {
    if (this.supabaseClient) return this.supabaseClient;
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    this.supabaseClient = createClient(supabaseUrl, supabaseKey);
    return this.supabaseClient;
  }

  async run(): Promise<IngestionResult> {
    const result: IngestionResult = { added: 0, skipped: 0, errors: [] };

    try {
      const businessUnit = await this.findBusinessUnit();
      if (!businessUnit) {
        console.warn(`No Trustpilot business unit found for domain: ${this.businessDomain}`);
        return result;
      }

      console.log(`Found: ${businessUnit.displayName} (${businessUnit.id})`);
      console.log(`Total reviews: ${businessUnit.numberOfReviews.total}`);

      let page = 1;
      const pageSize = 100;

      while (true) {
        const reviews = await this.fetchReviewsPage(businessUnit.id, page, pageSize);
        if (!reviews || reviews.length === 0) break;

        for (const review of reviews) {
          const status = await this.storeReview(review, businessUnit.displayName);
          if (status === 'added') result.added++;
          else if (status === 'skipped') result.skipped++;
          else result.errors.push({ item: review.id, error: status });
        }

        console.log(`  Page ${page}: processed ${reviews.length} reviews`);
        if (reviews.length < pageSize) break;
        page++;
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Trustpilot ingestion error:', msg);
      result.errors.push({ item: 'job', error: msg });
    }

    console.log(`\n✅ Trustpilot ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async findBusinessUnit(): Promise<TrustpilotBusinessUnit | null> {
    const url = `${this.apiBase}/business-units/find?name=${encodeURIComponent(this.businessDomain)}&apikey=${this.apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Business unit lookup failed: HTTP ${response.status}`);
      return null;
    }
    return response.json() as Promise<TrustpilotBusinessUnit>;
  }

  private async fetchReviewsPage(businessUnitId: string, page: number, pageSize: number): Promise<TrustpilotReview[]> {
    const url = `${this.apiBase}/business-units/${businessUnitId}/reviews?apikey=${this.apiKey}&page=${page}&perPage=${pageSize}&orderBy=createdat.desc`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Reviews page ${page} failed: HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    return data.reviews || [];
  }

  private async storeReview(review: TrustpilotReview, businessName: string): Promise<'added' | 'skipped' | string> {
    try {
      const client = await this.getSupabaseClient();
      const clinicName = review.reviewedLocation?.name || businessName;

      const record = {
        external_id: review.id,
        clinic_name: clinicName,
        author_name: review.consumer.displayName,
        rating: review.stars,
        title: review.title || null,
        text: review.text || review.title || '',
        published_at: review.createdAt,
        raw_data: review,
        updated_at: new Date().toISOString(),
      };

      const { error } = await client
        .from('trustpilot_reviews')
        .upsert(record, { onConflict: 'external_id', ignoreDuplicates: true });

      if (error) {
        if (error.code === '23505') return 'skipped';
        return error.message;
      }
      return 'added';
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown error';
    }
  }
}
