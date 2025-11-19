/**
 * Script to generate all feedback summaries
 * Run with: npx ts-node scripts/generate-summaries.ts
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-summaries`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const FAKE_CLINIC_FOR_GLOBAL = '__GLOBAL_ONLY__';

interface GenerateRequest {
  skip_global?: boolean;
  clinic_only?: string;
}

async function callGenerateFunction(body: GenerateRequest, label: string) {
  console.log(`\n📡 Calling: ${FUNCTION_URL} (${label})`);
  console.log('⏱️  This may take several minutes...\n');

  // Set a longer timeout (10 minutes) since the function processes in batches
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();

      // Handle 520/timeout errors gracefully
      if (response.status === 520 || response.status >= 500) {
        console.warn(`⚠️  Edge function timed out or encountered an error while processing "${label}".`);
        console.warn('This is normal for large datasets. The function may have processed some summaries.');
        console.warn('\n💡 Suggestions:');
        console.warn('   1. Check the feedback_summaries table in Supabase - some summaries may have been generated');
        console.warn('   2. Run the script again - it will skip already-generated summaries');
        console.warn('   3. If this keeps happening for a clinic, run the Edge Function manually for that clinic');
        console.warn('\n📊 Error details:', errorText.substring(0, 500));
        return;
      }

      console.error('❌ Error:', response.status, errorText.substring(0, 500));
      throw new Error(`Failed to process "${label}"`);
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
      console.log(`✅ ${label} completed!`);
      if (result.total) {
        console.log(`📊 Total summaries generated: ${result.total}`);
      }
    }

    if (result.results) {
      console.log('\n📝 Results:');
      result.results.forEach((r: any, idx: number) => {
        console.log(`\n[${idx + 1}] ${r.clinic_id || 'Global'} | ${r.source_type || 'All'} | ${r.scope}`);
        console.log(`   Status: ${r.status}`);
        if (r.items_count) console.log(`   Items: ${r.items_count}`);
        if (r.error) console.log(`   Error: ${r.error}`);
      });
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`❌ Request timed out after 10 minutes while processing "${label}".`);
      console.error('The function may have processed some summaries. Check Supabase.');
    } else {
      console.error('❌ Failed to generate summaries:', error.message || error);
    }
  }
}

async function fetchClinics(targetClinic?: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('feedback_items')
    .select('clinic_id')
    .not('clinic_id', 'is', null);

  if (error) {
    console.error('Failed to fetch clinics:', error.message);
    process.exit(1);
  }

  const clinics = [...new Set((data || []).map((row: { clinic_id: string }) => row.clinic_id))];

  if (targetClinic) {
    return clinics.filter((clinic) => clinic === targetClinic);
  }

  return clinics;
}

async function generateSummaries() {
  console.log('🚀 Starting summary generation (sequential mode)...');

  const clinicArg = process.argv[2];
  const clinics = await fetchClinics(clinicArg);

  if (clinics.length === 0) {
    if (clinicArg) {
      console.warn(`⚠️  No clinic found matching "${clinicArg}".`);
    } else {
      console.warn('⚠️  No clinics found in feedback_items. Nothing to generate.');
    }
    process.exit(0);
  }

  console.log(`📋 Clinics to process (${clinics.length}):`, clinics.join(', '));

  // 1. Generate global summaries once (skip clinic processing by using a fake clinic id)
  console.log('\n🌍 Generating global summaries...');
  await callGenerateFunction({ skip_global: false, clinic_only: FAKE_CLINIC_FOR_GLOBAL }, 'Global summaries');

  // 2. Process each clinic sequentially (skip global to avoid duplication)
  for (const clinicId of clinics) {
    console.log(`\n🏥 Processing clinic: ${clinicId}`);
    await callGenerateFunction({ skip_global: true, clinic_only: clinicId }, clinicId);
  }

  console.log('\n✨ All requested clinics processed. Check the feedback_summaries table in Supabase.');
}

generateSummaries();

