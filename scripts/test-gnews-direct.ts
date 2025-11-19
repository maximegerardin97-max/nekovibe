/**
 * Direct test of GNews API to see what we can actually get
 */

const API_KEY = 'b0cc55435b272a69da7917abf5511641';
const API_URL = 'https://gnews.io/api/v4';

async function testGNews() {
  console.log('🧪 Testing GNews API directly...\n');

  // Test 1: No date filter (should get articles in 12h-30d window)
  console.log('Test 1: No date filter (comprehensive)');
  const url1 = `${API_URL}/search?q=Neko+Health&token=${API_KEY}&max=10&lang=en&sortby=publishedAt`;
  console.log(`URL: ${url1.replace(API_KEY, '***')}\n`);
  
  try {
    const res1 = await fetch(url1);
    const data1 = await res1.json();
    console.log(`Status: ${res1.status}`);
    console.log(`Total articles: ${data1.totalArticles || 0}`);
    console.log(`Articles returned: ${data1.articles?.length || 0}`);
    if (data1.articles && data1.articles.length > 0) {
      console.log(`\n✅ SUCCESS! First article:`);
      console.log(`   Title: ${data1.articles[0].title}`);
      console.log(`   Source: ${data1.articles[0].source?.name}`);
      console.log(`   Published: ${data1.articles[0].publishedAt}`);
      console.log(`   URL: ${data1.articles[0].url}`);
    } else {
      console.log(`\n⚠️  No articles in response`);
      if (data1.information) {
        console.log(`   Info:`, JSON.stringify(data1.information, null, 2));
      }
      if (data1.articlesRemovedFromResponse) {
        console.log(`   Removed:`, JSON.stringify(data1.articlesRemovedFromResponse, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n\n---\n\n');

  // Test 2: With 7-day filter
  console.log('Test 2: With 7-day filter');
  const url2 = `${API_URL}/search?q=Neko+Health&token=${API_KEY}&max=10&lang=en&sortby=publishedAt&in=7d`;
  console.log(`URL: ${url2.replace(API_KEY, '***')}\n`);
  
  try {
    const res2 = await fetch(url2);
    const data2 = await res2.json();
    console.log(`Status: ${res2.status}`);
    console.log(`Total articles: ${data2.totalArticles || 0}`);
    console.log(`Articles returned: ${data2.articles?.length || 0}`);
    if (data2.articles && data2.articles.length > 0) {
      console.log(`\n✅ SUCCESS! First article:`);
      console.log(`   Title: ${data2.articles[0].title}`);
      console.log(`   Source: ${data2.articles[0].source?.name}`);
      console.log(`   Published: ${data2.articles[0].publishedAt}`);
    } else {
      console.log(`\n⚠️  No articles in response`);
      if (data2.information) {
        console.log(`   Info:`, JSON.stringify(data2.information, null, 2));
      }
      if (data2.articlesRemovedFromResponse) {
        console.log(`   Removed:`, JSON.stringify(data2.articlesRemovedFromResponse, null, 2));
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('\n\n---\n\n');

  // Test 3: Try different query terms
  console.log('Test 3: Different query - "health check clinic"');
  const url3 = `${API_URL}/search?q=health+check+clinic&token=${API_KEY}&max=10&lang=en&sortby=publishedAt`;
  console.log(`URL: ${url3.replace(API_KEY, '***')}\n`);
  
  try {
    const res3 = await fetch(url3);
    const data3 = await res3.json();
    console.log(`Status: ${res3.status}`);
    console.log(`Total articles: ${data3.totalArticles || 0}`);
    console.log(`Articles returned: ${data3.articles?.length || 0}`);
    if (data3.articles && data3.articles.length > 0) {
      console.log(`\n✅ Found articles! First one:`);
      console.log(`   Title: ${data3.articles[0].title}`);
      console.log(`   Source: ${data3.articles[0].source?.name}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testGNews();

