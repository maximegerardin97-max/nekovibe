/**
 * Tavily Insights Ingestion Job
 * Fetches comprehensive and recent insights about Neko Health from Tavily API
 * Tavily is an AI-powered search API that's a great alternative to Perplexity
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

interface TavilyCitation {
  url: string;
  title?: string;
  published_at?: string;
}

interface TavilyResponse {
  query: string;
  response_time: number;
  answer: string;
  images: string[];
  follow_up_questions: string[];
  results: Array<{
    title: string;
    url: string;
    published_date?: string;
    author?: string;
    score: number;
    content: string;
  }>;
}

export class FetchTavilyInsightsJob {
  name = 'fetchTavilyInsights';

  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.tavily.com/search';
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;

  constructor() {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY not set in .env file');
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
    console.log(`\n🔍 Fetching Tavily insights (scope: ${scope})...`);

    const query = this.buildQuery(scope);
    console.log(`📝 Query: ${query.substring(0, 100)}...`);

    try {
      const response = await this.callTavilyAPI(query, scope);
      if (!response) {
        return { stored: false, error: 'Failed to get response from Tavily' };
      }

      const citations = this.extractCitations(response);
      console.log(`📚 Found ${citations.length} citations`);

      // Store in Supabase (using same table structure as Perplexity)
      const supabase = createClient(this.supabaseUrl, this.supabaseKey);
      const { error } = await supabase
        .from('perplexity_insights')
        .upsert({
          scope,
          query_text: query,
          response_text: response.answer || this.formatResults(response),
          citations: citations,
          metadata: {
            provider: 'tavily',
            response_time: response.response_time,
            results_count: response.results?.length || 0,
            follow_up_questions: response.follow_up_questions || [],
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

      console.log(`✅ Stored ${scope} insights successfully`);
      return { stored: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error:', errorMessage);
      return { stored: false, error: errorMessage };
    }
  }

  private buildQuery(scope: 'comprehensive' | 'last_7_days'): string {
    if (scope === 'comprehensive') {
      return 'Neko Health health check clinics: overall public perception, customer reviews, media coverage, market positioning, competitive analysis, key differentiators, strengths, weaknesses, controversies, trends';
    } else {
      return 'Neko Health latest news articles press releases blog posts social media mentions past 7 days';
    }
  }

  private async callTavilyAPI(query: string, scope: 'comprehensive' | 'last_7_days'): Promise<TavilyResponse | null> {
    try {
      const searchDepth = scope === 'comprehensive' ? 'advanced' : 'basic';
      const maxResults = scope === 'comprehensive' ? 20 : 15;
      const days = scope === 'last_7_days' ? 7 : undefined;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: searchDepth,
          include_answer: true,
          include_images: false,
          include_raw_content: false,
          max_results: maxResults,
          days,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Tavily API error:', response.status, errorText);
        return null;
      }

      const data: TavilyResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error calling Tavily API:', error);
      return null;
    }
  }

  private extractCitations(response: TavilyResponse): TavilyCitation[] {
    if (!response.results || !Array.isArray(response.results)) {
      return [];
    }

    return response.results.map((result) => ({
      url: result.url,
      title: result.title,
      published_at: result.published_date,
    }));
  }

  private formatResults(response: TavilyResponse): string {
    if (response.answer) {
      return response.answer;
    }

    // Fallback: format results manually
    const results = response.results || [];
    if (results.length === 0) {
      return 'No results found.';
    }

    const summary = results
      .slice(0, 10)
      .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.url}\n${r.content.substring(0, 200)}...`)
      .join('\n\n');

    return `Found ${results.length} relevant sources:\n\n${summary}`;
  }
}

