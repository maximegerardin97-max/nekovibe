/**
 * Perplexity Insights Ingestion Job
 * Fetches comprehensive and recent insights about Neko Health from Perplexity API
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

interface PerplexityCitation {
  url: string;
  title?: string;
  published_at?: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  object: string;
  created: number;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string;
    };
    delta?: {
      role?: string;
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  citations?: string[];
}

export class FetchPerplexityInsightsJob {
  name = 'fetchPerplexityInsights';

  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.perplexity.ai/chat/completions';
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;

  constructor() {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new Error('PERPLEXITY_API_KEY not set in .env file');
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
    console.log(`\n🔍 Fetching Perplexity insights (scope: ${scope})...`);

    const query = this.buildQuery(scope);
    console.log(`📝 Query: ${query.substring(0, 100)}...`);

    try {
      const response = await this.callPerplexityAPI(query);
      if (!response) {
        return { stored: false, error: 'Failed to get response from Perplexity' };
      }

      const citations = this.extractCitations(response);
      console.log(`📚 Found ${citations.length} citations`);

      // Store in Supabase
      const supabase = createClient(this.supabaseUrl, this.supabaseKey);
      const { error } = await supabase
        .from('perplexity_insights')
        .upsert({
          scope,
          query_text: query,
          response_text: response.choices[0]?.message?.content || '',
          citations: citations,
          metadata: {
            model: response.model,
            tokens_used: response.usage?.total_tokens || 0,
            created_at: new Date(response.created * 1000).toISOString(),
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
      return `Provide a comprehensive analysis of Neko Health based on all available online sources. Include:
- Overall public perception and sentiment
- Most frequent positive feedback themes
- Most common criticisms and concerns
- Where Neko Health is currently positioned in the market
- Key differentiators mentioned
- Media coverage trends
- Social media sentiment
- Any notable controversies or issues
- Competitive positioning

Focus on factual, data-driven insights from reviews, articles, press releases, and social media. Cite specific sources.`;
    } else {
      return `What are the latest news articles, blog posts, press releases, and social media mentions about Neko Health from the past 7 days? Focus on:
- New announcements or press releases
- Recent media coverage
- Latest social media discussions
- New blog posts or articles
- Any trending topics or controversies
- Recent customer feedback or reviews

Only include content from the last 7 days. Provide citations for all sources.`;
    }
  }

  private async callPerplexityAPI(query: string): Promise<PerplexityResponse | null> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.1-sonar-large-128k-online', // Online model for real-time web search
          messages: [
            {
              role: 'system',
              content: 'You are a research assistant that provides comprehensive, factual analysis based on web sources. Always cite your sources.',
            },
            {
              role: 'user',
              content: query,
            },
          ],
          temperature: 0.2, // Lower temp for more factual responses
          max_tokens: 4000, // Enough for comprehensive analysis
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Perplexity API error:', response.status, errorText);
        return null;
      }

      const data: PerplexityResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error calling Perplexity API:', error);
      return null;
    }
  }

  private extractCitations(response: PerplexityResponse): PerplexityCitation[] {
    const citations: PerplexityCitation[] = [];

    // Perplexity includes citations in the response
    if (response.citations && Array.isArray(response.citations)) {
      for (const citation of response.citations) {
        if (typeof citation === 'string') {
          citations.push({ url: citation });
        } else if (typeof citation === 'object' && citation.url) {
          citations.push({
            url: citation.url,
            title: citation.title,
            published_at: citation.published_at,
          });
        }
      }
    }

    // Also try to extract URLs from the response text
    const content = response.choices[0]?.message?.content || '';
    const urlRegex = /https?:\/\/[^\s\)]+/g;
    const urls = content.match(urlRegex) || [];
    
    for (const url of urls) {
      // Avoid duplicates
      if (!citations.some(c => c.url === url)) {
        citations.push({ url });
      }
    }

    return citations;
  }
}

