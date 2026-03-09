export type AudioLevelCallback = (level: number) => void;

export interface PushToTalkController {
  stop: () => Promise<string>;
  cancel: () => void;
}

function getWsUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_ASR_WS_URL;
  if (envUrl) return envUrl;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/asr`;
}

function getHttpTranscribeUrl(): string {
  const httpUrl = (import.meta as any).env?.VITE_ASR_HTTP_URL;
  if (httpUrl) return httpUrl;
  return `${location.origin}/api/transcribe`;
}

function encodeFloat32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function encodeToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

function getWsGraceMs(recordingElapsedMs: number): number {
  if (recordingElapsedMs <= 4000) return 1600;
  if (recordingElapsedMs <= 7000) return 2400;
  if (recordingElapsedMs <= 12000) return 3200;
  if (recordingElapsedMs <= 20000) return 4200;
  return 5000;
}

async function httpTranscribe(
  pcmChunks: Int16Array[],
  language: string,
  log: (...args: any[]) => void,
  signal?: AbortSignal,
): Promise<string> {
  const totalSamples = pcmChunks.reduce((sum, c) => sum + c.length, 0);
  if (totalSamples === 0) return '';

  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of pcmChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const b64 = encodeToBase64(new Uint8Array(merged.buffer));
  const url = getHttpTranscribeUrl();
  log(`[HTTP fallback] posting ${b64.length} base64 chars to ${url}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ audio: b64, language }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  log(`[HTTP fallback] result: "${(data.text || '').slice(-40)}"`);
  return data.text || '';
}

/**
 * Streams audio to ASR proxy via WebSocket while recording.
 * On stop(), sends commit + finish and waits for the final transcript.
 * Falls back to HTTP POST if WebSocket fails or times out.
 */
export async function startRecording(language: 'zh' | 'en' = 'zh', onAudioLevel?: AudioLevelCallback): Promise<PushToTalkController> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const ws = new WebSocket(getWsUrl());
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(2048, 1, 1);

  let stopped = false;
  let sessionReady = false;
  const pendingAudio: string[] = [];
  const pcmChunks: Int16Array[] = [];
  let accumulated = '';
  let resolveStop: ((text: string) => void) | null = null;
  let wsFailed = false;
  let stopRequested = false;
  let commitSent = false;

  const t0 = Date.now();
  const log = (...args: any[]) => console.log(`[PTT +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);
  const sendCommitFinish = () => {
    if (commitSent || ws.readyState !== WebSocket.OPEN) return;
    commitSent = true;
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    ws.send(JSON.stringify({ type: 'session.finish' }));
  };

  ws.onopen = () => {
    log('ws open, sending session.update');
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text'],
        input_audio_format: 'pcm',
        sample_rate: 16000,
        input_audio_transcription: { language },
        turn_detection: null,
      },
    }));
  };

  ws.onmessage = (evt) => {
    let msg: any;
    try { msg = JSON.parse(typeof evt.data === 'string' ? evt.data : ''); } catch { return; }

    if (msg.type === 'session.updated') {
      log('session ready, pending audio chunks:', pendingAudio.length);
      sessionReady = true;
      for (const b64 of pendingAudio) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
      }
      pendingAudio.length = 0;
      if (stopRequested) {
        log('session ready after stop, now sending WS commit+finish');
        sendCommitFinish();
      }
    }

    if (msg.type === 'conversation.item.input_audio_transcription.completed') {
      const t = (msg.transcript || '').trim();
      if (t) accumulated += t;
      log('completed:', accumulated.slice(-40));
    }

    if (msg.type === 'session.finished' && resolveStop) {
      log('session.finished, resolving with', accumulated.length, 'chars');
      resolveStop(accumulated);
    }

    if (msg.type === 'error') {
      log('DashScope error:', msg.error);
    }
  };

  ws.onerror = () => { wsFailed = true; };
  ws.onclose = (e) => {
    log('ws closed, code:', e.code, 'reason:', e.reason);
    if (resolveStop && accumulated) {
      log('ws closed with partial result, resolving with', accumulated.length, 'chars');
      resolveStop(accumulated);
    }
  };

  processor.onaudioprocess = (e) => {
    if (stopped) return;
    const channelData = e.inputBuffer.getChannelData(0);
    const b64 = encodeFloat32ToBase64(channelData);
    pcmChunks.push(float32ToInt16(channelData));
    if (sessionReady && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
    } else {
      pendingAudio.push(b64);
    }
    if (onAudioLevel) {
      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      onAudioLevel(Math.sqrt(sum / channelData.length));
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  const cleanup = () => {
    stopped = true;
    processor.disconnect();
    audioContext.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop: () => {
      cleanup();
      stopRequested = true;
      log('stop() called, wsState:', ws.readyState, 'sessionReady:', sessionReady, 'pending:', pendingAudio.length, 'wsFailed:', wsFailed);

      return new Promise<string>((resolve) => {
        let settled = false;
        let httpController: AbortController | null = null;
        const settle = (text: string, via: string) => {
          if (settled) return;
          settled = true;
          resolveStop = null;
          if (via === 'WS' && httpController) httpController.abort();
          log(`resolved via ${via}: "${text.slice(-40)}" (${text.length} chars)`);
          if (ws.readyState <= WebSocket.OPEN) ws.close();
          resolve(text);
        };

        resolveStop = (text: string) => settle(text, 'WS');

        const fireHttp = () => {
          if (settled) return;
          log('firing HTTP');
          httpController = new AbortController();
          httpTranscribe(pcmChunks, language, log, httpController.signal)
            .then((text) => settle(text, 'HTTP'))
            .catch((e) => {
              if (e?.name === 'AbortError') {
                log('HTTP aborted (WS already resolved)');
                return;
              }
              log('HTTP failed:', e.message);
              if (!settled) settle(accumulated, 'HTTP-error');
            });
        };

        if (sessionReady && ws.readyState === WebSocket.OPEN) {
          for (const b64 of pendingAudio) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
          }
          pendingAudio.length = 0;
          const wsGraceMs = getWsGraceMs(Date.now() - t0);
          sendCommitFinish();
          log(`WS commit+finish sent, HTTP fires in ${wsGraceMs}ms if no WS response`);
          setTimeout(fireHttp, wsGraceMs);
        } else {
          log('WS not ready, firing HTTP immediately');
          fireHttp();
        }
      });
    },
    cancel: () => {
      cleanup();
      if (ws.readyState <= WebSocket.OPEN) ws.close();
    },
  };
}
