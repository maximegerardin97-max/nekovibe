-- Run this directly in Supabase SQL Editor
-- This will call the edge function to generate all summaries

-- First, enable the http extension if not already enabled
CREATE EXTENSION IF NOT EXISTS http;

-- Function to generate summaries
CREATE OR REPLACE FUNCTION generate_all_summaries()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response http_response;
  supabase_url text;
  service_role_key text;
  function_url text;
BEGIN
  -- Get your project URL and service role key
  -- Replace these with your actual values
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);
  
  -- If not set, use these defaults (REPLACE WITH YOUR VALUES)
  IF supabase_url IS NULL THEN
    supabase_url := 'https://cqlopsqqqzzkfpmcntbv.supabase.co';
  END IF;
  
  IF service_role_key IS NULL THEN
    -- You need to set this - get it from Settings -> API -> service_role key
    RAISE EXCEPTION 'Please set service_role_key. Run: SET app.settings.service_role_key = ''your-key-here'';';
  END IF;
  
  function_url := supabase_url || '/functions/v1/generate-summaries';
  
  SELECT * INTO response
  FROM http_post(
    function_url,
    jsonb_build_object(),
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    )
  );
  
  RETURN response.content::jsonb;
END;
$$;

-- Set your service role key (REPLACE WITH YOUR ACTUAL KEY)
-- Get it from: Supabase Dashboard -> Settings -> API -> service_role key
SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';

-- Now run this to generate summaries:
SELECT generate_all_summaries();

