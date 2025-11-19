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
  console.log('⏱️  This may take several minutes. The function will process clinics in batches...\n');
  
  try {
    // Set a longer timeout (10 minutes) since the function processes in batches
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes
    
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle 520/timeout errors gracefully
      if (response.status === 520 || response.status >= 500) {
        console.warn('⚠️  Edge function timed out or encountered an error.');
        console.warn('This is normal for large datasets. The function may have processed some summaries.');
        console.warn('\n💡 Suggestions:');
        console.warn('   1. Check the feedback_summaries table in Supabase - some summaries may have been generated');
        console.warn('   2. Run the function again - it will skip already-generated summaries');
        console.warn('   3. Or run it clinic-by-clinic using the clinic_only parameter');
        console.warn('\n📊 Error details:', errorText.substring(0, 500));
        process.exit(0); // Exit with success since partial completion is OK
      }
      
      console.error('❌ Error:', response.status, errorText.substring(0, 500));
      process.exit(1);
    }

    const result = await response.json();
    
    // Check if it's a partial completion
    if (result.message && result.message.includes('Partial completion')) {
      console.log('⚠️  Partial completion due to timeout:');
      console.log(`   Processed: ${result.processed || 0}/${result.total || 0} clinics`);
      if (result.remaining_clinics) {
        console.log(`   Remaining: ${result.remaining_clinics.join(', ')}`);
      }
      console.log('\n💡 Some summaries were generated. Run again to process remaining clinics.');
    } else {
      console.log('✅ Summary generation completed!');
      console.log(`📊 Total summaries generated: ${result.total || 'unknown'}`);
    }
    
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
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('❌ Request timed out after 10 minutes.');
      console.error('The function may have processed some summaries. Check Supabase.');
    } else {
      console.error('❌ Failed to generate summaries:', error.message || error);
    }
    process.exit(1);
  }
}

generateSummaries();

