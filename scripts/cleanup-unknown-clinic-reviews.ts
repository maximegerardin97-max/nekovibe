/**
 * Utility script to delete legacy Google Reviews rows that
 * still have clinic_name = 'Unknown Clinic'.
 */

import * as dotenv from 'dotenv';
import { supabase } from '../src/data/supabase';

dotenv.config();

async function main() {
  console.log('🔍 Cleaning up legacy Google Reviews without clinic names...\n');

  const { count, error } = await supabase
    .from('google_reviews')
    .delete({ count: 'exact' })
    .eq('clinic_name', 'Unknown Clinic');

  if (error) {
    console.error('❌ Failed to delete legacy rows:', error.message);
    process.exit(1);
  }

  console.log(`✅ Deleted ${count ?? 0} rows where clinic_name = 'Unknown Clinic'.`);
  console.log('   Your dataset now only contains normalized clinic names.\n');
}

main().catch((err) => {
  console.error('Unexpected failure:', err);
  process.exit(1);
});

