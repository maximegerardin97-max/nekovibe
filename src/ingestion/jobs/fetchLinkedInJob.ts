/**
 * LinkedIn Ingestion Job
 * Searches for and fetches LinkedIn posts about Neko Health using Tavily API
 */

import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult, Article } from '../../types';
import { storeArticle } from '../../data/supabase';
import { parseArticle, RawArticleData } from '../parsers/articleParser';

dotenv.config();

interface TavilyResult {
  title: string;
  url: string;
  published_date?: string;
  author?: string;
  content: string;
}

interface TavilyResponse {
  query: string;
  results: TavilyResult[];
}

export class FetchLinkedInJob implements IngestionJob {
  name = 'fetchLinkedIn';

  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.tavily.com/search';
  private readonly searchTerms = [
    'Neko Health',
    '"Neko Health"',
  ];

  constructor() {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY not set in .env file');
    }
    this.apiKey = apiKey;
  }

  async run(): Promise<IngestionResult> {
    const result: IngestionResult = {
      added: 0,
      skipped: 0,
      errors: [],
    };

    console.log('Starting LinkedIn ingestion using Tavily API...');

    try {
      const allPosts: RawArticleData[] = [];

      // Search using different search terms
      for (const searchTerm of this.searchTerms) {
        console.log(`\nSearching LinkedIn for: "${searchTerm}"`);
        const posts = await this.searchLinkedIn(searchTerm);
        allPosts.push(...posts);
        console.log(`  Found ${posts.length} LinkedIn posts`);
      }

      // Deduplicate by URL
      const uniquePosts = this.deduplicatePosts(allPosts);
      console.log(`\nFound ${uniquePosts.length} unique LinkedIn posts total`);

      // Store each post
      for (const post of uniquePosts) {
        try {
          const parsed = parseArticle(post);
          if (!parsed) {
            result.errors.push({ item: post.url, error: 'Failed to parse post' });
            continue;
          }

          // Override source to 'linkedin'
          parsed.source = 'linkedin';

          const storeResult = await storeArticle(parsed);
          if (storeResult.stored) {
            result.added++;
            console.log(`  ✅ Stored: ${parsed.title}`);
          } else if (storeResult.error) {
            result.errors.push({ item: parsed.url, error: storeResult.error });
          } else {
            result.skipped++; // Duplicate
            console.log(`  ⏭️  Skipped (duplicate): ${parsed.title}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push({ item: post.url, error: errorMessage });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Fatal error in LinkedIn job:', errorMessage);
      result.errors.push({ item: 'job', error: errorMessage });
    }

    console.log(`\n✅ LinkedIn ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async searchLinkedIn(searchTerm: string): Promise<RawArticleData[]> {
    try {
      const query = `site:linkedin.com ${searchTerm}`;
      console.log(`  Calling Tavily API: ${query}`);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: query,
          search_depth: 'basic',
          include_answer: false,
          include_images: false,
          include_raw_content: false,
          max_results: 20,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  Tavily API error: ${response.status} ${errorText}`);
        return [];
      }

      const data: TavilyResponse = await response.json();
      const results = data.results || [];

      console.log(`  Tavily returned ${results.length} results`);

      // Filter to only LinkedIn URLs and convert to RawArticleData
      const posts: RawArticleData[] = results
        .filter((result) => result.url && result.url.includes('linkedin.com'))
        .map((result) => ({
          externalId: result.url,
          source: 'linkedin',
          title: result.title || 'LinkedIn Post',
          description: result.content?.substring(0, 500) || '',
          url: result.url,
          author: result.author,
          publishedAt: result.published_date ? new Date(result.published_date) : undefined,
          content: result.content || '',
        }));

      return posts;
    } catch (error) {
      console.error(`  Error calling Tavily API for "${searchTerm}":`, error);
      return [];
    }
  }

  private deduplicatePosts(posts: RawArticleData[]): RawArticleData[] {
    const seen = new Set<string>();
    const unique: RawArticleData[] = [];

    for (const post of posts) {
      // LinkedIn URLs can have query params, normalize them
      const url = post.url.toLowerCase().split('?')[0].split('#')[0];
      if (!seen.has(url)) {
        seen.add(url);
        unique.push(post);
      }
    }

    return unique;
  }
}

