-- STEP 1: Clean all summaries
TRUNCATE TABLE feedback_summaries;

-- STEP 2: Check what clinic names actually exist
SELECT DISTINCT clinic_id, COUNT(*) as item_count
FROM feedback_items
GROUP BY clinic_id
ORDER BY clinic_id;

