/**
 * LinkedIn Ingestion Job
 * Searches for and fetches LinkedIn posts about Neko Health
 */

import { chromium, Browser, Page } from 'playwright';
import * as dotenv from 'dotenv';
import { IngestionJob, IngestionResult, Article } from '../../types';
import { storeArticle } from '../../data/supabase';
import { parseArticle, RawArticleData } from '../parsers/articleParser';

dotenv.config();

export class FetchLinkedInJob implements IngestionJob {
  name = 'fetchLinkedIn';

  private browser: Browser | null = null;
  private readonly searchTerms = [
    'Neko Health',
    '"Neko Health"',
  ];

  async run(): Promise<IngestionResult> {
    const result: IngestionResult = {
      added: 0,
      skipped: 0,
      errors: [],
    };

    console.log('Starting LinkedIn ingestion...');

    try {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });

      const allPosts: RawArticleData[] = [];

      // Search using different search terms
      for (const searchTerm of this.searchTerms) {
        console.log(`\nSearching LinkedIn for: "${searchTerm}"`);
        const posts = await this.searchLinkedIn(searchTerm);
        allPosts.push(...posts);
      }

      // Deduplicate by URL
      const uniquePosts = this.deduplicatePosts(allPosts);
      console.log(`\nFound ${uniquePosts.length} unique LinkedIn posts`);

      // Fetch full content for each post
      for (const post of uniquePosts) {
        try {
          const fullPost = await this.fetchPostContent(post);
          if (!fullPost) {
            result.errors.push({ item: post.url, error: 'Failed to fetch content' });
            continue;
          }

          const parsed = parseArticle(fullPost);
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
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }

    console.log(`\n✅ LinkedIn ingestion complete:`);
    console.log(`   Added: ${result.added}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);

    return result;
  }

  private async searchLinkedIn(searchTerm: string): Promise<RawArticleData[]> {
    const posts: RawArticleData[] = [];

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
      // Use Google Search to find LinkedIn posts
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com ${searchTerm}`)}`;
      console.log(`  Searching: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extract search results
      const resultElements = await page.locator('div[data-ved], .g, .tF2Cxc').all();

      for (const element of resultElements.slice(0, 30)) {
        // Limit to first 30 results per search term
        try {
          const postData = await this.extractSearchResult(element);
          if (postData && postData.url.includes('linkedin.com')) {
            posts.push(postData);
          }
        } catch (error) {
          // Skip invalid results
        }
      }
    } catch (error) {
      console.warn(`  Error searching LinkedIn for "${searchTerm}":`, error);
    } finally {
      await page.close();
      await context.close();
    }

    return posts;
  }

  private async extractSearchResult(element: any): Promise<RawArticleData | null> {
    try {
      // Extract URL
      const linkElement = element.locator('a[href^="http"]').first();
      const url = await linkElement.getAttribute('href').catch(() => null);
      if (!url || !url.includes('linkedin.com')) return null;

      // Extract title
      const titleElement = element.locator('h3, .LC20lb, .DKV0Md').first();
      const title = await titleElement.textContent().catch(() => null) || '';

      // Extract description/snippet
      const descElement = element.locator('.VwiC3b, .s, .st').first();
      const description = await descElement.textContent().catch(() => null) || '';

      // Extract author (usually in the source line for LinkedIn)
      const sourceElement = element.locator('.fG8Fp, .UPmit').first();
      const source = await sourceElement.textContent().catch(() => null) || '';

      // Extract date if available
      const dateElement = element.locator('.fG8Fp, .f').last();
      const dateText = await dateElement.textContent().catch(() => null) || '';

      // Try to extract author name from LinkedIn URL or source
      let author: string | undefined;
      const linkedinMatch = url.match(/linkedin\.com\/in\/([^\/]+)/);
      if (linkedinMatch) {
        author = linkedinMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      } else if (source) {
        author = source.split('·')[0]?.trim();
      }

      return {
        externalId: url,
        source: 'linkedin',
        title: title.trim() || 'LinkedIn Post',
        description: description.trim(),
        url,
        author,
        publishedAt: this.parseDate(dateText),
      };
    } catch (error) {
      return null;
    }
  }

  private async fetchPostContent(post: RawArticleData): Promise<RawArticleData | null> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();

    try {
      console.log(`  Fetching: ${post.url}`);
      await page.goto(post.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000); // LinkedIn needs more time to load

      // Get full HTML
      const html = await page.content();

      // Try to extract author from page
      let author = post.author;
      const authorSelectors = [
        '.feed-shared-actor__name',
        '[data-control-name="actor"]',
        '.pv-text-details__left-panel h1',
        '.text-heading-xlarge',
      ];

      for (const selector of authorSelectors) {
        try {
          const authorElement = page.locator(selector).first();
          if (await authorElement.isVisible({ timeout: 2000 })) {
            const authorText = await authorElement.textContent();
            if (authorText) {
              author = authorText.trim();
              break;
            }
          }
        } catch {
          // Continue to next selector
        }
      }

      // Try to extract post content
      const contentSelectors = [
        '.feed-shared-text',
        '.feed-shared-update-v2__description',
        '.feed-shared-text-view',
        '[data-test-id="main-feed-activity-card"]',
      ];

      let content = post.description || '';
      for (const selector of contentSelectors) {
        try {
          const contentElement = page.locator(selector).first();
          if (await contentElement.isVisible({ timeout: 2000 })) {
            const contentText = await contentElement.textContent();
            if (contentText && contentText.length > content.length) {
              content = contentText.trim();
            }
          }
        } catch {
          // Continue to next selector
        }
      }

      // Try to extract published date from page
      const dateSelectors = [
        'time[datetime]',
        '.feed-shared-actor__sub-description time',
        '.feed-shared-actor__sub-description',
      ];

      let publishedAt = post.publishedAt;
      for (const selector of dateSelectors) {
        try {
          const dateElement = page.locator(selector).first();
          if (await dateElement.isVisible({ timeout: 2000 })) {
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
        ...post,
        html,
        content: content || html, // Will be parsed by articleParser
        author,
        publishedAt,
      };
    } catch (error) {
      console.warn(`  Error fetching content from ${post.url}:`, error);
      // Return post with basic info even if full fetch fails
      return post;
    } finally {
      await page.close();
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

  private parseDate(dateText: string): Date | undefined {
    if (!dateText) return undefined;

    try {
      // Try ISO format first
      const isoDate = new Date(dateText);
      if (!isNaN(isoDate.getTime())) {
        return isoDate;
      }

      // Try LinkedIn date formats like "2 days ago", "1 week ago", etc.
      const relativeDateMatch = dateText.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
      if (relativeDateMatch) {
        const amount = parseInt(relativeDateMatch[1]);
        const unit = relativeDateMatch[2].toLowerCase();
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

