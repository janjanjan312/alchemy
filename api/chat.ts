import type { VercelRequest, VercelResponse } from '@vercel/node';

const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.VITE_ARK_TEXT_MODEL || 'deepseek-v3-250324';

  if (!apiKey) {
    return res.status(500).json({ error: 'ARK_API_KEY not configured' });
  }

  try {
    const response = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: req.body.messages,
        max_tokens: req.body.max_tokens || 200,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('ARK API error:', error.message);
    return res.status(502).json({ error: 'Failed to reach ARK API' });
  }
}
