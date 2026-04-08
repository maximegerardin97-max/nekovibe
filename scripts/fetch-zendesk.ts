/**
 * Fetch Zendesk tickets and CSAT ratings
 * Run: npx ts-node scripts/fetch-zendesk.ts
 */

import * as dotenv from 'dotenv';
import { FetchZendeskJob } from '../src/ingestion/jobs/fetchZendeskJob';

dotenv.config();

async function main() {
  console.log('🚀 Starting Zendesk Ingestion...\n');

  const job = new FetchZendeskJob();
  const result = await job.run();

  console.log('\n📊 Final Results:');
  console.log(`   ✅ Upserted: ${result.added}`);
  console.log(`   ⏭️  Skipped:  ${result.skipped}`);
  console.log(`   ❌ Errors:   ${result.errors}`);

  process.exit(result.errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
