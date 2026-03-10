import express from 'express';
import { WebSocket } from 'ws';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun, initSchema } from './lib/db';
import { embedTexts, bufferToEmbedding, normalizeVector, dotProduct } from './src/server/embedding';

dotenv.config();

export const app = express();
app.use(express.json({ limit: '10mb' }));

let _schemaReady = false;
let _schemaPromise: Promise<void> | null = null;

export async function ensureSchema() {
  if (_schemaReady) return;
  if (!_schemaPromise) _schemaPromise = initSchema();
  await _schemaPromise;
  _schemaReady = true;
}

const DB_FREE_ROUTES = new Set(['/api/chat', '/api/transcribe']);

app.use(async (req, _res, next) => {
  if (DB_FREE_ROUTES.has(req.path)) return next();
  try {
    await ensureSchema();
    next();
  } catch (err) {
    console.error('[DB] Schema init failed:', err);
    next(err);
  }
});

// --- ASR: HTTP batch transcription ---

const ASR_MODEL = process.env.ASR_MODEL || 'qwen3-asr-flash-realtime';
const ASR_WS_URL = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${ASR_MODEL}`;

function transcribePCM(pcmBase64: string, language: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.DASHSCOPE_API_KEY || '';
    if (!apiKey) { reject(new Error('DASHSCOPE_API_KEY not configured')); return; }
    const texts: string[] = [];
    const audioBytes = pcmBase64.length * 3 / 4;
    const audioDurationSec = audioBytes / 2 / 16000;
    const timeoutMs = Math.max(15000, audioDurationSec * 3000 + 10000);
    const ws = new WebSocket(ASR_WS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Beta': 'realtime=v1' },
    });
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeoutMs);
    let resolved = false;
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: { modalities: ['text'], input_audio_format: 'pcm', sample_rate: 16000, input_audio_transcription: { language }, turn_detection: null },
      }));
      const chunk = 64000;
      for (let i = 0; i < pcmBase64.length; i += chunk) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmBase64.slice(i, i + chunk) }));
      }
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'session.finish' }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'conversation.item.input_audio_transcription.completed') {
        const t = msg.transcript || '';
        if (t) texts.push(t);
      }
      if (msg.type === 'session.finished' && !resolved) {
        resolved = true; clearTimeout(timeout); ws.close(); resolve(texts.join(''));
      }
      if (msg.type === 'error' && !resolved) {
        resolved = true; clearTimeout(timeout); ws.close(); reject(new Error(msg.error?.message || 'DashScope error'));
      }
    });
    ws.on('close', () => { if (!resolved) { resolved = true; clearTimeout(timeout); resolve(texts.join('')); } });
    ws.on('error', (err) => { if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); } });
  });
}

app.post('/api/transcribe', async (req, res) => {
  const { audio, language = 'zh' } = req.body;
  if (!audio) { res.status(400).json({ error: 'No audio data' }); return; }
  try {
    const text = await transcribePCM(audio, language);
    res.json({ text });
  } catch (e: any) {
    console.error('[transcribe] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Chat proxy to ARK API ---

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.VITE_ARK_TEXT_MODEL || 'deepseek-v3-250324';
  const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

  if (!apiKey) { res.status(500).json({ error: 'ARK_API_KEY not configured' }); return; }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: req.body.messages, max_tokens: req.body.max_tokens || 200 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: errorText });
      return;
    }
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('ARK API error:', error.message);
    res.status(502).json({ error: 'Failed to reach ARK API' });
  }
});

// --- Profile ---

app.get('/api/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  const archetypes = await dbAll('SELECT * FROM archetype_data WHERE user_id = ?', userId);
  const symbols = await dbAll('SELECT * FROM symbols WHERE user_id = ?', userId);
  res.json({ archetypes, symbols });
});

// --- Session & Chat History ---

const MAX_SESSIONS_TOTAL = 10;

async function cleanupOldSessions(userId: string) {
  const empty = await dbAll(
    `SELECT s.id FROM sessions s WHERE s.user_id = ? AND NOT EXISTS (SELECT 1 FROM chat_history c WHERE c.session_id = s.id AND c.role = 'user')`,
    userId
  );
  for (const s of empty) {
    await dbRun('DELETE FROM chat_history WHERE session_id = ?', s.id);
    await dbRun('DELETE FROM sessions WHERE id = ?', s.id);
  }
  const stale = await dbAll(
    'SELECT id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET ?',
    userId, MAX_SESSIONS_TOTAL
  );
  for (const s of stale) {
    await dbRun('DELETE FROM chat_history WHERE session_id = ?', s.id);
    await dbRun('DELETE FROM sessions WHERE id = ?', s.id);
  }
}

app.get('/api/sessions/:userId', async (req, res) => {
  const { userId } = req.params;
  const mode = req.query.mode as string | undefined;
  const sessions = mode
    ? await dbAll('SELECT * FROM sessions WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC', userId, mode)
    : await dbAll('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC', userId);
  for (const s of sessions) {
    const first = await dbGet(
      "SELECT content FROM chat_history WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1", s.id
    );
    s.preview = first?.content?.slice(0, 50) || null;
  }
  cleanupOldSessions(userId).catch(() => {});
  res.json(sessions);
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await dbRun('DELETE FROM chat_history WHERE session_id = ?', sessionId);
  await dbRun('DELETE FROM sessions WHERE id = ?', sessionId);
  res.json({ success: true });
});

app.post('/api/sessions', async (req, res) => {
  const { userId, mode } = req.body;
  const id = randomUUID();
  await dbRun('INSERT INTO sessions (id, user_id, mode) VALUES (?, ?, ?)', id, userId, mode);
  res.json({ id, userId, mode });
});

app.get('/api/sessions/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const messages = await dbAll(
    'SELECT role, content, mode, timestamp, insight_type, insight_content, extras FROM chat_history WHERE session_id = ? ORDER BY id ASC',
    sessionId
  );
  res.json(messages);
});

app.post('/api/sessions/:sessionId/messages', async (req, res) => {
  const { sessionId } = req.params;
  const { userId, role, content, mode, insightType, insightContent, extras } = req.body;
  await dbRun(
    'INSERT INTO chat_history (session_id, user_id, role, content, mode, insight_type, insight_content, extras) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sessionId, userId, role, content, mode, insightType || null, insightContent || null, extras || null
  );
  await dbRun('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', sessionId);
  res.json({ success: true });
});

// --- Symbol Dictionary ---

app.get('/api/symbols/:userId', async (req, res) => {
  const symbols = await dbAll('SELECT term, meaning FROM symbols WHERE user_id = ?', req.params.userId);
  res.json(symbols);
});

app.post('/api/symbols', async (req, res) => {
  const { userId, term, meaning } = req.body;
  await dbRun(
    'INSERT INTO symbols (user_id, term, meaning) VALUES (?, ?, ?) ON CONFLICT(user_id, term) DO UPDATE SET meaning = excluded.meaning',
    userId, term, meaning
  );
  res.json({ success: true });
});

app.delete('/api/symbols/:userId/:term', async (req, res) => {
  await dbRun('DELETE FROM symbols WHERE user_id = ? AND term = ?', req.params.userId, req.params.term);
  res.json({ success: true });
});

// --- Projection Tracking ---

app.get('/api/projections/:userId', async (req, res) => {
  const { userId } = req.params;
  const status = req.query.status as string | undefined;
  const rows = status
    ? await dbAll('SELECT * FROM projections WHERE user_id = ? AND status = ? ORDER BY updated_at DESC', userId, status)
    : await dbAll('SELECT * FROM projections WHERE user_id = ? ORDER BY updated_at DESC', userId);
  res.json(rows);
});

app.post('/api/projections', async (req, res) => {
  const { userId, target, trait, archetypeId } = req.body;
  const result = await dbRun(
    'INSERT INTO projections (user_id, target, trait, archetype_id) VALUES (?, ?, ?, ?)',
    userId, target, trait, archetypeId || null
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/projections/:id', async (req, res) => {
  await dbRun('UPDATE projections SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', req.body.status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/projections/:id', async (req, res) => {
  await dbRun('DELETE FROM projections WHERE id = ?', req.params.id);
  res.json({ success: true });
});

// --- Long-term Memory (Session Summaries) ---

const MAX_SUMMARIES_PER_USER = 20;

async function cleanupOldSummaries(userId: string) {
  await dbRun(
    'DELETE FROM session_summaries WHERE user_id = ? AND id NOT IN (SELECT id FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)',
    userId, userId, MAX_SUMMARIES_PER_USER
  );
}

const PROFILE_UPDATE_INTERVAL = 5;

const SUMMARIZE_PROMPT = `你是一位荣格分析师的记录助手。请将以下对话总结为一段简洁的心理探索摘要（50-80字）。
要求：
- 提炼核心主题和情感
- 记录任何洞察、突破或识别到的模式
- 使用第三人称（"用户"）
- 不要包含问候语或对话细节
- 只输出摘要文本，不要加标题或标签`;

const PROFILE_MERGE_PROMPT = `你是一位荣格分析心理学专家。请根据用户的现有画像和最新的对话摘要，更新用户画像。

严格按以下 4 个维度输出 JSON（每个维度 15-30 字，如果信息不足则保留原内容）：
{
  "core_patterns": "核心心理模式：反复出现的情结、防御机制、人际关系模式",
  "shadow_themes": "阴影主题：被压抑的特质、回避的议题、未整合的面向",
  "recurring_symbols": "反复出现的象征/意象及其个人含义",
  "growth_trajectory": "成长轨迹：已取得的突破、正在发展的觉察、当前所处阶段"
}

只输出 JSON，不要加任何说明文字。`;

async function updateUserProfile(userId: string) {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.VITE_ARK_TEXT_MODEL || 'deepseek-v3-250324';
  if (!apiKey) return;

  const profile = await dbGet('SELECT * FROM user_profiles WHERE user_id = ?', userId);
  const recentSummaries = await dbAll(
    'SELECT summary, mode, created_at FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    userId, PROFILE_UPDATE_INTERVAL
  );
  if (recentSummaries.length === 0) return;

  const currentProfile = profile
    ? `当前画像：\n- 核心模式：${profile.core_patterns || '暂无'}\n- 阴影主题：${profile.shadow_themes || '暂无'}\n- 反复象征：${profile.recurring_symbols || '暂无'}\n- 成长轨迹：${profile.growth_trajectory || '暂无'}`
    : '当前画像：首次生成，所有维度为空';
  const summaryBlock = recentSummaries.map((s: any, i: number) => `${i + 1}. [${s.mode}] ${s.summary}`).join('\n');

  try {
    const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PROFILE_MERGE_PROMPT },
          { role: 'user', content: `${currentProfile}\n\n最近的对话摘要：\n${summaryBlock}` },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return;
    const data = await r.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    await dbRun(
      `INSERT INTO user_profiles (user_id, core_patterns, shadow_themes, recurring_symbols, growth_trajectory, summary_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         core_patterns = excluded.core_patterns, shadow_themes = excluded.shadow_themes,
         recurring_symbols = excluded.recurring_symbols, growth_trajectory = excluded.growth_trajectory,
         summary_count = excluded.summary_count, updated_at = CURRENT_TIMESTAMP`,
      userId, parsed.core_patterns || '', parsed.shadow_themes || '',
      parsed.recurring_symbols || '', parsed.growth_trajectory || '',
      (profile?.summary_count || 0) + recentSummaries.length
    );
  } catch (e) {
    console.error('Profile update failed:', e);
  }
}

async function generateSummary(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.VITE_ARK_TEXT_MODEL || 'deepseek-v3-250324';
  if (!apiKey || messages.length < 2) return '';

  const dialogue = messages
    .filter(m => m.role === 'user' || m.role === 'model')
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
    .join('\n');

  try {
    const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SUMMARIZE_PROMPT },
          { role: 'user', content: dialogue },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return '';
    const data = await r.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch { return ''; }
}

app.post('/api/sessions/:sessionId/summarize', async (req, res) => {
  const { sessionId } = req.params;

  const existing = await dbGet('SELECT id FROM session_summaries WHERE session_id = ?', sessionId);
  if (existing) { res.json({ success: true, skipped: true }); return; }

  const session = await dbGet('SELECT user_id, mode FROM sessions WHERE id = ?', sessionId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const msgs = await dbAll(
    "SELECT role, content FROM chat_history WHERE session_id = ? AND role IN ('user', 'model') ORDER BY id ASC",
    sessionId
  );
  const userMsgCount = msgs.filter((m: any) => m.role === 'user').length;
  if (userMsgCount < 2) { res.json({ success: true, skipped: true, reason: 'too_short' }); return; }

  const summary = await generateSummary(msgs as any[]);
  if (!summary) { res.status(500).json({ error: 'Summary generation failed' }); return; }

  await dbRun(
    'INSERT OR IGNORE INTO session_summaries (session_id, user_id, mode, summary) VALUES (?, ?, ?, ?)',
    sessionId, session.user_id, session.mode, summary
  );
  await cleanupOldSummaries(session.user_id);

  const totalRow = await dbGet('SELECT COUNT(*) as cnt FROM session_summaries WHERE user_id = ?', session.user_id);
  const profileRow = await dbGet('SELECT summary_count FROM user_profiles WHERE user_id = ?', session.user_id);
  const totalSummaries = totalRow?.cnt || 0;
  const lastUpdateCount = profileRow?.summary_count || 0;

  if (totalSummaries - lastUpdateCount >= PROFILE_UPDATE_INTERVAL) {
    updateUserProfile(session.user_id).catch(() => {});
  }

  res.json({ success: true, summary });
});

app.get('/api/summaries/:userId', async (req, res) => {
  const { userId } = req.params;
  const mode = req.query.mode as string | undefined;
  const limit = parseInt(req.query.limit as string) || 5;
  const summaries = mode
    ? await dbAll('SELECT session_id, mode, summary, created_at FROM session_summaries WHERE user_id = ? AND mode = ? ORDER BY created_at DESC LIMIT ?', userId, mode, limit)
    : await dbAll('SELECT session_id, mode, summary, created_at FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit);
  res.json(summaries);
});

app.get('/api/user-profile/:userId', async (req, res) => {
  const profile = await dbGet(
    'SELECT core_patterns, shadow_themes, recurring_symbols, growth_trajectory, updated_at FROM user_profiles WHERE user_id = ?',
    req.params.userId
  );
  res.json(profile || null);
});

// --- Archetype Context ---

app.get('/api/archetype-context/:userId/:archetypeId', async (req, res) => {
  const { userId, archetypeId } = req.params;

  const archetypeData = await dbGet(
    'SELECT personal_manifestation, integration_score, guidance FROM archetype_data WHERE user_id = ? AND archetype_id = ?',
    userId, archetypeId
  );
  const relatedProjections = await dbAll(
    'SELECT target, trait, status FROM projections WHERE user_id = ? AND archetype_id = ? ORDER BY updated_at DESC LIMIT 5',
    userId, archetypeId
  );
  const symbols = await dbAll('SELECT term, meaning FROM symbols WHERE user_id = ?', userId);
  const profile = await dbGet(
    'SELECT core_patterns, shadow_themes, recurring_symbols, growth_trajectory FROM user_profiles WHERE user_id = ?',
    userId
  );
  const recentSummaries = await dbAll(
    'SELECT summary, mode FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT 3',
    userId
  );

  res.json({
    archetype: archetypeData || null,
    projections: relatedProjections,
    symbols,
    profile: profile || null,
    recentSummaries,
  });
});

// --- Knowledge RAG Search ---

let knowledgeCache: { id: number; title: string; content: string }[] | null = null;
let embeddingMatrix: Float32Array | null = null;
let embeddingDim = 0;
let chunkWordSets: Set<string>[] = [];
let kwDfCache = new Map<string, number>();
let _knowledgePromise: Promise<void> | null = null;

function buildWordIndex() {
  chunkWordSets = knowledgeCache!.map(c => {
    const words = c.content.toLowerCase().match(/[a-z]{3,}/g) || [];
    return new Set(words);
  });
  kwDfCache.clear();
}

function getKeywordDf(keyword: string): number {
  if (kwDfCache.has(keyword)) return kwDfCache.get(keyword)!;
  let count = 0;
  for (const wordSet of chunkWordSets) { if (wordSet.has(keyword)) count++; }
  kwDfCache.set(keyword, count);
  return count;
}

function keywordBoostByIndex(chunkIdx: number, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const wordSet = chunkWordSets[chunkIdx];
  if (!wordSet) return 0;
  const totalDocs = knowledgeCache!.length || 1;
  let totalWeight = 0, matchedWeight = 0;
  for (const kw of keywords) {
    const df = getKeywordDf(kw);
    const idf = Math.log(totalDocs / (df + 1));
    totalWeight += idf;
    if (wordSet.has(kw)) matchedWeight += idf;
  }
  if (totalWeight === 0) return 0;
  return (matchedWeight / totalWeight) * 0.12;
}

export async function loadKnowledgeCache() {
  const rows = await dbAll('SELECT id, title, content, embedding FROM knowledge_chunks');
  knowledgeCache = rows.map((r: any) => ({ id: r.id, title: r.title || '', content: r.content }));

  if (rows.length > 0) {
    const firstVec = bufferToEmbedding(rows[0].embedding);
    embeddingDim = firstVec.length;
    embeddingMatrix = new Float32Array(rows.length * embeddingDim);
    for (let i = 0; i < rows.length; i++) {
      const vec = normalizeVector(bufferToEmbedding(rows[i].embedding));
      embeddingMatrix.set(vec, i * embeddingDim);
    }
  }
  console.log(`Knowledge cache loaded: ${knowledgeCache.length} chunks (${embeddingDim}d matrix)`);
  buildWordIndex();
  console.log(`Word index built: ${chunkWordSets.length} sets`);
}

async function ensureKnowledgeCache() {
  if (knowledgeCache) return;
  if (!_knowledgePromise) _knowledgePromise = loadKnowledgeCache();
  return _knowledgePromise;
}

// --- Query-time Caches ---
const _embedCache = new Map<string, { vec: Float32Array; ts: number }>();
const _transCache = new Map<string, { result: string | null; ts: number }>();
const QUERY_CACHE_MAX = 200;
const EMBED_CACHE_TTL = 10 * 60 * 1000;
const TRANS_CACHE_TTL = 30 * 60 * 1000;

async function cachedEmbedQuery(text: string): Promise<Float32Array> {
  const entry = _embedCache.get(text);
  if (entry && Date.now() - entry.ts < EMBED_CACHE_TTL) return entry.vec;
  const [raw] = await embedTexts([text]);
  const vec = normalizeVector(raw);
  if (_embedCache.size >= QUERY_CACHE_MAX) _embedCache.delete(_embedCache.keys().next().value!);
  _embedCache.set(text, { vec, ts: Date.now() });
  return vec;
}

async function cachedTranslate(query: string): Promise<string | null> {
  const entry = _transCache.get(query);
  if (entry && Date.now() - entry.ts < TRANS_CACHE_TTL) return entry.result;
  const result = await translateQueryToEnglish(query);
  if (_transCache.size >= QUERY_CACHE_MAX) _transCache.delete(_transCache.keys().next().value!);
  _transCache.set(query, { result, ts: Date.now() });
  return result;
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

async function translateQueryToEnglish(query: string): Promise<string | null> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.VITE_ARK_TEXT_MODEL || 'deepseek-v3-250324';
  if (!apiKey) return null;
  try {
    const r = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Translate the Chinese text to English in ONE short sentence (max 15 words). Use Jungian terms: shadow, anima/animus, persona, Self, individuation, projection, transference, collective unconscious, archetype, active imagination, complex, mandala, nigredo, albedo, rubedo. Output ONLY the translation.' },
          { role: 'user', content: query },
        ],
        max_tokens: 60,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    let result = data.choices?.[0]?.message?.content?.trim() || null;
    if (result) {
      result = result.split(/\n/)[0].trim();
      if (result.length > 10 && !result.endsWith('?') && !result.endsWith('.') && !result.endsWith('!')) {
        const lastPunct = Math.max(result.lastIndexOf('?'), result.lastIndexOf('.'), result.lastIndexOf('!'));
        if (lastPunct > 10) result = result.slice(0, lastPunct + 1);
      }
      console.log(`[RAG] Translated: "${query.slice(0, 40)}" → "${result}"`);
    }
    return result;
  } catch (err: any) {
    console.log(`[RAG] Translation failed: ${err.message}`);
    return null;
  }
}

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
    'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same',
    'than', 'too', 'very', 'just', 'about', 'how', 'what', 'when', 'where',
    'why', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'it',
    'its', 'my', 'your', 'his', 'her', 'our', 'their', 'i', 'me', 'we',
    'you', 'he', 'she', 'they', 'them', 'myself', 'does', 'did', 'jung',
    'jungian', 'psychology', 'mean', 'means', 'meaning', 'understand',
    'interpretation', 'interpret', 'always', 'never',
  ]);
  const words = lower.match(/[a-z]{3,}/g) || [];
  return [...new Set(words.filter(w => !stopWords.has(w)))];
}

app.get('/api/knowledge-search', async (req, res) => {
  const query = req.query.q as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

  if (!query) { res.json([]); return; }
  await ensureKnowledgeCache();
  if (!knowledgeCache || knowledgeCache.length === 0) { res.json([]); return; }

  try {
    const t0 = Date.now();
    const isChinese = hasChinese(query);
    const embedCacheHit = _embedCache.has(query) && Date.now() - _embedCache.get(query)!.ts < EMBED_CACHE_TTL;
    const transCacheHit = isChinese && _transCache.has(query) && Date.now() - _transCache.get(query)!.ts < TRANS_CACHE_TTL;

    const [queryVec, translatedQuery] = await Promise.all([
      cachedEmbedQuery(query),
      isChinese ? cachedTranslate(query) : Promise.resolve(null),
    ]);
    const prepMs = Date.now() - t0;

    const t1 = Date.now();
    const allQueryText = [query, translatedQuery].filter(Boolean).join(' ');
    const keywords = extractKeywords(allQueryText);

    const numChunks = knowledgeCache!.length;
    const bestScores = new Float32Array(numChunks);
    const mat = embeddingMatrix!;
    const dim = embeddingDim;

    for (let i = 0; i < numChunks; i++) {
      const offset = i * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) { dot += queryVec[d] * mat[offset + d]; }
      bestScores[i] = dot;
    }
    const dotMs = Date.now() - t1;

    const t2 = Date.now();
    const topIndices: number[] = [];
    const tempScores = new Float32Array(bestScores);
    for (let k = 0; k < 100; k++) {
      let maxIdx = 0, maxVal = tempScores[0];
      for (let i = 1; i < numChunks; i++) {
        if (tempScores[i] > maxVal) { maxVal = tempScores[i]; maxIdx = i; }
      }
      topIndices.push(maxIdx);
      tempScores[maxIdx] = -1;
    }
    const sortMs = Date.now() - t2;

    const scored = topIndices.map(i => {
      const boost = keywordBoostByIndex(i, keywords);
      const cosine = bestScores[i];
      return { id: knowledgeCache![i].id, title: knowledgeCache![i].title, content: knowledgeCache![i].content, cosine, boost, score: cosine + boost };
    });
    scored.sort((a, b) => b.score - a.score);
    const searchMs = Date.now() - t1;

    const top10 = scored.slice(0, 10);
    const results = scored.slice(0, limit).filter(r => r.score > 0.3);

    const embedHit = embedCacheHit ? '(cached)' : '';
    const transHit = transCacheHit ? '(cached)' : '';
    console.log(`\n[RAG] Query: "${query.slice(0, 80)}${query.length > 80 ? '...' : ''}"`);
    console.log(`[RAG] Prep: ${prepMs}ms ${embedHit}${transHit} | Dot: ${dotMs}ms | Sort: ${sortMs}ms | Search: ${searchMs}ms | Total: ${prepMs + searchMs}ms`);
    if (translatedQuery) console.log(`[RAG] Translated: "${translatedQuery.slice(0, 80)}"`);
    if (keywords.length > 0) console.log(`[RAG] Keywords: [${keywords.slice(0, 10).join(', ')}]`);
    console.log(`[RAG] Top 10:`);
    for (const item of top10) {
      const src = (await dbGet('SELECT source_file FROM knowledge_chunks WHERE id = ?', item.id))?.source_file || '?';
      const shortSrc = src.replace(/\s*\(Collected Works.*$/, '').slice(0, 30);
      const preview = item.content.replace(/\n/g, ' ').slice(0, 100);
      const marker = item.score > 0.3 ? '✓' : '✗';
      const boostStr = item.boost > 0 ? ` +${item.boost.toFixed(3)}kw` : '';
      console.log(`  ${marker} [${item.score.toFixed(4)}${boostStr}] (${shortSrc}) ${preview}...`);
    }
    console.log(`[RAG] Returned: ${results.length}/${limit} (threshold > 0.3)\n`);

    res.json(results.map(r => ({ id: r.id, title: r.title, content: r.content, score: r.score })));
  } catch (error: any) {
    console.error('[RAG] Search error:', error.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/knowledge-reload', async (_req, res) => {
  _knowledgePromise = null;
  knowledgeCache = null;
  await loadKnowledgeCache();
  res.json({ success: true, count: knowledgeCache?.length || 0 });
});

// --- Archive Insight ---

app.post('/api/archive-insight', async (req, res) => {
  const { userId, archetypeId, content, guidance } = req.body;

  const existing = await dbGet(
    'SELECT personal_manifestation FROM archetype_data WHERE user_id = ? AND archetype_id = ?',
    userId, archetypeId
  );

  if (existing && existing.personal_manifestation.includes(content)) {
    if (guidance) {
      await dbRun(
        'UPDATE archetype_data SET seen = 0, updated_at = CURRENT_TIMESTAMP, guidance = ? WHERE user_id = ? AND archetype_id = ?',
        guidance, userId, archetypeId
      );
    } else {
      await dbRun(
        'UPDATE archetype_data SET seen = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND archetype_id = ?',
        userId, archetypeId
      );
    }
    res.json({ success: true, deduplicated: true });
    return;
  }

  if (guidance) {
    await dbRun(
      `INSERT INTO archetype_data (user_id, archetype_id, personal_manifestation, integration_score, guidance, updated_at, seen)
       VALUES (?, ?, ?, 10, ?, CURRENT_TIMESTAMP, 0)
       ON CONFLICT(user_id, archetype_id) DO UPDATE SET
       personal_manifestation = personal_manifestation || '\n' || excluded.personal_manifestation,
       integration_score = MIN(100, archetype_data.integration_score + 10),
       guidance = excluded.guidance, updated_at = CURRENT_TIMESTAMP, seen = 0`,
      userId, archetypeId, content, guidance
    );
  } else {
    await dbRun(
      `INSERT INTO archetype_data (user_id, archetype_id, personal_manifestation, integration_score, updated_at, seen)
       VALUES (?, ?, ?, 10, CURRENT_TIMESTAMP, 0)
       ON CONFLICT(user_id, archetype_id) DO UPDATE SET
       personal_manifestation = personal_manifestation || '\n' || excluded.personal_manifestation,
       integration_score = MIN(100, archetype_data.integration_score + 10),
       updated_at = CURRENT_TIMESTAMP, seen = 0`,
      userId, archetypeId, content
    );
  }
  res.json({ success: true });
});

app.patch('/api/archetype-seen/:userId/:archetypeId', async (req, res) => {
  await dbRun(
    'UPDATE archetype_data SET seen = 1 WHERE user_id = ? AND archetype_id = ?',
    req.params.userId, req.params.archetypeId
  );
  res.json({ success: true });
});
