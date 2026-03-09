import { app, ensureSchema, loadKnowledgeCache } from './server';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

const ASR_MODEL = process.env.ASR_MODEL || 'qwen3-asr-flash-realtime';
const ASR_WS_URL = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${ASR_MODEL}`;
const PORT = 3000;

async function start() {
  await ensureSchema();
  await loadKnowledgeCache();

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/asr') return;

    wss.handleUpgrade(req, socket, head, (browserWs) => {
      const apiKey = process.env.DASHSCOPE_API_KEY || '';
      if (!apiKey) { browserWs.close(1011, 'Missing API key'); return; }

      const pendingMessages: { data: any; binary: boolean }[] = [];
      let upstreamReady = false;

      const dashscopeWs = new WebSocket(ASR_WS_URL, {
        headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Beta': 'realtime=v1' },
      });

      dashscopeWs.on('open', () => {
        upstreamReady = true;
        for (const msg of pendingMessages) {
          dashscopeWs.send(msg.data, { binary: msg.binary });
        }
        pendingMessages.length = 0;
      });

      browserWs.on('message', (data, isBinary) => {
        if (upstreamReady && dashscopeWs.readyState === WebSocket.OPEN) {
          dashscopeWs.send(data, { binary: isBinary });
        } else {
          pendingMessages.push({ data, binary: isBinary });
        }
      });

      dashscopeWs.on('message', (data, isBinary) => {
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(data, { binary: isBinary });
        }
      });

      dashscopeWs.on('error', (err) => {
        console.error('[ASR proxy] DashScope error:', err.message);
        if (browserWs.readyState === WebSocket.OPEN) browserWs.close(1011, 'Upstream error');
      });

      dashscopeWs.on('close', (code, reason) => {
        if (browserWs.readyState === WebSocket.OPEN) browserWs.close(code, reason?.toString());
      });

      browserWs.on('close', () => {
        if (dashscopeWs.readyState === WebSocket.OPEN) dashscopeWs.close();
      });

      browserWs.on('error', (err) => {
        console.error('[ASR proxy] browser error:', err.message);
        if (dashscopeWs.readyState === WebSocket.OPEN) dashscopeWs.close();
      });
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
