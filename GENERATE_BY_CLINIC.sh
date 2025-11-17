#!/bin/bash

# Generate summaries for each clinic one at a time to avoid timeout

SERVICE_KEY="REDACTED_SERVICE_ROLE_KEY"
BASE_URL="https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/generate-summaries"

CLINICS=(
  "Neko Health Covent Garden"
  "Neko Health Lincoln Square"
  "Neko Health Manchester"
  "Neko Health Marylebone"
  "Neko Health Ostermalmstorg"
  "Neko Health Spitalfields"
)

echo "🚀 Starting summary generation for ${#CLINICS[@]} clinics..."

# First generate global summaries (skip clinics)
echo "📊 Generating global summaries..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d '{"skip_global": false, "clinic_only": null}' \
  | jq '.message, .total'

# Then process each clinic
for clinic in "${CLINICS[@]}"; do
  echo ""
  echo "🏥 Processing: $clinic"
  curl -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -d "{\"skip_global\": true, \"clinic_only\": \"$clinic\"}" \
    | jq '.message, .processed_clinics, .total_clinics'
  
  echo "✅ Done with $clinic"
  sleep 2  # Small delay between clinics
done

echo ""
echo "✨ All done! Check feedback_summaries table."

