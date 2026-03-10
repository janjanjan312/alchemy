import type { VercelRequest, VercelResponse } from '@vercel/node';

let handler: any = null;
let loadError: Error | null = null;

const init = import('../server').then(
  (mod) => { handler = mod.app; },
  (err) => { loadError = err; console.error('[api/index] Failed to load server:', err); }
);

export default async function (req: VercelRequest, res: VercelResponse) {
  await init;
  if (loadError) {
    res.status(500).json({
      error: 'Server module failed to load',
      message: loadError.message,
      stack: loadError.stack?.split('\n').slice(0, 8),
    });
    return;
  }
  handler(req, res);
}
