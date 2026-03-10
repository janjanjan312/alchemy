import type { Client, InValue } from '@libsql/client';

let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL || 'file:psyche.db';
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (url.startsWith('file:')) {
      const { createClient } = await import('@libsql/client');
      _client = createClient({ url, authToken });
    } else {
      const { createClient } = await import('@libsql/client/web');
      _client = createClient({ url, authToken });
    }
  }
  return _client;
}

export async function dbExec(sql: string): Promise<void> {
  const client = await getClient();
  await client.executeMultiple(sql);
}

export async function dbAll(sql: string, ...args: InValue[]): Promise<any[]> {
  const client = await getClient();
  const result = await client.execute({ sql, args });
  return result.rows as any[];
}

export async function dbGet(sql: string, ...args: InValue[]): Promise<any | undefined> {
  const client = await getClient();
  const result = await client.execute({ sql, args });
  return (result.rows[0] as any) || undefined;
}

export async function dbRun(sql: string, ...args: InValue[]): Promise<{ lastInsertRowid: number; changes: number }> {
  const client = await getClient();
  const result = await client.execute({ sql, args });
  return {
    lastInsertRowid: Number(result.lastInsertRowid),
    changes: result.rowsAffected,
  };
}

const SCHEMA_SQL = `
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
    session_id TEXT,
    insight_type TEXT,
    insight_content TEXT,
    extras TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS archetype_data (
    user_id TEXT,
    archetype_id TEXT,
    personal_manifestation TEXT,
    integration_score INTEGER DEFAULT 0,
    guidance TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    seen INTEGER DEFAULT 0,
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
`;

export async function initSchema(): Promise<void> {
  await dbExec(SCHEMA_SQL);
}
