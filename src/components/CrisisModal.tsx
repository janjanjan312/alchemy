import React from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Phone, X } from 'lucide-react';
import { HOTLINES, DISCLAIMER } from '../services/guardrails';

interface CrisisModalProps {
  onClose: () => void;
}

export default function CrisisModal({ onClose }: CrisisModalProps) {
  return (
    <motion.div
      className="absolute inset-0 z-[200] flex items-center justify-center p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-sm rounded-2xl bg-[#0a0a0a] border border-red-500/30 p-6 shadow-[0_0_40px_rgba(239,68,68,0.15)]"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-white/30 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-red-500/10">
            <ShieldAlert size={20} className="text-red-400" />
          </div>
          <h3 className="text-[15px] font-medium text-red-400">你的安全最重要</h3>
        </div>

        <p className="text-[13px] text-white/60 leading-relaxed mb-5">
          {DISCLAIMER}
        </p>

        <div className="space-y-2.5 mb-5">
          {HOTLINES.map((h) => (
            <a
              key={h.number}
              href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
            >
              <Phone size={14} className="text-red-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] text-white/80 truncate">{h.name}</p>
                <p className="text-[12px] text-red-400/80 font-mono">{h.number}</p>
              </div>
            </a>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-white/5 text-white/50 text-[13px] hover:bg-white/10 transition-colors"
        >
          我知道了，继续对话
        </button>
      </motion.div>
    </motion.div>
  );
}
