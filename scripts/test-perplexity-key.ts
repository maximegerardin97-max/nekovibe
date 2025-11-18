/**
 * Test Perplexity API key validity
 */

const API_KEY = "pplx-6aH28T3YroS3c4ow3ai7Mmm2BHE2ITA4qJH9UsAwID1degy";
const API_URL = "https://api.perplexity.ai/chat/completions";

async function testKey() {
  console.log("🔍 Testing Perplexity API key...");
  console.log(`Key (first 10 chars): ${API_KEY.substring(0, 10)}...\n`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-sonar-large-128k-online",
        messages: [
          {
            role: "user",
            content: "Say 'API key is valid' if you can read this.",
          },
        ],
        max_tokens: 50,
      }),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("\n❌ API Key is INVALID or expired");
      console.error("Error response:", errorText.substring(0, 500));
      
      if (response.status === 401) {
        console.error("\n💡 This means:");
        console.error("   - The API key is invalid or expired");
        console.error("   - The API key was revoked");
        console.error("   - You need to generate a new key from Perplexity");
      }
      return;
    }

    const data = await response.json();
    console.log("\n✅ API Key is VALID!");
    console.log("Response:", data.choices?.[0]?.message?.content || "No content");
    console.log("\nModel used:", data.model);
    console.log("Tokens used:", data.usage?.total_tokens || "unknown");
  } catch (error) {
    console.error("\n❌ Network/Request error:", error);
  }
}

testKey();

