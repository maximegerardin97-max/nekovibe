/**
 * Script to fetch GNews insights
 * Usage:
 *   npm run fetch:gnews:comprehensive  - Weekly comprehensive news check
 *   npm run fetch:gnews:recent         - Daily 7-day news check
 */

import * as dotenv from 'dotenv';
import { FetchGNewsInsightsJob } from '../src/ingestion/jobs/fetchGNewsInsightsJob';

dotenv.config();

async function main() {
  const scope = process.argv[2] as 'comprehensive' | 'last_7_days';
  
  if (!scope || !['comprehensive', 'last_7_days'].includes(scope)) {
    console.error('Usage: ts-node scripts/fetch-gnews-insights.ts [comprehensive|last_7_days]');
    process.exit(1);
  }

  console.log(`🚀 Starting GNews Insights fetch (${scope})...\n`);

  const job = new FetchGNewsInsightsJob();
  const result = await job.run(scope);

  if (result.stored) {
    console.log(`\n✅ Successfully stored ${scope} GNews insights`);
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

