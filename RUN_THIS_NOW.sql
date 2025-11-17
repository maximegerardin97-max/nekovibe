-- COPY AND PASTE THIS ENTIRE BLOCK INTO SUPABASE SQL EDITOR
-- Replace YOUR_SERVICE_ROLE_KEY with your actual service role key from Settings -> API

DO $$
DECLARE
  response_text text;
BEGIN
  -- This calls your edge function directly
  SELECT content INTO response_text
  FROM http((
    'POST',
    'https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/generate-summaries',
    ARRAY[
      http_header('Content-Type', 'application/json'),
      http_header('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY')
    ],
    'application/json',
    '{}'
  )::http_request);
  
  RAISE NOTICE 'Response: %', response_text;
END $$;

