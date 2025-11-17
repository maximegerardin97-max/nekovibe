-- Fix the duplicate Stockholm clinic names
-- Merge "Neko Health Östermalmstorg" into "Neko Health Ostermalmstorg"

UPDATE feedback_items
SET clinic_id = 'Neko Health Ostermalmstorg'
WHERE clinic_id = 'Neko Health Östermalmstorg';

-- Verify the fix
SELECT 
  clinic_id,
  COUNT(*) as count
FROM feedback_items
WHERE clinic_id LIKE '%Ostermalm%' OR clinic_id LIKE '%Östermalm%'
GROUP BY clinic_id;

-- Should now show only "Neko Health Ostermalmstorg"

