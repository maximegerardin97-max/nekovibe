/**
 * Scheduler script to run Google Reviews ingestion hourly
 */

import * as dotenv from 'dotenv';
import cron from 'node-cron';
import { FetchGoogleReviewsJob } from '../src/ingestion/jobs/fetchGoogleReviewsJob';

dotenv.config();

const job = new FetchGoogleReviewsJob();

async function runJob() {
  console.log(`[${new Date().toISOString()}] Running scheduled Google Reviews ingestion...`);
  try {
    await job.run();
  } catch (error) {
    console.error('Scheduled job failed:', error);
  }
}

// Run immediately on start
runJob();

// Schedule to run every hour
cron.schedule('0 * * * *', runJob, {
  timezone: 'Etc/UTC',
});

console.log('Google Reviews scheduler started. Job runs hourly at minute 00 UTC.');

