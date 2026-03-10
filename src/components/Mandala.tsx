import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Archetype, SymbolEntry, ProjectionEntry } from '../types';
import ArchetypeCard from './ArchetypeCard';
import { ChevronDown, ChevronUp, Sparkles, Lock, BookOpen, ScanEye, Check } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MandalaProps {
  archetypes: Archetype[];
  onTalk: (id: string) => void;
  symbols?: SymbolEntry[];
  projections?: ProjectionEntry[];
  onProjectionUpdate?: (id: number, status: 'active' | 'integrated') => void;
  onMarkSeen?: (id: string) => void;
}

export default function Mandala({ archetypes, onTalk, symbols = [], projections = [], onProjectionUpdate, onMarkSeen }: MandalaProps) {
  const sorted = [...archetypes].sort((a, b) => {
    const aUnlocked = a.unlocked ? 1 : 0;
    const bUnlocked = b.unlocked ? 1 : 0;
    if (aUnlocked !== bUnlocked) return bUnlocked - aUnlocked;
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });

  const [activeId, setActiveId] = useState<string | null>(sorted[0]?.id || null);
  const [showPanel, setShowPanel] = useState<'none' | 'symbols' | 'projections'>('none');
  
  const unlockedCount = sorted.filter(a => a.unlocked).length;
  
  const activeIndex = sorted.findIndex(a => a.id === activeId);
  
  const featured = sorted.filter((_, index) => {
    if (activeIndex === -1) return index < 5;
    return Math.abs(index - activeIndex) <= 2;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Top Bar: All Archetypes */}
      <div className="shrink-0 px-6 py-3 border-b border-white/5 bg-white/2">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[9px] uppercase tracking-[0.2em] font-bold text-alchemy-gold/60 flex items-center gap-2">
            <Sparkles size={10} />
            心灵原型图谱
          </h2>
          <span className="text-[9px] text-white/20 font-mono">{unlockedCount}/{sorted.length} 已显现</span>
        </div>
        <div className="flex gap-3 overflow-x-auto py-2 px-1 -mx-1 no-scrollbar">
          {sorted.map((a) => {
            const isLocked = !a.unlocked;
            return (
              <div 
                key={a.id}
                className={cn(
                  "shrink-0 w-10 h-14 rounded-md border transition-all duration-300 relative group cursor-pointer",
                  activeId === a.id 
                    ? "border-alchemy-gold scale-110 z-10 shadow-[0_0_15px_rgba(232,213,163,0.4)]" 
                    : "border-white/10 opacity-40 hover:opacity-100",
                  isLocked && "grayscale brightness-50"
                )}
                title={a.name}
                onClick={() => setActiveId(a.id)}
              >
                <div className="w-full h-full rounded-md overflow-hidden">
                  <img src={a.image} alt={a.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-alchemy-black/60 to-transparent" />
                </div>
                {isLocked && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Lock size={10} className="text-white/40" />
                  </div>
                )}
                {a.recentlyUpdated && (
                  <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-alchemy-accent border border-alchemy-black animate-pulse z-10" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Access: Symbols & Projections */}
      {(symbols.length > 0 || projections.length > 0) && (
        <div className="shrink-0 px-6 py-2 flex gap-2">
          {symbols.length > 0 && (
            <button
              onClick={() => setShowPanel(showPanel === 'symbols' ? 'none' : 'symbols')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] transition-all",
                showPanel === 'symbols'
                  ? "bg-alchemy-accent/15 text-alchemy-accent border border-alchemy-accent/25"
                  : "bg-white/5 text-white/40 border border-white/5"
              )}
            >
              <BookOpen size={12} />
              <span>词典 {symbols.length}</span>
            </button>
          )}
          {projections.length > 0 && (
            <button
              onClick={() => setShowPanel(showPanel === 'projections' ? 'none' : 'projections')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] transition-all",
                showPanel === 'projections'
                  ? "bg-alchemy-accent/15 text-alchemy-accent border border-alchemy-accent/30"
                  : "bg-white/5 text-white/40 border border-white/5"
              )}
            >
              <ScanEye size={12} />
              <span>投射 {projections.filter(p => p.status === 'active').length}</span>
            </button>
          )}
        </div>
      )}

      {/* Expandable Panel */}
      <AnimatePresence>
        {showPanel !== 'none' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="px-6 pb-3 max-h-[180px] overflow-y-auto no-scrollbar">
              {showPanel === 'symbols' && (
                <div className="space-y-2">
                  {symbols.map((s) => (
                    <div key={s.term} className="flex items-start gap-3 p-2.5 rounded-lg bg-alchemy-accent/5 border border-alchemy-accent/10">
                      <span className="text-[13px] font-medium text-alchemy-accent shrink-0">「{s.term}」</span>
                      <span className="text-[12px] text-white/50 italic">{s.meaning}</span>
                    </div>
                  ))}
                </div>
              )}
              {showPanel === 'projections' && (
                <div className="space-y-2">
                  {projections.map((p) => (
                    <div key={p.id ?? `${p.target}-${p.trait}`} className="flex items-center justify-between p-2.5 rounded-lg bg-alchemy-accent/5 border border-alchemy-accent/10">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-white/80 truncate">
                          {p.target} → <span className="text-alchemy-accent">{p.trait}</span>
                        </p>
                        <p className="text-[11px] text-white/30">{p.archetype}</p>
                      </div>
                      {p.status === 'active' && p.id && onProjectionUpdate && (
                        <button
                          onClick={() => onProjectionUpdate(p.id!, 'integrated')}
                          className="shrink-0 ml-2 p-1.5 rounded-full bg-alchemy-accent/20 text-alchemy-accent hover:bg-alchemy-accent/40 transition-colors"
                          title="标记为已整合"
                        >
                          <Check size={12} />
                        </button>
                      )}
                      {p.status === 'integrated' && (
                        <span className="shrink-0 ml-2 text-[10px] text-alchemy-accent/60">已整合</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Body: 3D Featured Gallery */}
      <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden px-4">
        <div className="relative w-full max-w-6xl h-[500px] flex items-center justify-center perspective-2000">
          <AnimatePresence mode="popLayout">
            {featured.map((a) => {
              const indexInAll = sorted.findIndex(item => item.id === a.id);
              const offset = indexInAll - activeIndex;
              
              const rotationY = -offset * 25;
              const x = offset * 260;
              const z = -Math.abs(offset) * 200;
              const scale = 1 - Math.abs(offset) * 0.15;
              const opacity = 1 - Math.abs(offset) * 0.4;
              const zIndex = 10 - Math.abs(offset);

              if (Math.abs(offset) > 2) return null;

              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: offset * 300, z: -500 }}
                  animate={{ 
                    opacity, 
                    x, 
                    z, 
                    rotateY: rotationY,
                    scale,
                    zIndex
                  }}
                  exit={{ opacity: 0, scale: 0.5, z: -500 }}
                  transition={{ 
                    duration: 0.6, 
                    type: "spring",
                    stiffness: 120,
                    damping: 20
                  }}
                  onClick={() => {
                    if (a.id !== activeId) {
                      setActiveId(a.id);
                    }
                  }}
                  className={cn(
                    "absolute w-[260px] h-[450px]",
                    a.id !== activeId && "cursor-pointer"
                  )}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <ArchetypeCard 
                    archetype={a} 
                    onTalk={onTalk} 
                    isActive={a.id === activeId}
                    onMarkSeen={onMarkSeen}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
