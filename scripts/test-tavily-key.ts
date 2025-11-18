/**
 * Test Tavily API key validity
 */

const API_KEY = "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";
const API_URL = "https://api.tavily.com/search";

async function testKey() {
  console.log("🔍 Testing Tavily API key...");
  console.log(`Key (first 10 chars): ${API_KEY.substring(0, 10)}...\n`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: API_KEY,
        query: "Neko Health health check clinics",
        search_depth: "basic",
        include_answer: true,
        max_results: 5,
      }),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("\n❌ API Key is INVALID or expired");
      console.error("Error response:", errorText.substring(0, 500));
      
      if (response.status === 401 || response.status === 403) {
        console.error("\n💡 This means:");
        console.error("   - The API key is invalid or expired");
        console.error("   - The API key was revoked");
        console.error("   - You need to generate a new key from Tavily");
      }
      return;
    }

    const data = await response.json();
    console.log("\n✅ API Key is VALID!");
    console.log("\n📊 Results:");
    console.log(`   Query: ${data.query}`);
    console.log(`   Response time: ${data.response_time}ms`);
    console.log(`   Results found: ${data.results?.length || 0}`);
    
    if (data.answer) {
      console.log(`\n📝 AI Answer (first 200 chars):`);
      console.log(`   ${data.answer.substring(0, 200)}...`);
    }
    
    if (data.results && data.results.length > 0) {
      console.log(`\n🔗 Top 3 Sources:`);
      data.results.slice(0, 3).forEach((r: any, idx: number) => {
        console.log(`   ${idx + 1}. ${r.title || 'Untitled'}`);
        console.log(`      ${r.url}`);
      });
    }
    
    console.log("\n✅ Tavily API is working perfectly!");
  } catch (error) {
    console.error("\n❌ Network/Request error:", error);
  }
}

testKey();

