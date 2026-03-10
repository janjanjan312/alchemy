import React from 'react';
import { Flame, Moon } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NavigationProps {
  activeTab: 'vessel' | 'mandala';
  hasUpdates?: boolean;
  setActiveTab: (tab: 'vessel' | 'mandala') => void;
}

export default function Navigation({ activeTab, hasUpdates, setActiveTab }: NavigationProps) {
  return (
    <nav className="absolute bottom-0 left-0 right-0 bg-alchemy-black/80 backdrop-blur-2xl border-t border-white/5 flex items-center justify-around px-6 z-50"
         style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)', height: 'calc(64px + env(safe-area-inset-bottom, 8px))' }}>
      <TabItem
        icon={Flame}
        label="炼金术室"
        active={activeTab === 'vessel'}
        onClick={() => setActiveTab('vessel')}
      />
      <TabItem
        icon={Moon}
        label="原型图谱"
        active={activeTab === 'mandala'}
        hasUpdates={activeTab !== 'mandala' && hasUpdates}
        onClick={() => setActiveTab('mandala')}
      />
    </nav>
  );
}

function TabItem({
  icon: Icon,
  label,
  active,
  hasUpdates,
  onClick,
}: {
  icon: any;
  label: string;
  active?: boolean;
  hasUpdates?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 py-2 px-5 rounded-xl transition-all duration-300 min-w-[72px] active:scale-95 relative",
        active
          ? "text-alchemy-accent"
          : hasUpdates
            ? "text-alchemy-paper/40 nav-glow"
            : "text-alchemy-paper/40"
      )}
    >
      <div className="relative">
        <Icon size={24} />
        {hasUpdates && (
          <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-alchemy-accent animate-pulse shadow-[0_0_6px_rgba(232,213,163,0.8)]" />
        )}
      </div>
      <span className="text-[9px] font-sans tracking-wide" style={{ fontWeight: 350 }}>{label}</span>
    </button>
  );
}
