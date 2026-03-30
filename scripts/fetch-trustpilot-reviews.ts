import * as dotenv from 'dotenv';
import { FetchTrustpilotReviewsJob } from '../src/ingestion/jobs/fetchTrustpilotReviewsJob';

dotenv.config();

async function main() {
  console.log('Starting Trustpilot reviews ingestion...\n');
  const job = new FetchTrustpilotReviewsJob();
  const result = await job.run();

  if (result.errors.length > 0) {
    console.error('\nErrors encountered:');
    result.errors.forEach(e => console.error(`  - ${e.item}: ${e.error}`));
    process.exit(1);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
