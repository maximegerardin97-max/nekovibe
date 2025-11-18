/**
 * Script to fetch Perplexity insights
 * Usage:
 *   npm run fetch:perplexity:comprehensive  - Weekly comprehensive check
 *   npm run fetch:perplexity:recent         - Daily 7-day check
 */

import * as dotenv from 'dotenv';
import { FetchPerplexityInsightsJob } from '../src/ingestion/jobs/fetchPerplexityInsightsJob';

dotenv.config();

async function main() {
  const scope = process.argv[2] as 'comprehensive' | 'last_7_days';
  
  if (!scope || !['comprehensive', 'last_7_days'].includes(scope)) {
    console.error('Usage: ts-node scripts/fetch-perplexity-insights.ts [comprehensive|last_7_days]');
    process.exit(1);
  }

  console.log(`🚀 Starting Perplexity Insights fetch (${scope})...\n`);

  const job = new FetchPerplexityInsightsJob();
  const result = await job.run(scope);

  if (result.stored) {
    console.log(`\n✅ Successfully stored ${scope} insights`);
    process.exit(0);
  } else {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

