import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const results: Record<string, string> = {};

  try { await import('express'); results.express = 'ok'; }
  catch (e: any) { results.express = e.message; }

  try { await import('ws'); results.ws = 'ok'; }
  catch (e: any) { results.ws = e.message; }

  try { await import('dotenv'); results.dotenv = 'ok'; }
  catch (e: any) { results.dotenv = e.message; }

  try { await import('../lib/db'); results.db = 'ok'; }
  catch (e: any) { results.db = e.message; }

  try { await import('../src/server/embedding'); results.embedding = 'ok'; }
  catch (e: any) { results.embedding = e.message; }

  try { await import('../server'); results.server = 'ok'; }
  catch (e: any) { results.server = e.message; }

  res.json(results);
}
