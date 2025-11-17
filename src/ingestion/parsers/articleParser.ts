/**
 * Parser for Articles/Blogs/Press data
 * Normalizes raw article data and extracts clean text from HTML
 */

import * as cheerio from 'cheerio';
import { Article } from '../../types';

export interface RawArticleData {
  externalId: string;
  source?: string;
  title?: string;
  description?: string;
  url: string;
  author?: string;
  publishedAt?: string | Date;
  content?: string; // HTML or plain text
  html?: string; // Raw HTML
  [key: string]: any; // Allow additional fields
}

/**
 * Parse and normalize raw Article data
 */
export function parseArticle(raw: RawArticleData): Article | null {
  try {
    // Validate required fields
    if (!raw.externalId || !raw.url) {
      console.warn('Missing required fields (externalId or url)', raw);
      return null;
    }

    // Use URL as externalId if not provided
    const externalId = raw.externalId || raw.url;

    // Determine source type
    const source = determineSource(raw.source, raw.url);

    // Normalize title
    const title = cleanText(raw.title || extractTitleFromUrl(raw.url) || 'Untitled');

    // Normalize date
    let publishedAt: Date | undefined;
    if (raw.publishedAt) {
      if (raw.publishedAt instanceof Date) {
        publishedAt = raw.publishedAt;
      } else if (typeof raw.publishedAt === 'string') {
        publishedAt = new Date(raw.publishedAt);
        if (isNaN(publishedAt.getTime())) {
          publishedAt = undefined;
        }
      }
    }

    // Extract and clean content
    const html = raw.html || raw.content || '';
    const content = extractCleanText(html);

    if (!content || content.trim().length < 50) {
      console.warn('Article has insufficient content', { url: raw.url, contentLength: content?.length });
      // Still store it, but log a warning
    }

    // Extract metadata (excluding fields we're using)
    const { externalId: _, source: __, title: ___, description, url, author, publishedAt: ____, content: _____, html: ______, ...metadata } = raw;

    return {
      externalId,
      source,
      title,
      description: raw.description ? cleanText(raw.description) : undefined,
      url,
      author: raw.author ? cleanText(raw.author) : undefined,
      publishedAt,
      content: content || '',
      rawHtml: html || undefined,
      metadata,
    };
  } catch (error) {
    console.error('Error parsing Article:', error, raw);
    return null;
  }
}

/**
 * Extract clean, readable text from HTML
 */
function extractCleanText(html: string): string {
  if (!html) return '';

  try {
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script, style, noscript').remove();

    // Remove common non-content elements
    $('nav, header, footer, aside, .advertisement, .ads, .sidebar').remove();

    // Try to find main content area
    let content = '';
    const mainSelectors = ['article', 'main', '.content', '.post-content', '.entry-content', '#content'];
    
    for (const selector of mainSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = element.text();
        break;
      }
    }

    // Fallback to body text if no main content found
    if (!content) {
      content = $('body').text();
    }

    // Clean up the text
    return cleanText(content);
  } catch (error) {
    // If HTML parsing fails, try to extract text directly
    return cleanText(html.replace(/<[^>]*>/g, ''));
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
    .replace(/[^\S\n]+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Determine article source type from URL or explicit source
 */
function determineSource(explicitSource?: string, url?: string): string {
  if (explicitSource) {
    return explicitSource.toLowerCase();
  }

  if (!url) return 'unknown';

  const urlLower = url.toLowerCase();

  if (urlLower.includes('blog') || urlLower.includes('/blog/')) return 'blog';
  if (urlLower.includes('press') || urlLower.includes('news') || urlLower.includes('/press/')) return 'press';
  if (urlLower.includes('article') || urlLower.includes('/article/')) return 'article';
  if (urlLower.includes('medium.com')) return 'blog';
  if (urlLower.includes('substack.com')) return 'blog';

  return 'article'; // Default
}

/**
 * Extract a title from URL as fallback
 */
function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      return decodeURIComponent(lastPart)
        .replace(/[-_]/g, ' ')
        .replace(/\.[^.]+$/, '') // Remove extension
        .trim();
    }
  } catch {
    // Invalid URL, ignore
  }
  return '';
}

