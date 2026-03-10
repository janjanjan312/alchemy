import type { VercelRequest, VercelResponse } from '@vercel/node';
import WebSocket from 'ws';

const ASR_MODEL = process.env.ASR_MODEL || 'qwen3-asr-flash-realtime';
const ASR_WS_URL = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${ASR_MODEL}`;

function transcribePCM(pcmBase64: string, apiKey: string, language: string): Promise<string> {
  return new Promise((resolve, reject) => {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.DASHSCOPE_API_KEY || '';
  if (!apiKey) return res.status(500).json({ error: 'DASHSCOPE_API_KEY not configured' });

  const { audio, language = 'zh' } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });

  try {
    const text = await transcribePCM(audio, apiKey, language);
    return res.status(200).json({ text });
  } catch (e: any) {
    console.error('[transcribe] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
