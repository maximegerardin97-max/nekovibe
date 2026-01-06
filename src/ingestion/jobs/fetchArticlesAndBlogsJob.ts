/**
 * Articles/Blogs/Press Ingestion Job
 * Fetches articles, blog posts, and press mentions about Neko Health using GNews API
 */

import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult, Article } from '../../types';
import { storeArticle } from '../../data/supabase';
import { parseArticle, RawArticleData } from '../parsers/articleParser';

dotenv.config();

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

export class FetchArticlesAndBlogsJob implements IngestionJob {
  name = 'fetchArticlesAndBlogs';

  private readonly apiKey: string;
  private readonly apiUrl = 'https://gnews.io/api/v4';
  private readonly searchTerms = [
    'Neko Health',
    '"Neko Health"',
  ];

  constructor() {
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) {
      throw new Error('GNEWS_API_KEY not set in .env file');
    }
    this.apiKey = apiKey;
  }

  async run(): Promise<IngestionResult> {
    const result: IngestionResult = {
      added: 0,
      skipped: 0,
      errors: [],
    };

    console.log('Starting Articles/Blogs/Press ingestion using GNews API...');

    try {
      const allArticles: GNewsArticle[] = [];

      // Search using different search terms
      for (const searchTerm of this.searchTerms) {
        console.log(`\nSearching GNews for: "${searchTerm}"`);
        const articles = await this.searchGNews(searchTerm);
        allArticles.push(...articles);
        console.log(`  Found ${articles.length} articles`);
      }

      // Deduplicate by URL
      const uniqueArticles = this.deduplicateArticles(allArticles);
      console.log(`\nFound ${uniqueArticles.length} unique articles total`);

      // Store each article
      for (const article of uniqueArticles) {
        try {
          const rawArticle: RawArticleData = {
            externalId: article.url,
            source: this.determineSourceType(article.source.name, article.url),
            title: article.title,
            description: article.description,
            url: article.url,
            author: article.source.name,
            publishedAt: article.publishedAt ? new Date(article.publishedAt) : undefined,
            content: article.content || article.description,
          };

          const parsed = parseArticle(rawArticle);
          if (!parsed) {
            result.errors.push({ item: article.url, error: 'Failed to parse article' });
            continue;
          }

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
          result.errors.push({ item: article.url, error: errorMessage });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Fatal error in Articles job:', errorMessage);
      result.errors.push({ item: 'job', error: errorMessage });
    }

    console.log(`\n✅ Articles/Blogs/Press ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async searchGNews(searchTerm: string): Promise<GNewsArticle[]> {
    try {
      const params = new URLSearchParams({
        q: searchTerm,
        token: this.apiKey,
        max: '50',
        lang: 'en',
        sortby: 'publishedAt',
      });

      const url = `${this.apiUrl}/search?${params.toString()}`;
      console.log(`  Calling GNews API: ${url.replace(this.apiKey, '***')}`);

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  GNews API error: ${response.status} ${errorText}`);
        return [];
      }

      const data: any = await response.json();
      const articles = data.articles || [];

      console.log(`  GNews returned ${articles.length} articles (total available: ${data.totalArticles || 0})`);
      return articles;
    } catch (error) {
      console.error(`  Error calling GNews API for "${searchTerm}":`, error);
      return [];
    }
  }

  private determineSourceType(sourceName: string, url: string): string {
    const nameLower = sourceName.toLowerCase();
    const urlLower = url.toLowerCase();

    if (urlLower.includes('blog') || nameLower.includes('blog')) return 'blog';
    if (urlLower.includes('press') || nameLower.includes('press') || nameLower.includes('news')) return 'press';
    return 'article';
  }

  private deduplicateArticles(articles: GNewsArticle[]): GNewsArticle[] {
    const seen = new Set<string>();
    const unique: GNewsArticle[] = [];

    for (const article of articles) {
      const url = article.url.toLowerCase().split('?')[0]; // Remove query params for deduplication
      if (!seen.has(url)) {
        seen.add(url);
        unique.push(article);
      }
    }

    return unique;
  }

}

