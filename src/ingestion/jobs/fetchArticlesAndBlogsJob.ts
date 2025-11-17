/**
 * Articles/Blogs/Press Ingestion Job
 * Searches for and fetches articles, blog posts, and press mentions about Neko
 */

import { chromium, Browser, Page } from 'playwright';
import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult, Article } from '../../types';
import { storeArticle } from '../../data/supabase';
import { parseArticle, RawArticleData } from '../parsers/articleParser';

dotenv.config();

export class FetchArticlesAndBlogsJob implements IngestionJob {
  name = 'fetchArticlesAndBlogs';

  private browser: Browser | null = null;
  private readonly searchTerms = [
    'Neko clinic',
    'Neko veterinary',
    'Neko vet',
    'Neko animal hospital',
  ];

  async run(): Promise<IngestionResult> {
    const result: IngestionResult = {
      added: 0,
      skipped: 0,
      errors: [],
    };

    console.log('Starting Articles/Blogs/Press ingestion...');

    try {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });

      const allArticles: RawArticleData[] = [];

      // Search using different search terms
      for (const searchTerm of this.searchTerms) {
        console.log(`\nSearching for: "${searchTerm}"`);
        const articles = await this.searchForArticles(searchTerm);
        allArticles.push(...articles);
      }

      // Deduplicate by URL
      const uniqueArticles = this.deduplicateArticles(allArticles);
      console.log(`\nFound ${uniqueArticles.length} unique articles`);

      // Fetch full content for each article
      for (const article of uniqueArticles) {
        try {
          const fullArticle = await this.fetchArticleContent(article);
          if (!fullArticle) {
            result.errors.push({ item: article.url, error: 'Failed to fetch content' });
            continue;
          }

          const parsed = parseArticle(fullArticle);
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
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }

    console.log(`\n✅ Articles/Blogs/Press ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async searchForArticles(searchTerm: string): Promise<RawArticleData[]> {
    const articles: RawArticleData[] = [];

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const page = await context.newPage();

    try {
      // Use Google Search
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&tbm=nws`;
      console.log(`  Searching: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extract search results
      const resultElements = await page.locator('div[data-ved], .g, .tF2Cxc').all();

      for (const element of resultElements.slice(0, 20)) {
        // Limit to first 20 results per search term
        try {
          const articleData = await this.extractSearchResult(element);
          if (articleData) {
            articles.push(articleData);
          }
        } catch (error) {
          // Skip invalid results
        }
      }
    } catch (error) {
      console.warn(`  Error searching for "${searchTerm}":`, error);
    } finally {
      await page.close();
      await context.close();
    }

    return articles;
  }

  private async extractSearchResult(element: any): Promise<RawArticleData | null> {
    try {
      // Extract URL
      const linkElement = element.locator('a[href^="http"]').first();
      const url = await linkElement.getAttribute('href').catch(() => null);
      if (!url) return null;

      // Extract title
      const titleElement = element.locator('h3, .LC20lb, .DKV0Md').first();
      const title = await titleElement.textContent().catch(() => null) || '';

      // Extract description/snippet
      const descElement = element.locator('.VwiC3b, .s, .st').first();
      const description = await descElement.textContent().catch(() => null) || '';

      // Extract source/publication
      const sourceElement = element.locator('.fG8Fp, .UPmit').first();
      const source = await sourceElement.textContent().catch(() => null) || '';

      // Extract date if available
      const dateElement = element.locator('.fG8Fp, .f').last();
      const dateText = await dateElement.textContent().catch(() => null) || '';

      return {
        externalId: url,
        source: this.normalizeSource(source),
        title: title.trim(),
        description: description.trim(),
        url,
        publishedAt: this.parseDate(dateText),
      };
    } catch (error) {
      return null;
    }
  }

  private async fetchArticleContent(article: RawArticleData): Promise<RawArticleData | null> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();

    try {
      console.log(`  Fetching: ${article.url}`);
      await page.goto(article.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Get full HTML
      const html = await page.content();

      // Try to extract author
      const authorSelectors = [
        '[rel="author"]',
        '.author',
        '[class*="author"]',
        '[itemprop="author"]',
      ];

      let author: string | undefined;
      for (const selector of authorSelectors) {
        try {
          const authorElement = page.locator(selector).first();
          if (await authorElement.isVisible({ timeout: 1000 })) {
            author = await authorElement.textContent() || undefined;
            if (author) break;
          }
        } catch {
          // Continue to next selector
        }
      }

      // Try to extract published date from page
      const dateSelectors = [
        'time[datetime]',
        '[itemprop="datePublished"]',
        '[class*="date"]',
        '[class*="published"]',
      ];

      let publishedAt = article.publishedAt;
      for (const selector of dateSelectors) {
        try {
          const dateElement = page.locator(selector).first();
          if (await dateElement.isVisible({ timeout: 1000 })) {
            const dateAttr = await dateElement.getAttribute('datetime') || 
                           await dateElement.textContent() || '';
            if (dateAttr) {
              const parsed = this.parseDate(dateAttr);
              if (parsed) {
                publishedAt = parsed;
                break;
              }
            }
          }
        } catch {
          // Continue to next selector
        }
      }

      return {
        ...article,
        html,
        content: html, // Will be parsed by articleParser
        author,
        publishedAt,
      };
    } catch (error) {
      console.warn(`  Error fetching content from ${article.url}:`, error);
      // Return article with basic info even if full fetch fails
      return article;
    } finally {
      await page.close();
    }
  }

  private deduplicateArticles(articles: RawArticleData[]): RawArticleData[] {
    const seen = new Set<string>();
    const unique: RawArticleData[] = [];

    for (const article of articles) {
      const url = article.url.toLowerCase().split('?')[0]; // Remove query params for deduplication
      if (!seen.has(url)) {
        seen.add(url);
        unique.push(article);
      }
    }

    return unique;
  }

  private normalizeSource(source: string): string {
    const lower = source.toLowerCase();
    if (lower.includes('blog')) return 'blog';
    if (lower.includes('press') || lower.includes('news')) return 'press';
    return 'article';
  }

  private parseDate(dateText: string): Date | undefined {
    if (!dateText) return undefined;

    try {
      // Try ISO format first
      const isoDate = new Date(dateText);
      if (!isNaN(isoDate.getTime())) {
        return isoDate;
      }

      // Try common date formats
      const formats = [
        /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY
        /(\d{4})-(\d{1,2})-(\d{1,2})/, // YYYY-MM-DD
      ];

      for (const format of formats) {
        const match = dateText.match(format);
        if (match) {
          const date = new Date(dateText);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}

