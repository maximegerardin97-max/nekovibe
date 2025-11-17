/**
 * Core types for the Brand Intelligence Platform
 */

export interface GoogleReview {
  externalId: string; // Unique identifier from Google (e.g., review ID)
  clinicPlaceId: string; // Google Places ID for the clinic
  clinicName: string;
  authorName: string;
  authorUrl?: string;
  rating: number; // 1-5
  text: string;
  publishedAt: Date;
  responseText?: string; // Clinic's response if any
  responsePublishedAt?: Date;
  rawData?: Record<string, any>; // Store any additional metadata
}

export interface Article {
  externalId: string; // URL or unique identifier
  source: string; // e.g., "blog", "press", "news"
  title: string;
  description?: string;
  url: string;
  author?: string;
  publishedAt?: Date;
  content: string; // Full article text (cleaned)
  rawHtml?: string; // Original HTML for reference
  metadata?: Record<string, any>; // Additional metadata
}

export interface IngestionResult {
  added: number;
  skipped: number;
  errors: Array<{ item: string; error: string }>;
}

export interface IngestionJob {
  name: string;
  run(): Promise<IngestionResult>;
}

