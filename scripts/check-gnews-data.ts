/**
 * Check what GNews data is currently stored
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkGNewsData() {
  console.log('🔍 Checking GNews data in database...\n');

  // Check comprehensive
  const { data: comprehensive, error: compError } = await supabase
    .from('perplexity_insights')
    .select('*')
    .eq('scope', 'gnews_comprehensive')
    .single();

  if (comprehensive) {
    console.log('📰 GNews Comprehensive:');
    console.log(`   Last refreshed: ${comprehensive.last_refreshed_at}`);
    console.log(`   Query: ${comprehensive.query_text}`);
    console.log(`   Provider: ${comprehensive.metadata?.provider || 'unknown'}`);
    console.log(`   Total articles found: ${comprehensive.metadata?.total_articles || 0}`);
    console.log(`   Has no_results flag: ${comprehensive.metadata?.no_results || false}`);
    console.log(`\n   Response text (first 500 chars):`);
    console.log(`   ${comprehensive.response_text.substring(0, 500)}...`);
    console.log(`\n   Citations: ${comprehensive.citations?.length || 0}`);
  } else {
    console.log('❌ No GNews comprehensive data found');
    if (compError) console.log(`   Error: ${compError.message}`);
  }

  console.log('\n---\n');

  // Check last_7_days
  const { data: recent, error: recentError } = await supabase
    .from('perplexity_insights')
    .select('*')
    .eq('scope', 'gnews_last_7_days')
    .single();

  if (recent) {
    console.log('📰 GNews Last 7 Days:');
    console.log(`   Last refreshed: ${recent.last_refreshed_at}`);
    console.log(`   Query: ${recent.query_text}`);
    console.log(`   Provider: ${recent.metadata?.provider || 'unknown'}`);
    console.log(`   Total articles found: ${recent.metadata?.total_articles || 0}`);
    console.log(`   Has no_results flag: ${recent.metadata?.no_results || false}`);
    console.log(`\n   Response text (first 500 chars):`);
    console.log(`   ${recent.response_text.substring(0, 500)}...`);
    console.log(`\n   Citations: ${recent.citations?.length || 0}`);
  } else {
    console.log('❌ No GNews last_7_days data found');
    if (recentError) console.log(`   Error: ${recentError.message}`);
  }

  console.log('\n---\n');
  console.log('📊 Summary:');
  console.log(`   Comprehensive: ${comprehensive ? '✅ Stored' : '❌ Missing'}`);
  console.log(`   Last 7 Days: ${recent ? '✅ Stored' : '❌ Missing'}`);
  
  if (comprehensive && recent) {
    const hasRealData = !comprehensive.metadata?.no_results && !recent.metadata?.no_results;
    console.log(`   Has real articles: ${hasRealData ? '✅ Yes' : '❌ No (placeholders only)'}`);
  }
}

checkGNewsData().catch(console.error);


