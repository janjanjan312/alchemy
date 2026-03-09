import dotenv from 'dotenv';
dotenv.config();

const BASE = 'http://localhost:3000';

interface Result {
  id: number;
  title: string;
  content: string;
  score: number;
}

const TEST_QUERIES = [
  // 原型相关
  { query: 'What is the shadow archetype?', expect: 'Shadow concept' },
  { query: 'How does anima manifest in dreams?', expect: 'Anima/dreams' },
  { query: 'What is the Self in Jungian psychology?', expect: 'Self archetype' },
  { query: 'What is individuation process?', expect: 'Individuation' },

  // 炼金术隐喻
  { query: 'What is the meaning of nigredo in alchemy?', expect: 'Nigredo/blackening' },
  { query: 'How does alchemy relate to psychological transformation?', expect: 'Alchemy & psyche' },
  { query: 'What is the philosopher stone?', expect: 'Lapis/stone' },

  // 象征与梦境
  { query: 'What does the snake symbolize?', expect: 'Snake symbolism' },
  { query: 'What is the meaning of water in dreams?', expect: 'Water symbolism' },
  { query: 'What does the mandala represent?', expect: 'Mandala' },

  // 心理治疗
  { query: 'What is active imagination technique?', expect: 'Active imagination' },
  { query: 'How does transference work in analysis?', expect: 'Transference' },

  // 中文查询（测试跨语言能力）
  { query: '什么是集体无意识？', expect: 'Collective unconscious' },
  { query: '阴影原型如何影响日常生活？', expect: 'Shadow in life' },
];

async function testQuery(query: string, expect: string) {
  const url = `${BASE}/api/knowledge-search?q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetch(url);

  if (!res.ok) {
    console.log(`  ❌ HTTP ${res.status}`);
    return false;
  }

  const results: Result[] = await res.json();

  if (results.length === 0) {
    console.log(`  ❌ No results (expect: ${expect})`);
    return false;
  }

  const topScore = results[0].score;
  const icon = topScore >= 0.5 ? '✅' : topScore >= 0.3 ? '⚠️' : '❌';
  console.log(`  ${icon} Top score: ${topScore.toFixed(4)} | ${results.length} results (expect: ${expect})`);

  for (const r of results) {
    const preview = r.content.replace(/\n/g, ' ').slice(0, 120);
    console.log(`     [${r.score.toFixed(4)}] ${preview}...`);
  }

  return topScore >= 0.3;
}

async function main() {
  console.log('=== RAG 召回质量测试 ===\n');
  console.log(`Server: ${BASE}`);
  console.log(`Total queries: ${TEST_QUERIES.length}\n`);

  let passed = 0;

  for (const { query, expect } of TEST_QUERIES) {
    console.log(`\n🔍 "${query}"`);
    const ok = await testQuery(query, expect);
    if (ok) passed++;
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Results: ${passed}/${TEST_QUERIES.length} passed ===`);
  if (passed === TEST_QUERIES.length) {
    console.log('🎉 All tests passed!');
  } else {
    console.log(`⚠️  ${TEST_QUERIES.length - passed} queries had issues.`);
  }
}

main().catch(console.error);
