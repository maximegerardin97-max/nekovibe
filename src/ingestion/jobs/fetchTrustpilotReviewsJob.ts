/**
 * Trustpilot Reviews Ingestion Job
 * Scrapes reviews from https://www.trustpilot.com/review/nekohealth.com
 *
 * No API key required — Trustpilot uses Next.js SSR so all review data
 * is embedded in the __NEXT_DATA__ JSON blob in the page HTML.
 */

import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult } from '../../types';

dotenv.config();

const BASE_URL = 'https://www.trustpilot.com/review/nekohealth.com';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface TrustpilotReview {
  id: string;
  rating: number;
  title?: string;
  text?: string;
  dates: { publishedDate: string };
  consumer: { displayName: string };
}

interface NextData {
  props: {
    pageProps: {
      reviews: TrustpilotReview[];
      pagination: {
        currentPage: number;
        totalPages: number;
      };
    };
  };
}

export class FetchTrustpilotReviewsJob implements IngestionJob {
  name = 'fetchTrustpilotReviews';

  private supabaseClient: any = null;

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
      // Fetch first page to discover total pages
      const firstPage = await this.fetchPage(1);
      const { pagination, reviews: firstReviews } = firstPage;

      console.log(`Trustpilot: ${pagination.totalPages} pages to scrape`);

      await this.processReviews(firstReviews, result);

      for (let page = 2; page <= pagination.totalPages; page++) {
        await new Promise(r => setTimeout(r, 500));
        const { reviews } = await this.fetchPage(page);
        await this.processReviews(reviews, result);
        console.log(`  Page ${page}/${pagination.totalPages}: processed ${reviews.length} reviews`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Trustpilot scrape error:', msg);
      result.errors.push({ item: 'job', error: msg });
    }

    console.log(`\n✅ Trustpilot ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async fetchPage(page: number): Promise<NextData['props']['pageProps']> {
    const url = `${BASE_URL}?page=${page}&sort=recency`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching page ${page}`);
    }

    const html = await response.text();

    // Extract __NEXT_DATA__ JSON from the HTML
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) {
      throw new Error(`__NEXT_DATA__ not found on page ${page} — Trustpilot may have changed their structure`);
    }

    let nextData: NextData;
    try {
      nextData = JSON.parse(match[1]);
    } catch {
      throw new Error(`Failed to parse __NEXT_DATA__ JSON on page ${page}`);
    }

    const pageProps = nextData?.props?.pageProps;
    if (!pageProps?.reviews || !pageProps?.pagination) {
      throw new Error(`Unexpected __NEXT_DATA__ shape on page ${page} — missing reviews or pagination`);
    }

    return pageProps;
  }

  private async processReviews(reviews: TrustpilotReview[], result: IngestionResult) {
    for (const review of reviews) {
      const status = await this.storeReview(review);
      if (status === 'added') result.added++;
      else if (status === 'skipped') result.skipped++;
      else result.errors.push({ item: review.id, error: status });
    }
  }

  private async storeReview(review: TrustpilotReview): Promise<'added' | 'skipped' | string> {
    try {
      const client = await this.getSupabaseClient();

      const record = {
        external_id: review.id,
        clinic_name: 'Neko Health',
        author_name: review.consumer?.displayName || 'Anonymous',
        rating: review.rating,
        title: review.title || null,
        text: review.text || review.title || '',
        published_at: review.dates?.publishedDate || null,
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
