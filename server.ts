import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "http";
import path from "path";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { embedTexts, bufferToEmbedding, cosineSimilarity, normalizeVector, dotProduct } from "./src/server/embedding";

dotenv.config();

const db = new Database("psyche.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    role TEXT,
    content TEXT,
    mode TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS archetype_data (
    user_id TEXT,
    archetype_id TEXT,
    personal_manifestation TEXT,
    integration_score INTEGER DEFAULT 0,
    guidance TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, archetype_id)
  );

  CREATE TABLE IF NOT EXISTS symbols (
    user_id TEXT,
    term TEXT,
    meaning TEXT,
    PRIMARY KEY (user_id, term)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    target TEXT NOT NULL,
    trait TEXT NOT NULL,
    archetype_id TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    core_patterns TEXT DEFAULT '',
    shadow_themes TEXT DEFAULT '',
    recurring_symbols TEXT DEFAULT '',
    growth_trajectory TEXT DEFAULT '',
    summary_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    chunk_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try { db.exec(`ALTER TABLE chat_history ADD COLUMN session_id TEXT`); } catch {}
try { db.exec(`ALTER TABLE chat_history ADD COLUMN insight_type TEXT`); } catch {}
try { db.exec(`ALTER TABLE chat_history ADD COLUMN insight_content TEXT`); } catch {}
try { db.exec(`ALTER TABLE chat_history ADD COLUMN extras TEXT`); } catch {}
try { db.exec(`ALTER TABLE archetype_data ADD COLUMN updated_at DATETIME`); } catch {}
try { db.exec(`ALTER TABLE archetype_data ADD COLUMN seen INTEGER DEFAULT 0`); } catch {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- ASR: HTTP batch transcription (same logic as Milo asr-proxy) ---

  const ASR_MODEL = process.env.ASR_MODEL || "qwen3-asr-flash-realtime";
  const ASR_WS_URL = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${ASR_MODEL}`;

  function transcribePCM(pcmBase64: string, language: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const apiKey = process.env.DASHSCOPE_API_KEY || "";
      if (!apiKey) { reject(new Error("DASHSCOPE_API_KEY not configured")); return; }
      const texts: string[] = [];
      const audioBytes = pcmBase64.length * 3 / 4;
      const audioDurationSec = audioBytes / 2 / 16000;
      const timeoutMs = Math.max(15000, audioDurationSec * 3000 + 10000);
      const ws = new WebSocket(ASR_WS_URL, {
        headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "realtime=v1" },
      });
      const timeout = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, timeoutMs);
      let resolved = false;
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session.update",
          session: { modalities: ["text"], input_audio_format: "pcm", sample_rate: 16000, input_audio_transcription: { language }, turn_detection: null },
        }));
        const chunk = 64000;
        for (let i = 0; i < pcmBase64.length; i += chunk) {
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64.slice(i, i + chunk) }));
        }
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        ws.send(JSON.stringify({ type: "session.finish" }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const t = msg.transcript || "";
          if (t) texts.push(t);
        }
        if (msg.type === "session.finished" && !resolved) {
          resolved = true; clearTimeout(timeout); ws.close(); resolve(texts.join(""));
        }
        if (msg.type === "error" && !resolved) {
          resolved = true; clearTimeout(timeout); ws.close(); reject(new Error(msg.error?.message || "DashScope error"));
        }
      });
      ws.on("close", () => { if (!resolved) { resolved = true; clearTimeout(timeout); resolve(texts.join("")); } });
      ws.on("error", (err) => { if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); } });
    });
  }

  app.post("/api/transcribe", express.json({ limit: "10mb" }), async (req, res) => {
    const { audio, language = "zh" } = req.body;
    if (!audio) { res.status(400).json({ error: "No audio data" }); return; }
    try {
      const text = await transcribePCM(audio, language);
      res.json({ text });
    } catch (e: any) {
      console.error("[transcribe] error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Chat proxy to ARK API
  app.post("/api/chat", async (req, res) => {
    const apiKey = process.env.ARK_API_KEY;
    const model = process.env.VITE_ARK_TEXT_MODEL || "deepseek-v3-250324";
    const endpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

    if (!apiKey) {
      res.status(500).json({ error: "ARK_API_KEY not configured" });
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: req.body.messages,
          max_tokens: req.body.max_tokens || 200,
        }),
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
      console.error("ARK API error:", error.message);
      res.status(502).json({ error: "Failed to reach ARK API" });
    }
  });

  // API Routes
  app.get("/api/profile/:userId", (req, res) => {
    const { userId } = req.params;
    const archetypes = db.prepare("SELECT * FROM archetype_data WHERE user_id = ?").all(userId);
    const symbols = db.prepare("SELECT * FROM symbols WHERE user_id = ?").all(userId);
    res.json({ archetypes, symbols });
  });

  // --- Session & Chat History APIs ---

  const MAX_SESSIONS_TOTAL = 10;

  function cleanupOldSessions(userId: string) {
    const empty = db.prepare(`
      SELECT s.id FROM sessions s
      WHERE s.user_id = ?
        AND NOT EXISTS (SELECT 1 FROM chat_history c WHERE c.session_id = s.id AND c.role = 'user')
    `).all(userId) as { id: string }[];
    for (const s of empty) {
      db.prepare("DELETE FROM chat_history WHERE session_id = ?").run(s.id);
      db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
    }

    const stale = db.prepare(
      "SELECT id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT -1 OFFSET ?"
    ).all(userId, MAX_SESSIONS_TOTAL) as { id: string }[];
    for (const s of stale) {
      db.prepare("DELETE FROM chat_history WHERE session_id = ?").run(s.id);
      db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
    }
  }

  app.get("/api/sessions/:userId", (req, res) => {
    const { userId } = req.params;
    const mode = req.query.mode as string | undefined;
    const stmt = mode
      ? db.prepare("SELECT * FROM sessions WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC")
      : db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC");
    const sessions = (mode ? stmt.all(userId, mode) : stmt.all(userId)) as any[];
    for (const s of sessions) {
      const first = db.prepare(
        "SELECT content FROM chat_history WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1"
      ).get(s.id) as { content: string } | undefined;
      s.preview = first?.content?.slice(0, 50) || null;
    }
    cleanupOldSessions(userId);
    res.json(sessions);
  });

  app.delete("/api/sessions/:sessionId", (req, res) => {
    const { sessionId } = req.params;
    db.prepare("DELETE FROM chat_history WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    res.json({ success: true });
  });

  app.post("/api/sessions", (req, res) => {
    const { userId, mode } = req.body;
    const id = randomUUID();
    db.prepare("INSERT INTO sessions (id, user_id, mode) VALUES (?, ?, ?)").run(id, userId, mode);
    res.json({ id, userId, mode });
  });

  app.get("/api/sessions/:sessionId/messages", (req, res) => {
    const { sessionId } = req.params;
    const messages = db.prepare(
      "SELECT role, content, mode, timestamp, insight_type, insight_content, extras FROM chat_history WHERE session_id = ? ORDER BY id ASC"
    ).all(sessionId);
    res.json(messages);
  });

  app.post("/api/sessions/:sessionId/messages", (req, res) => {
    const { sessionId } = req.params;
    const { userId, role, content, mode, insightType, insightContent, extras } = req.body;
    db.prepare(
      "INSERT INTO chat_history (session_id, user_id, role, content, mode, insight_type, insight_content, extras) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(sessionId, userId, role, content, mode, insightType || null, insightContent || null, extras || null);
    db.prepare("UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
    res.json({ success: true });
  });

  // --- Symbol Dictionary APIs ---

  app.get("/api/symbols/:userId", (req, res) => {
    const { userId } = req.params;
    const symbols = db.prepare("SELECT term, meaning FROM symbols WHERE user_id = ?").all(userId);
    res.json(symbols);
  });

  app.post("/api/symbols", (req, res) => {
    const { userId, term, meaning } = req.body;
    db.prepare(
      "INSERT INTO symbols (user_id, term, meaning) VALUES (?, ?, ?) ON CONFLICT(user_id, term) DO UPDATE SET meaning = excluded.meaning"
    ).run(userId, term, meaning);
    res.json({ success: true });
  });

  app.delete("/api/symbols/:userId/:term", (req, res) => {
    const { userId, term } = req.params;
    db.prepare("DELETE FROM symbols WHERE user_id = ? AND term = ?").run(userId, term);
    res.json({ success: true });
  });

  // --- Projection Tracking APIs ---

  app.get("/api/projections/:userId", (req, res) => {
    const { userId } = req.params;
    const status = req.query.status as string | undefined;
    const stmt = status
      ? db.prepare("SELECT * FROM projections WHERE user_id = ? AND status = ? ORDER BY updated_at DESC")
      : db.prepare("SELECT * FROM projections WHERE user_id = ? ORDER BY updated_at DESC");
    res.json(status ? stmt.all(userId, status) : stmt.all(userId));
  });

  app.post("/api/projections", (req, res) => {
    const { userId, target, trait, archetypeId } = req.body;
    const result = db.prepare(
      "INSERT INTO projections (user_id, target, trait, archetype_id) VALUES (?, ?, ?, ?)"
    ).run(userId, target, trait, archetypeId || null);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  app.patch("/api/projections/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.prepare("UPDATE projections SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
    res.json({ success: true });
  });

  app.delete("/api/projections/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM projections WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // --- Long-term Memory (Session Summaries) ---

  const MAX_SUMMARIES_PER_USER = 20;

  function cleanupOldSummaries(userId: string) {
    db.prepare(
      "DELETE FROM session_summaries WHERE user_id = ? AND id NOT IN (SELECT id FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)"
    ).run(userId, userId, MAX_SUMMARIES_PER_USER);
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
    const model = process.env.VITE_ARK_TEXT_MODEL || "deepseek-v3-250324";
    if (!apiKey) return;

    const profile = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as any;
    const recentSummaries = db.prepare(
      "SELECT summary, mode, created_at FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(userId, PROFILE_UPDATE_INTERVAL) as { summary: string; mode: string }[];

    if (recentSummaries.length === 0) return;

    const currentProfile = profile
      ? `当前画像：\n- 核心模式：${profile.core_patterns || '暂无'}\n- 阴影主题：${profile.shadow_themes || '暂无'}\n- 反复象征：${profile.recurring_symbols || '暂无'}\n- 成长轨迹：${profile.growth_trajectory || '暂无'}`
      : '当前画像：首次生成，所有维度为空';

    const summaryBlock = recentSummaries.map((s, i) => `${i + 1}. [${s.mode}] ${s.summary}`).join('\n');

    try {
      const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: PROFILE_MERGE_PROMPT },
            { role: "user", content: `${currentProfile}\n\n最近的对话摘要：\n${summaryBlock}` },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) return;
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content?.trim() || '';

      const jsonStr = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      db.prepare(`
        INSERT INTO user_profiles (user_id, core_patterns, shadow_themes, recurring_symbols, growth_trajectory, summary_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          core_patterns = excluded.core_patterns,
          shadow_themes = excluded.shadow_themes,
          recurring_symbols = excluded.recurring_symbols,
          growth_trajectory = excluded.growth_trajectory,
          summary_count = excluded.summary_count,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        userId,
        parsed.core_patterns || '',
        parsed.shadow_themes || '',
        parsed.recurring_symbols || '',
        parsed.growth_trajectory || '',
        (profile?.summary_count || 0) + recentSummaries.length
      );
    } catch (e) {
      console.error('Profile update failed:', e);
    }
  }

  async function generateSummary(messages: { role: string; content: string }[]): Promise<string> {
    const apiKey = process.env.ARK_API_KEY;
    const model = process.env.VITE_ARK_TEXT_MODEL || "deepseek-v3-250324";

    if (!apiKey || messages.length < 2) return '';

    const dialogue = messages
      .filter(m => m.role === 'user' || m.role === 'model')
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
      .join('\n');

    try {
      const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SUMMARIZE_PROMPT },
            { role: "user", content: dialogue },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) return '';
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    } catch {
      return '';
    }
  }

  app.post("/api/sessions/:sessionId/summarize", async (req, res) => {
    const { sessionId } = req.params;

    const existing = db.prepare("SELECT id FROM session_summaries WHERE session_id = ?").get(sessionId);
    if (existing) { res.json({ success: true, skipped: true }); return; }

    const session = db.prepare("SELECT user_id, mode FROM sessions WHERE id = ?").get(sessionId) as { user_id: string; mode: string } | undefined;
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }

    const msgs = db.prepare(
      "SELECT role, content FROM chat_history WHERE session_id = ? AND role IN ('user', 'model') ORDER BY id ASC"
    ).all(sessionId) as { role: string; content: string }[];

    const userMsgCount = msgs.filter(m => m.role === 'user').length;
    if (userMsgCount < 2) { res.json({ success: true, skipped: true, reason: 'too_short' }); return; }

    const summary = await generateSummary(msgs);
    if (!summary) { res.status(500).json({ error: "Summary generation failed" }); return; }

    db.prepare(
      "INSERT OR IGNORE INTO session_summaries (session_id, user_id, mode, summary) VALUES (?, ?, ?, ?)"
    ).run(sessionId, session.user_id, session.mode, summary);

    cleanupOldSummaries(session.user_id);

    const totalSummaries = (db.prepare(
      "SELECT COUNT(*) as cnt FROM session_summaries WHERE user_id = ?"
    ).get(session.user_id) as { cnt: number }).cnt;
    const profile = db.prepare("SELECT summary_count FROM user_profiles WHERE user_id = ?").get(session.user_id) as { summary_count: number } | undefined;
    const lastUpdateCount = profile?.summary_count || 0;

    if (totalSummaries - lastUpdateCount >= PROFILE_UPDATE_INTERVAL) {
      updateUserProfile(session.user_id).catch(() => {});
    }

    res.json({ success: true, summary });
  });

  app.get("/api/summaries/:userId", (req, res) => {
    const { userId } = req.params;
    const mode = req.query.mode as string | undefined;
    const limit = parseInt(req.query.limit as string) || 5;

    const stmt = mode
      ? db.prepare("SELECT session_id, mode, summary, created_at FROM session_summaries WHERE user_id = ? AND mode = ? ORDER BY created_at DESC LIMIT ?")
      : db.prepare("SELECT session_id, mode, summary, created_at FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?");

    const summaries = mode ? stmt.all(userId, mode, limit) : stmt.all(userId, limit);
    res.json(summaries);
  });

  app.get("/api/user-profile/:userId", (req, res) => {
    const { userId } = req.params;
    const profile = db.prepare(
      "SELECT core_patterns, shadow_themes, recurring_symbols, growth_trajectory, updated_at FROM user_profiles WHERE user_id = ?"
    ).get(userId);
    res.json(profile || null);
  });

  // --- Archetype Context (aggregated user data for archetype dialogue) ---

  app.get("/api/archetype-context/:userId/:archetypeId", (req, res) => {
    const { userId, archetypeId } = req.params;

    const archetypeData = db.prepare(
      "SELECT personal_manifestation, integration_score, guidance FROM archetype_data WHERE user_id = ? AND archetype_id = ?"
    ).get(userId, archetypeId) as { personal_manifestation: string; integration_score: number; guidance: string } | undefined;

    const relatedProjections = db.prepare(
      "SELECT target, trait, status FROM projections WHERE user_id = ? AND archetype_id = ? ORDER BY updated_at DESC LIMIT 5"
    ).all(userId, archetypeId) as { target: string; trait: string; status: string }[];

    const symbols = db.prepare("SELECT term, meaning FROM symbols WHERE user_id = ?").all(userId) as { term: string; meaning: string }[];

    const profile = db.prepare(
      "SELECT core_patterns, shadow_themes, recurring_symbols, growth_trajectory FROM user_profiles WHERE user_id = ?"
    ).get(userId) as { core_patterns: string; shadow_themes: string; recurring_symbols: string; growth_trajectory: string } | undefined;

    const recentSummaries = db.prepare(
      "SELECT summary, mode FROM session_summaries WHERE user_id = ? ORDER BY created_at DESC LIMIT 3"
    ).all(userId) as { summary: string; mode: string }[];

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
    for (const wordSet of chunkWordSets) {
      if (wordSet.has(keyword)) count++;
    }
    kwDfCache.set(keyword, count);
    return count;
  }

  function keywordBoostByIndex(chunkIdx: number, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const wordSet = chunkWordSets[chunkIdx];
    if (!wordSet) return 0;
    const totalDocs = knowledgeCache!.length || 1;
    let totalWeight = 0;
    let matchedWeight = 0;

    for (const kw of keywords) {
      const df = getKeywordDf(kw);
      const idf = Math.log(totalDocs / (df + 1));
      totalWeight += idf;
      if (wordSet.has(kw)) matchedWeight += idf;
    }
    if (totalWeight === 0) return 0;
    return (matchedWeight / totalWeight) * 0.12;
  }

  function loadKnowledgeCache() {
    const rows = db.prepare("SELECT id, title, content, embedding FROM knowledge_chunks").all() as {
      id: number; title: string; content: string; embedding: Buffer;
    }[];
    knowledgeCache = rows.map(r => ({
      id: r.id,
      title: r.title || '',
      content: r.content,
    }));

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

  loadKnowledgeCache();

  // --- Query-time Caches (embedding + translation) ---
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
    const model = process.env.VITE_ARK_TEXT_MODEL || "deepseek-v3-250324";
    if (!apiKey) return null;

    try {
      const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Translate the Chinese text to English in ONE short sentence (max 15 words). Use Jungian terms: shadow, anima/animus, persona, Self, individuation, projection, transference, collective unconscious, archetype, active imagination, complex, mandala, nigredo, albedo, rubedo. Output ONLY the translation." },
            { role: "user", content: query },
          ],
          max_tokens: 60,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      let result = data.choices?.[0]?.message?.content?.trim() || null;
      if (result) {
        // Take only the first line/sentence to avoid model adding explanations
        result = result.split(/\n/)[0].trim();
        // Remove trailing incomplete sentences
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

  app.get("/api/knowledge-search", async (req, res) => {
    const query = req.query.q as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

    if (!query) { res.json([]); return; }
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
        for (let d = 0; d < dim; d++) {
          dot += queryVec[d] * mat[offset + d];
        }
        bestScores[i] = dot;
      }
      const dotMs = Date.now() - t1;

      const t2 = Date.now();
      const topIndices: number[] = [];
      const tempScores = new Float32Array(bestScores);
      for (let k = 0; k < 100; k++) {
        let maxIdx = 0;
        let maxVal = tempScores[0];
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
        return {
          id: knowledgeCache![i].id,
          title: knowledgeCache![i].title,
          content: knowledgeCache![i].content,
          cosine, boost, score: cosine + boost,
        };
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
        const src = (db.prepare("SELECT source_file FROM knowledge_chunks WHERE id = ?").get(item.id) as any)?.source_file || '?';
        const shortSrc = src.replace(/\s*\(Collected Works.*$/, '').slice(0, 30);
        const preview = item.content.replace(/\n/g, ' ').slice(0, 100);
        const marker = item.score > 0.3 ? '✓' : '✗';
        const boostStr = (item as any).boost > 0 ? ` +${((item as any).boost as number).toFixed(3)}kw` : '';
        console.log(`  ${marker} [${item.score.toFixed(4)}${boostStr}] (${shortSrc}) ${preview}...`);
      }
      console.log(`[RAG] Returned: ${results.length}/${limit} (threshold > 0.3)\n`);

      res.json(results.map(r => ({ id: r.id, title: r.title, content: r.content, score: r.score })));
    } catch (error: any) {
      console.error("[RAG] Search error:", error.message);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/knowledge-reload", (_req, res) => {
    loadKnowledgeCache();
    res.json({ success: true, count: knowledgeCache?.length || 0 });
  });

  app.post("/api/archive-insight", (req, res) => {
    const { userId, archetypeId, content, guidance } = req.body;

    const existing = db.prepare(
      "SELECT personal_manifestation FROM archetype_data WHERE user_id = ? AND archetype_id = ?"
    ).get(userId, archetypeId) as { personal_manifestation: string } | undefined;

    if (existing && existing.personal_manifestation.includes(content)) {
      db.prepare(
        "UPDATE archetype_data SET seen = 0, updated_at = CURRENT_TIMESTAMP" +
        (guidance ? ", guidance = ?" : "") +
        " WHERE user_id = ? AND archetype_id = ?"
      ).run(...(guidance ? [guidance, userId, archetypeId] : [userId, archetypeId]));
      res.json({ success: true, deduplicated: true });
      return;
    }

    if (guidance) {
      db.prepare(`
        INSERT INTO archetype_data (user_id, archetype_id, personal_manifestation, integration_score, guidance, updated_at, seen)
        VALUES (?, ?, ?, 10, ?, CURRENT_TIMESTAMP, 0)
        ON CONFLICT(user_id, archetype_id) DO UPDATE SET
        personal_manifestation = personal_manifestation || '\n' || excluded.personal_manifestation,
        integration_score = MIN(100, archetype_data.integration_score + 10),
        guidance = excluded.guidance,
        updated_at = CURRENT_TIMESTAMP,
        seen = 0
      `).run(userId, archetypeId, content, guidance);
    } else {
      db.prepare(`
        INSERT INTO archetype_data (user_id, archetype_id, personal_manifestation, integration_score, updated_at, seen)
        VALUES (?, ?, ?, 10, CURRENT_TIMESTAMP, 0)
        ON CONFLICT(user_id, archetype_id) DO UPDATE SET
        personal_manifestation = personal_manifestation || '\n' || excluded.personal_manifestation,
        integration_score = MIN(100, archetype_data.integration_score + 10),
        updated_at = CURRENT_TIMESTAMP,
        seen = 0
      `).run(userId, archetypeId, content);
    }
    res.json({ success: true });
  });

  app.patch("/api/archetype-seen/:userId/:archetypeId", (req, res) => {
    db.prepare("UPDATE archetype_data SET seen = 1 WHERE user_id = ? AND archetype_id = ?")
      .run(req.params.userId, req.params.archetypeId);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // --- ASR: WebSocket proxy (browser → server → DashScope realtime) ---

  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/asr") return;

    wss.handleUpgrade(req, socket, head, (browserWs) => {
      const apiKey = process.env.DASHSCOPE_API_KEY || "";
      if (!apiKey) { browserWs.close(1011, "Missing API key"); return; }

      const pendingMessages: { data: any; binary: boolean }[] = [];
      let upstreamReady = false;

      const dashscopeWs = new WebSocket(ASR_WS_URL, {
        headers: { Authorization: `Bearer ${apiKey}`, "OpenAI-Beta": "realtime=v1" },
      });

      dashscopeWs.on("open", () => {
        upstreamReady = true;
        for (const msg of pendingMessages) {
          dashscopeWs.send(msg.data, { binary: msg.binary });
        }
        pendingMessages.length = 0;
      });

      browserWs.on("message", (data, isBinary) => {
        if (upstreamReady && dashscopeWs.readyState === WebSocket.OPEN) {
          dashscopeWs.send(data, { binary: isBinary });
        } else {
          pendingMessages.push({ data, binary: isBinary });
        }
      });

      dashscopeWs.on("message", (data, isBinary) => {
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(data, { binary: isBinary });
        }
      });

      dashscopeWs.on("error", (err) => {
        console.error("[ASR proxy] DashScope error:", err.message);
        if (browserWs.readyState === WebSocket.OPEN) browserWs.close(1011, "Upstream error");
      });

      dashscopeWs.on("close", (code, reason) => {
        if (browserWs.readyState === WebSocket.OPEN) browserWs.close(code, reason?.toString());
      });

      browserWs.on("close", () => {
        if (dashscopeWs.readyState === WebSocket.OPEN) dashscopeWs.close();
      });

      browserWs.on("error", (err) => {
        console.error("[ASR proxy] browser error:", err.message);
        if (dashscopeWs.readyState === WebSocket.OPEN) dashscopeWs.close();
      });
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
