/**
 * Manual script to run LinkedIn ingestion
 */

import * as dotenv from 'dotenv';
import { FetchLinkedInJob } from '../src/ingestion/jobs/fetchLinkedInJob';

dotenv.config();

async function main() {
  console.log('🚀 Starting LinkedIn Ingestion...\n');

  const job = new FetchLinkedInJob();
  const result = await job.run();

  console.log('\n📊 Final Results:');
  console.log(`   ✅ Added: ${result.added}`);
  console.log(`   ⏭️  Skipped: ${result.skipped}`);
  console.log(`   ❌ Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    result.errors.forEach((err) => {
      console.log(`   - ${err.item}: ${err.error}`);
    });
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

