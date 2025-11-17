#!/bin/bash

# Generate summaries for ONE clinic (use this if the full script times out)

SERVICE_KEY="REDACTED_SERVICE_ROLE_KEY"
BASE_URL="https://cqlopsqqqzzkfpmcntbv.supabase.co/functions/v1/generate-summaries"

# Replace with the clinic you want to process
CLINIC="${1:-Neko Health Ostermalmstorg}"

echo "🏥 Processing: $CLINIC"

curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d "{\"skip_global\": true, \"clinic_only\": \"$CLINIC\"}"

echo ""
echo "✅ Done!"

