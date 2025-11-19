/**
 * GNews Insights Ingestion Job
 * Fetches news articles about Neko Health from GNews API
 * Complements Tavily by providing structured news articles from 60,000+ sources
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

interface GNewsArticle {
  title: string;
  description: string;
  content: string;
  url: string;
  image: string;
  publishedAt: string;
  source: {
    name: string;
    url: string;
  };
}

interface GNewsResponse {
  totalArticles?: number;
  articles?: GNewsArticle[];
  // GNews might return data in different formats
  [key: string]: any;
}

export class FetchGNewsInsightsJob {
  name = 'fetchGNewsInsights';

  private readonly apiKey: string;
  private readonly apiUrl = 'https://gnews.io/api/v4';
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;

  constructor() {
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) {
      throw new Error('GNEWS_API_KEY not set in .env file');
    }
    this.apiKey = apiKey;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    }
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
  }

  async run(scope: 'comprehensive' | 'last_7_days'): Promise<{ stored: boolean; error?: string }> {
    console.log(`\n📰 Fetching GNews insights (scope: ${scope})...`);

    const query = this.buildQuery(scope);
    const maxArticles = scope === 'comprehensive' ? 50 : 30;
    const days = scope === 'last_7_days' ? 7 : undefined;

    console.log(`📝 Query: ${query}`);
    console.log(`📊 Max articles: ${maxArticles}`);

    try {
      const articles = await this.callGNewsAPI(query, maxArticles, days);
      if (!articles || articles.length === 0) {
        console.warn('⚠️  No articles found from GNews - storing placeholder');
        
        // Store a placeholder so the system knows GNews was checked
        const placeholderSummary = `GNews search for "Neko Health" returned no accessible articles. 

Note: GNews free plan has limitations:
- Real-time articles (less than 12 hours old) are delayed on free plans
- Historical articles (beyond 30 days) require a paid plan
- Articles may be filtered out due to these restrictions

GNews will continue to be checked daily/weekly. Consider upgrading to a paid GNews plan for full access to real-time and historical news articles.`;
        
        const supabase = createClient(this.supabaseUrl, this.supabaseKey);
        const { error } = await supabase
          .from('perplexity_insights')
          .upsert({
            scope: `gnews_${scope}`,
            query_text: query,
            response_text: placeholderSummary,
            citations: [],
            metadata: {
              provider: 'gnews',
              total_articles: 0,
              articles_processed: 0,
              no_results: true,
            },
            last_refreshed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'scope',
          });

        if (error) {
          console.error('❌ Error storing placeholder:', error);
          return { stored: false, error: error.message };
        }

        console.log(`✅ Stored GNews ${scope} placeholder (no articles found)`);
        return { stored: true };
      }

      console.log(`📚 Found ${articles.length} articles`);

      // Format articles into a summary
      const summary = this.formatArticlesSummary(articles, scope);
      const citations = this.extractCitations(articles);

      // Store in Supabase (using same table structure, but with provider: 'gnews')
      const supabase = createClient(this.supabaseUrl, this.supabaseKey);
      const { error } = await supabase
        .from('perplexity_insights')
        .upsert({
          scope: `gnews_${scope}`, // Store as separate scope: gnews_comprehensive, gnews_last_7_days
          query_text: query,
          response_text: summary,
          citations: citations,
          metadata: {
            provider: 'gnews',
            total_articles: articles.length,
            articles_processed: articles.length,
          },
          last_refreshed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'scope',
        });

      if (error) {
        console.error('❌ Error storing insights:', error);
        return { stored: false, error: error.message };
      }

      console.log(`✅ Stored GNews ${scope} insights successfully`);
      return { stored: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error:', errorMessage);
      return { stored: false, error: errorMessage };
    }
  }

  private buildQuery(scope: 'comprehensive' | 'last_7_days'): string {
    // Use broader queries to catch more articles
    if (scope === 'comprehensive') {
      return 'Neko Health OR "Neko Health" health check clinic preventive healthcare';
    } else {
      return 'Neko Health OR "Neko Health"';
    }
  }

  private async callGNewsAPI(query: string, maxArticles: number, days?: number): Promise<GNewsArticle[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        token: this.apiKey,
        max: maxArticles.toString(),
        lang: 'en',
        sortby: 'publishedAt',
      });

      if (days) {
        // GNews uses 'in' parameter for date range: "7d" for last 7 days
        params.append('in', `${days}d`);
      }

      const url = `${this.apiUrl}/search?${params.toString()}`;
      console.log(`📡 Calling GNews API: ${url.replace(this.apiKey, '***')}`);

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GNews API error:', response.status, errorText);
        return [];
      }

      const data: any = await response.json();
      
      // Log response for debugging
      console.log(`📊 GNews API response structure:`, JSON.stringify(Object.keys(data)).substring(0, 200));
      console.log(`📊 Total articles: ${data.totalArticles || data.articles?.length || 0}`);
      
      // Handle different response formats
      const articles = data.articles || [];
      
      if (!articles || articles.length === 0) {
        console.warn('⚠️  GNews returned empty articles array');
        // Log full response for debugging (first 500 chars)
        console.log('📋 Full response sample:', JSON.stringify(data).substring(0, 500));
        return [];
      }
      
      console.log(`✅ Successfully parsed ${articles.length} articles`);
      return articles;
    } catch (error) {
      console.error('Error calling GNews API:', error);
      return [];
    }
  }

  private extractCitations(articles: GNewsArticle[]): Array<{ url: string; title?: string; published_at?: string }> {
    return articles.map((article) => ({
      url: article.url,
      title: article.title,
      published_at: article.publishedAt,
    }));
  }

  private formatArticlesSummary(articles: GNewsArticle[], scope: 'comprehensive' | 'last_7_days'): string {
    const scopeLabel = scope === 'comprehensive' ? 'comprehensive' : 'last 7 days';
    
    let summary = `GNews found ${articles.length} news articles about Neko Health (${scopeLabel}):\n\n`;

    // Group by source for better organization
    const bySource: Record<string, GNewsArticle[]> = {};
    articles.forEach((article) => {
      const sourceName = article.source?.name || 'Unknown Source';
      if (!bySource[sourceName]) {
        bySource[sourceName] = [];
      }
      bySource[sourceName].push(article);
    });

    // Format summary with key articles
    summary += `**Top Sources:**\n`;
    Object.entries(bySource).slice(0, 10).forEach(([source, sourceArticles]) => {
      summary += `- ${source}: ${sourceArticles.length} article(s)\n`;
    });

    summary += `\n**Key Articles:**\n\n`;
    articles.slice(0, 15).forEach((article, idx) => {
      const date = article.publishedAt ? new Date(article.publishedAt).toISOString().split('T')[0] : 'Unknown date';
      summary += `${idx + 1}. **${article.title}**\n`;
      summary += `   Source: ${article.source?.name || 'Unknown'}\n`;
      summary += `   Date: ${date}\n`;
      if (article.description) {
        summary += `   ${article.description.substring(0, 200)}${article.description.length > 200 ? '...' : ''}\n`;
      }
      summary += `   URL: ${article.url}\n\n`;
    });

    if (articles.length > 15) {
      summary += `\n... and ${articles.length - 15} more articles.`;
    }

    return summary;
  }
}

