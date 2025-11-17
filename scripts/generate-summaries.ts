/**
 * Script to generate all feedback summaries
 * Run with: npx ts-node scripts/generate-summaries.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-summaries`;

async function generateSummaries() {
  console.log('🚀 Starting summary generation...');
  console.log(`📡 Calling: ${FUNCTION_URL}`);
  
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Error:', response.status, errorText);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Summary generation started!');
    console.log(`📊 Total summaries to generate: ${result.total || 'unknown'}`);
    console.log('\n📝 Results:');
    
    if (result.results) {
      result.results.forEach((r: any, idx: number) => {
        console.log(`\n[${idx + 1}] ${r.clinic_id || 'Global'} | ${r.source_type || 'All'} | ${r.scope}`);
        console.log(`   Status: ${r.status}`);
        if (r.items_count) console.log(`   Items: ${r.items_count}`);
        if (r.error) console.log(`   Error: ${r.error}`);
      });
    }
    
    console.log('\n✨ Done! Check the feedback_summaries table in Supabase.');
  } catch (error) {
    console.error('❌ Failed to generate summaries:', error);
    process.exit(1);
  }
}

generateSummaries();

