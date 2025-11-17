/**
 * Manual script to run all ingestion jobs
 */

import * as dotenv from 'dotenv';
import { FetchGoogleReviewsJob } from '../src/ingestion/jobs/fetchGoogleReviewsJob';
import { FetchArticlesAndBlogsJob } from '../src/ingestion/jobs/fetchArticlesAndBlogsJob';

dotenv.config();

async function main() {
  console.log('🚀 Starting All Ingestion Jobs...\n');
  console.log('=' .repeat(60));

  // Run Google Reviews
  console.log('\n📝 Job 1: Google Reviews');
  console.log('-'.repeat(60));
  const reviewsJob = new FetchGoogleReviewsJob();
  const reviewsResult = await reviewsJob.run();

  // Run Articles
  console.log('\n📰 Job 2: Articles/Blogs/Press');
  console.log('-'.repeat(60));
  const articlesJob = new FetchArticlesAndBlogsJob();
  const articlesResult = await articlesJob.run();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log('\nGoogle Reviews:');
  console.log(`   ✅ Added: ${reviewsResult.added}`);
  console.log(`   ⏭️  Skipped: ${reviewsResult.skipped}`);
  console.log(`   ❌ Errors: ${reviewsResult.errors.length}`);

  console.log('\nArticles/Blogs/Press:');
  console.log(`   ✅ Added: ${articlesResult.added}`);
  console.log(`   ⏭️  Skipped: ${articlesResult.skipped}`);
  console.log(`   ❌ Errors: ${articlesResult.errors.length}`);

  const totalErrors = reviewsResult.errors.length + articlesResult.errors.length;
  if (totalErrors > 0) {
    console.log('\n⚠️  Total Errors:', totalErrors);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

