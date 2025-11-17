-- Run this to check if Stockholm data exists in feedback_items
SELECT 
  clinic_id,
  source_type,
  COUNT(*) as count
FROM feedback_items
WHERE clinic_id LIKE '%Ostermalm%' OR clinic_id LIKE '%Stockholm%'
GROUP BY clinic_id, source_type
ORDER BY clinic_id, source_type;

-- Check all unique clinic names
SELECT DISTINCT clinic_id
FROM feedback_items
ORDER BY clinic_id;

