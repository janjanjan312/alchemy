import { useRef, useEffect, useCallback } from 'react';

interface VoiceWaveformProps {
  isActive: boolean;
  audioLevel: number;
  barCount?: number;
  color?: string;
  className?: string;
}

const DEFAULT_BAR_COUNT = 36;

export function VoiceWaveform({
  isActive,
  audioLevel,
  barCount = DEFAULT_BAR_COUNT,
  color = '#E8D5A3',
  className = '',
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioLevelRef = useRef(0);
  const barsRef = useRef<number[]>(Array(DEFAULT_BAR_COUNT).fill(0.08));
  const rafRef = useRef<number>(0);

  audioLevelRef.current = audioLevel;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, w, h);

    const bars = barsRef.current;
    const count = barCount;
    if (bars.length !== count) {
      barsRef.current = Array(count).fill(0.08);
    }

    const level = audioLevelRef.current;
    const normalized = Math.min(level * 6, 1);

    bars.push(normalized);
    if (bars.length > count) bars.shift();

    const gap = 2.5;
    const totalGap = gap * (count - 1);
    const barW = Math.max(2, (w - totalGap) / count);
    const maxBarH = h * 0.9;
    const minBarH = 3;
    const centerY = h / 2;

    for (let i = 0; i < count; i++) {
      const raw = bars[i] || 0;
      const t = Date.now() * 0.004 + i * 0.5;
      const idle = 0.08 + Math.sin(t) * 0.04 + Math.sin(t * 1.7) * 0.03;
      const target = raw > 0.01 ? raw : idle;
      const barH = Math.max(minBarH, target * maxBarH);
      const x = i * (barW + gap);
      const y = centerY - barH / 2;
      const opacity = 0.5 + target * 0.5;

      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.beginPath();
      const r = barW / 2;
      ctx.roundRect(x, y, barW, barH, r);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    rafRef.current = requestAnimationFrame(draw);
  }, [barCount, color]);

  useEffect(() => {
    if (isActive) {
      barsRef.current = Array(barCount).fill(0.08);
      rafRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, draw, barCount]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
