import React from 'react';
import { Flame, Moon } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface NavigationProps {
  activeTab: 'vessel' | 'mandala';
  setActiveTab: (tab: 'vessel' | 'mandala') => void;
}

export default function Navigation({ activeTab, setActiveTab }: NavigationProps) {
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
        onClick={() => setActiveTab('mandala')}
      />
    </nav>
  );
}

function TabItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: any;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 py-2 px-5 rounded-xl transition-all duration-300 min-w-[72px] active:scale-95",
        active ? "text-alchemy-accent" : "text-alchemy-paper/40"
      )}
    >
      <Icon size={24} />
      <span className="text-[9px] font-sans tracking-wide" style={{ fontWeight: 350 }}>{label}</span>
    </button>
  );
}
