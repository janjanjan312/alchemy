import dotenv from 'dotenv';
dotenv.config();

const BASE = 'http://localhost:3000';

const SYSTEM_PROMPT = `你是炼金术师 (The Alchemy)，一位温暖的荣格分析师，专注内心世界。

对话风格：
- 每次回复 80-120 字，口语化、直击核心
- 引导探索，不给结论。用"你注意到...？"代替"你应该..."
- 每次回复包含 1-2 个开放式提问
- 使用深邃、共情、略带诗意的语气
- 自然引用荣格概念（阴影、人格面具、阿尼玛/阿尼姆斯、集体无意识）
- 始终返回自然对话文本，绝不返回 JSON 格式`;

interface KnowledgeChunk {
  id: number;
  title: string;
  content: string;
  score: number;
}

const TEST_CASES = [
  '我最近总是梦见蛇，这代表什么？',
  '什么是阴影？我该怎么面对它？',
  '荣格说的个体化过程是怎么回事？',
  '炼金术和心理转化有什么关系？',
  '我总觉得我伴侣身上有我讨厌的特质，这是投射吗？',
  '曼陀罗在荣格心理学中有什么意义？',
];

async function searchKnowledge(query: string): Promise<KnowledgeChunk[]> {
  const res = await fetch(`${BASE}/api/knowledge-search?q=${encodeURIComponent(query)}&limit=3`);
  if (!res.ok) return [];
  return res.json();
}

async function chatWithAI(userQuery: string, knowledgeChunks: KnowledgeChunk[]): Promise<string> {
  let systemPrompt = SYSTEM_PROMPT;

  if (knowledgeChunks.length > 0) {
    systemPrompt += `\n\n【专业知识参考】（以下是相关的荣格心理学背景知识，可自然融入回复中，不要原文照搬）\n${knowledgeChunks.map((c, i) => `${i + 1}. [${c.title}] ${c.content}`).join('\n')}`;
  }

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuery },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '(empty)';
}

function analyzeResponse(text: string) {
  const hasEnglish = /[a-zA-Z]{4,}/.test(text.replace(/\(.*?\)/g, '').replace(/[A-Z][a-z]*\/[A-Z][a-z]*/g, ''));
  const englishWords = text.match(/[a-zA-Z]{4,}/g) || [];
  const totalChars = text.length;

  // Filter out common Jungian terms that are acceptable in English
  const acceptableTerms = new Set([
    'Psyche', 'Jung', 'Anima', 'Animus', 'Persona', 'Shadow', 'Self',
    'Ego', 'INSIGHT', 'type', 'content', 'Active', 'Imagination',
    'Projection', 'Individuation', 'Mandala', 'Nigredo', 'Albedo', 'Rubedo',
  ]);
  const unexpectedEnglish = englishWords.filter(w => !acceptableTerms.has(w));

  return {
    length: totalChars,
    hasUnexpectedEnglish: unexpectedEnglish.length > 3,
    unexpectedEnglish,
    englishRatio: unexpectedEnglish.join('').length / totalChars,
  };
}

async function main() {
  console.log('=== RAG 端到端测试（中文查询 → AI 中文回复） ===\n');

  for (let i = 0; i < TEST_CASES.length; i++) {
    const query = TEST_CASES[i];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 [${i + 1}/${TEST_CASES.length}] "${query}"`);
    console.log('='.repeat(60));

    // Step 1: RAG retrieval
    const chunks = await searchKnowledge(query);
    console.log(`\n📚 召回 ${chunks.length} 个 chunk:`);
    for (const c of chunks) {
      const preview = c.content.replace(/\n/g, ' ').slice(0, 80);
      console.log(`   [${c.score.toFixed(4)}] ${preview}...`);
    }

    // Step 2: AI response
    console.log('\n💬 AI 回复:');
    try {
      const reply = await chatWithAI(query, chunks);
      console.log(`\n${reply}\n`);

      // Step 3: Analyze
      const analysis = analyzeResponse(reply);
      console.log(`📊 分析:`);
      console.log(`   回复长度: ${analysis.length} 字`);
      if (analysis.hasUnexpectedEnglish) {
        console.log(`   ⚠️  包含较多英文: ${analysis.unexpectedEnglish.slice(0, 10).join(', ')}`);
        console.log(`   英文占比: ${(analysis.englishRatio * 100).toFixed(1)}%`);
      } else {
        console.log(`   ✅ 回复基本为中文`);
      }
    } catch (err: any) {
      console.log(`   ❌ 错误: ${err.message}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('测试完成');
}

main().catch(console.error);
