import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Archetype } from '../types';
import { MessageSquare, Lock, Sparkles } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ArchetypeCardProps {
  archetype: Archetype;
  onTalk: (id: string) => void;
  isActive?: boolean;
  onMarkSeen?: (id: string) => void;
}

export default function ArchetypeCard({ archetype, onTalk, isActive = true, onMarkSeen }: ArchetypeCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const isLocked = !archetype.unlocked;

  return (
    <div
      className={cn(
        "relative h-[450px] w-full group",
        isActive ? "cursor-pointer" : "cursor-default"
      )}
      style={{ perspective: '1000px' }}
    >
      <motion.div
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.8, type: "spring", stiffness: 260, damping: 20 }}
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front Side */}
        <div
          className={cn(
            "absolute inset-0 rounded-2xl overflow-hidden border transition-all duration-500",
            isLocked
              ? "border-white/5 bg-white/5 grayscale"
              : archetype.recentlyUpdated
                ? "border-alchemy-accent/30 bg-alchemy-black shadow-[0_0_16px_rgba(226,199,146,0.1)]"
                : "border-alchemy-gold/20 bg-alchemy-black"
          )}
          style={{ backfaceVisibility: 'hidden', pointerEvents: isFlipped ? 'none' : 'auto' }}
          onClick={() => {
            if (isActive) {
              setIsFlipped(true);
              if (archetype.recentlyUpdated && onMarkSeen) onMarkSeen(archetype.id);
            }
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-alchemy-black via-transparent to-transparent z-10" />
          <img
            src={archetype.image}
            alt={archetype.name}
            className={cn(
              "w-full h-full object-cover transition-transform duration-1000",
              !isLocked && "group-hover:scale-110 opacity-60",
              isLocked && "opacity-20"
            )}
            referrerPolicy="no-referrer"
          />

          {isLocked ? (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10">
                <Lock size={20} className="text-white/20" />
              </div>
              <h3 className="text-lg font-bold text-white/20 mb-2">未显现</h3>
              <p className="text-xs text-white/10 italic">在对话中触及相关意象以解锁此原型</p>
            </div>
          ) : (
            <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
              <h3 className="text-xl font-bold text-alchemy-gold mb-1">{archetype.name}</h3>
              <p className="text-[12px] opacity-60 italic line-clamp-2">{archetype.description}</p>
            </div>
          )}

          {!isLocked && archetype.recentlyUpdated && (
            <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-alchemy-accent/90 shadow-[0_0_12px_rgba(226,199,146,0.4)]">
              <Sparkles size={11} className="text-alchemy-black" />
              <span className="text-[11px] font-bold text-alchemy-black tracking-wide">新洞察</span>
            </div>
          )}

          {!isLocked && (
            <>
              <div className={cn("absolute top-4 left-4 w-4 h-4 border-t border-l", archetype.recentlyUpdated ? "border-alchemy-accent/45" : "border-alchemy-gold/40")} />
              <div className={cn("absolute top-4 right-4 w-4 h-4 border-t border-r", archetype.recentlyUpdated ? "border-alchemy-accent/45" : "border-alchemy-gold/40")} />
              <div className={cn("absolute bottom-4 left-4 w-4 h-4 border-b border-l", archetype.recentlyUpdated ? "border-alchemy-accent/45" : "border-alchemy-gold/40")} />
              <div className={cn("absolute bottom-4 right-4 w-4 h-4 border-b border-r", archetype.recentlyUpdated ? "border-alchemy-accent/45" : "border-alchemy-gold/40")} />
            </>
          )}
        </div>

        {/* Back Side */}
        <div
          className="absolute inset-0 rounded-2xl border border-alchemy-accent/20 bg-[#0a0a0a] p-6 flex flex-col overflow-hidden"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', pointerEvents: isFlipped ? 'auto' : 'none' }}
          onClick={() => setIsFlipped(false)}
        >
          {/* Header */}
          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-alchemy-accent/50 font-sans mb-1">ARCHETYPE</div>
            <h3 className="text-lg font-serif font-bold text-alchemy-accent">{archetype.name}</h3>
          </div>

          {/* Insights */}
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 flex flex-col justify-center">
            {archetype.personalManifestation ? (
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-alchemy-accent/50 font-sans mb-2">洞察记录</div>
                <div className="space-y-1.5">
                  {archetype.personalManifestation.split('\n').filter(Boolean).map((line, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="text-alchemy-accent/50 text-[10px] mt-[3px] shrink-0">◆</span>
                      <p className="text-[12px] leading-relaxed italic font-normal" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {line}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <p className="text-[12px] text-white/20 italic text-center">
                  暂无洞察记录。继续探索以点亮此原型。
                </p>
              </div>
            )}

            {archetype.guidance && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-alchemy-accent/50 font-sans mb-2">每日指引</div>
                <div className="p-3 rounded-lg bg-alchemy-accent/5 border border-alchemy-accent/10">
                  <p className="text-[12px] leading-relaxed italic font-normal" style={{ color: 'rgba(255,255,255,0.9)' }}>
                    {archetype.guidance}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Talk to Archetype */}
          <button
            onClick={(e) => { e.stopPropagation(); onTalk(archetype.id); }}
            className="mt-3 flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] text-alchemy-accent/70 hover:text-alchemy-accent transition-colors"
          >
            <MessageSquare size={13} />
            <span>与此原型对话</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
