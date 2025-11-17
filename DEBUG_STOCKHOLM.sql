-- Check exact clinic name for Stockholm
SELECT DISTINCT clinic_id 
FROM feedback_items 
WHERE clinic_id LIKE '%Ostermalm%' OR clinic_id LIKE '%Stockholm%' OR clinic_id LIKE '%ostermalm%'
ORDER BY clinic_id;

-- Check item count for Stockholm
SELECT 
  clinic_id,
  source_type,
  COUNT(*) as count
FROM feedback_items
WHERE clinic_id LIKE '%Ostermalm%' OR clinic_id LIKE '%Stockholm%' OR clinic_id LIKE '%ostermalm%'
GROUP BY clinic_id, source_type;

-- Check all clinic names exactly as they appear
SELECT DISTINCT clinic_id, COUNT(*) as item_count
FROM feedback_items
GROUP BY clinic_id
ORDER BY clinic_id;

