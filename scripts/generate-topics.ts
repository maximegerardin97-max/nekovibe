import { config } from "dotenv";
config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function generateTopics() {
  console.log("Generating review topics via edge function...");

  const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-topics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Failed to generate topics:", err);
    process.exit(1);
  }

  const result = await response.json() as any;

  if (result.error) {
    console.error("Error from edge function:", result.error);
    process.exit(1);
  }

  console.log(`✅ Topics generated: ${result.topics_generated} | Upserted: ${result.topics_upserted}`);
  console.log(`   Reviews analyzed: ${result.reviews_analyzed}`);

  if (result.topics) {
    console.log("\nTop topics:");
    (result.topics as any[]).forEach((t) => {
      const icon = t.sentiment === "positive" ? "✅" : t.sentiment === "negative" ? "❌" : "⚪";
      console.log(`  ${icon} ${t.name} (${t.review_count} reviews)`);
    });
  }
}

generateTopics().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
