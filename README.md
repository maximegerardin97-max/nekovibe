# Neko Brand Intelligence Platform

A scalable Brand Intelligence Platform that automatically collects, stores, and analyzes public mentions of Neko across multiple sources.

## Overview

This platform is designed to:
- **Ingest** data from multiple public sources (Google Reviews, articles, blogs, press mentions, social media)
- **Store** everything in Supabase in a normalized, structured format
- **Analyze** using LLM pipelines to generate insights, summaries, and trend analysis
- **Automate** daily ingestion and analysis jobs

## Current Status (Step 1)

✅ **Implemented:**
- Google Reviews ingestion for Neko clinics
- Articles/Blogs/Press ingestion
- Supabase storage with duplicate prevention
- Manual execution scripts

🚧 **Future (Not Yet Implemented):**
- Social media ingestion (Instagram, TikTok, YouTube, LinkedIn)
- LLM analysis and summarization
- Automated scheduling
- Perplexity API integration

## Project Structure

```
nekovibe/
├── src/
│   ├── types/              # TypeScript type definitions
│   ├── data/               # Supabase data access layer
│   ├── ingestion/
│   │   ├── jobs/          # Ingestion job implementations
│   │   └── parsers/       # Data parsing and cleaning utilities
│   └── utils/             # Shared utilities
├── scripts/               # Manual execution scripts
├── supabase/              # Database schema
└── dist/                  # Compiled JavaScript (generated)
```

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Supabase project
- Google Places IDs for Neko clinics

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   ```env
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   GOOGLE_PLACES_IDS=https://maps.google.com/...,https://maps.google.com/...  # Comma-separated list of Google Maps URLs
   GOOGLE_PLACES_API_KEY=your_google_places_api_key  # Required for reviews
   ```

3. **Set up Supabase database:**
   - Go to your Supabase project SQL Editor
   - Run the SQL from `supabase/schema.sql`
   - This creates the `google_reviews` and `articles` tables with proper indexes

4. **Get Google Places API Key:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a project or select an existing one
   - Enable the "Places API" and "Places API (New)"
   - Create credentials (API Key)
   - Add the API key to `.env` as `GOOGLE_PLACES_API_KEY`

5. **Add Clinic URLs:**
   - Find each clinic on Google Maps
   - Copy the full Google Maps URL for each clinic
   - Add them to `.env` as `GOOGLE_PLACES_IDS` (comma-separated)
   - The system will automatically find the Place IDs using the API

### Build

```bash
npm run build
```

## Usage

### Manual Execution

Run individual ingestion jobs:

```bash
# Fetch Google Reviews
npm run fetch:reviews

# Fetch Articles/Blogs/Press
npm run fetch:articles

# Run both jobs
npm run fetch:all

# Start hourly Google Reviews job (runs every hour)
npm run schedule:reviews
```

Or use TypeScript directly:

```bash
npx ts-node scripts/fetch-google-reviews.ts
npx ts-node scripts/fetch-articles.ts
npx ts-node scripts/fetch-all.ts
```

## Conversational insights (Nekovibe)

We bundle a lightweight “ChatGPT-style” interface plus an Edge Function so teams can interrogate all reviews in natural language.

### 1. Deploy the edge function

```bash
supabase functions deploy nekovibe-chat --env-file supabase/.env.functions
```

The env file should provide:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=sk-...
# optional
OPENAI_MODEL=gpt-4o-mini
NEKOVIBE_REVIEWS_LIMIT=60
```

### 2. Host the UI

The static assets live in `web/nekovibe/`.

1. Edit `web/nekovibe/index.html` and set the `data-function-url` attribute on `<body>` to your deployed function URL (e.g. `https://xyz.functions.supabase.co/nekovibe-chat`).
2. Serve the folder however you’d like (Supabase Storage, Vercel, Netlify, an S3 bucket, or simply open the HTML file locally during development).

The UI ships with:

- Minimal, aesthetic chat layout inspired by ChatGPT
- Source filters (Reviews on, Articles/Social placeholders for future data)
- Streaming-like UX with optimistic user bubbles

When a question is submitted the browser calls the `nekovibe-chat` function, which:

1. Pulls the most recent reviews from Supabase (respecting `NEKOVIBE_REVIEWS_LIMIT`)
2. Builds a context block and sends the request to OpenAI
3. Returns a concise answer grounded in Neko Health data

Extend the function later to include articles or social data by adding new branches to the source switch.

### Programmatic Usage

```typescript
import { FetchGoogleReviewsJob } from './src/ingestion/jobs/fetchGoogleReviewsJob';
import { FetchArticlesAndBlogsJob } from './src/ingestion/jobs/fetchArticlesAndBlogsJob';

// Run Google Reviews job
const reviewsJob = new FetchGoogleReviewsJob();
const reviewsResult = await reviewsJob.run();

// Run Articles job
const articlesJob = new FetchArticlesAndBlogsJob();
const articlesResult = await articlesJob.run();
```

## Architecture

### Ingestion Jobs

Each ingestion job implements the `IngestionJob` interface:

```typescript
interface IngestionJob {
  name: string;
  run(): Promise<IngestionResult>;
}
```

**Current Jobs:**
- `FetchGoogleReviewsJob`: Fetches Google Maps reviews using Google Places API for configured clinics
- `FetchArticlesAndBlogsJob`: Searches and fetches articles about Neko

### Data Flow

1. **Fetch**: Job retrieves raw data from source
2. **Parse**: Parser normalizes data into structured format
3. **Store**: Data access layer stores in Supabase with duplicate checking
4. **Log**: Results are logged (added, skipped, errors)

### Duplicate Prevention

- **Google Reviews**: Uniqueness by `external_id` + `clinic_place_id`
- **Articles**: Uniqueness by `external_id` (typically URL)

### Data Models

**GoogleReview:**
- `externalId`: Unique Google review ID
- `clinicPlaceId`: Google Places ID
- `authorName`, `authorUrl`
- `rating`: 1-5
- `text`: Review content
- `publishedAt`: Publication date
- `responseText`, `responsePublishedAt`: Clinic response (if any)

**Article:**
- `externalId`: Unique identifier (URL)
- `source`: Type (blog, press, article)
- `title`, `description`, `url`
- `author`, `publishedAt`
- `content`: Cleaned full text
- `rawHtml`: Original HTML (optional)

## Database Schema

### Tables

**`google_reviews`**
- Stores all Google Reviews with full metadata
- Indexed on `clinic_place_id`, `published_at`, `rating`
- Stores `clinic_name` for downstream analytics and grouping
- Full-text search enabled on `text`

**`articles`**
- Stores articles, blog posts, press mentions
- Indexed on `source`, `published_at`, `url`
- Full-text search enabled on `content` and `title`

See `supabase/schema.sql` for full schema definition.

## Extending the Platform

### Adding a New Ingestion Source

1. **Create a new job** in `src/ingestion/jobs/`:
   ```typescript
   export class FetchNewSourceJob implements IngestionJob {
     name = 'fetchNewSource';
     async run(): Promise<IngestionResult> {
       // Implementation
     }
   }
   ```

2. **Create a parser** in `src/ingestion/parsers/` if needed

3. **Add data access functions** in `src/data/supabase.ts`

4. **Create a script** in `scripts/` for manual execution

5. **Update database schema** if new table is needed

### Future Enhancements

- **Social Media Ingestion**: Instagram, TikTok, YouTube, LinkedIn
- **LLM Analysis**: Sentiment analysis, trend detection, summarization
- **Scheduling**: Daily automated jobs (cron, GitHub Actions, etc.)
- **Perplexity API**: Broader discovery of mentions
- **Dashboard**: Web interface for viewing insights

## Troubleshooting

### Common Issues

**"Missing Supabase configuration"**
- Ensure `.env` file exists with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

**"No clinic place IDs configured"**
- Set `GOOGLE_PLACES_IDS` in `.env` as comma-separated list

**Playwright browser errors**
- Ensure Playwright browsers are installed: `npx playwright install chromium`

**Duplicate detection not working**
- Check that `external_id` is being set correctly in parsers
- Verify database constraints are in place (run `schema.sql`)

## Development

### TypeScript

The project uses TypeScript. To compile:

```bash
npm run build
```

### Code Structure

- **Types**: Centralized in `src/types/`
- **Data Access**: All Supabase operations in `src/data/`
- **Parsers**: Normalize raw data into structured formats
- **Jobs**: Implement ingestion logic independently

## License

ISC

## Contributing

This is an internal project for Neko. For questions or issues, contact the development team.

