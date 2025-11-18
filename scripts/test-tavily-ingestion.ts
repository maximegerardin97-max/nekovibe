/**
 * Test Tavily ingestion job
 * Tests both comprehensive and recent (7-day) insights
 */

import * as dotenv from 'dotenv';
import { FetchTavilyInsightsJob } from '../src/ingestion/jobs/fetchTavilyInsightsJob';

dotenv.config();

async function main() {
  console.log('🧪 Testing Tavily Ingestion Job\n');
  
  // Add API key to env if not already set
  if (!process.env.TAVILY_API_KEY) {
    process.env.TAVILY_API_KEY = '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';
    console.log('✅ Using provided API key\n');
  }

  const job = new FetchTavilyInsightsJob();

  // Test recent (7-day) insights
  console.log('📅 Testing recent insights (last 7 days)...\n');
  const recentResult = await job.run('last_7_days');
  
  if (recentResult.stored) {
    console.log('\n✅ Recent insights stored successfully!\n');
  } else {
    console.error(`\n❌ Failed to store recent insights: ${recentResult.error}\n`);
  }

  // Test comprehensive insights
  console.log('🌐 Testing comprehensive insights...\n');
  const comprehensiveResult = await job.run('comprehensive');
  
  if (comprehensiveResult.stored) {
    console.log('\n✅ Comprehensive insights stored successfully!\n');
  } else {
    console.error(`\n❌ Failed to store comprehensive insights: ${comprehensiveResult.error}\n`);
  }

  if (recentResult.stored && comprehensiveResult.stored) {
    console.log('🎉 All tests passed! Tavily ingestion is working correctly.');
    process.exit(0);
  } else {
    console.error('❌ Some tests failed. Check the errors above.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

