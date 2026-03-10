import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({
    ok: true,
    ts: Date.now(),
    turso: !!process.env.TURSO_DATABASE_URL,
    node: process.version,
  });
}
