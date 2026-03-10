import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client/web';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) {
      res.json({ error: 'TURSO_DATABASE_URL not set' });
      return;
    }
    const client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    const result = await client.execute('SELECT 1 as test');
    res.json({ ok: true, result: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
}
