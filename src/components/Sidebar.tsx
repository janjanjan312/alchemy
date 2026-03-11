import React, { useState, useEffect } from 'react';
import { Flame, Moon } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function useKeyboardVisible() {
  const [up, setUp] = useState(false);

  useEffect(() => {
    const isTextInput = (el: EventTarget | null): boolean =>
      el instanceof HTMLElement &&
      (el.tagName === 'TEXTAREA' || el.isContentEditable ||
       (el.tagName === 'INPUT' && !['checkbox','radio','button','submit','file','hidden','range'].includes((el as HTMLInputElement).type)));

    const onFocusIn = (e: FocusEvent) => { if (isTextInput(e.target)) setUp(true); };
    const onFocusOut = () => setTimeout(() => { if (!isTextInput(document.activeElement)) setUp(false); }, 80);

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return up;
}

interface NavigationProps {
  activeTab: 'vessel' | 'mandala';
  hasUpdates?: boolean;
  setActiveTab: (tab: 'vessel' | 'mandala') => void;
}

export default function Navigation({ activeTab, hasUpdates, setActiveTab }: NavigationProps) {
  const keyboardUp = useKeyboardVisible();

  return (
    <nav
      className={`bg-alchemy-black/80 backdrop-blur-2xl border-t border-white/5 flex items-center justify-around px-6 z-50 transition-all duration-200 ${
        keyboardUp ? 'h-0 !p-0 overflow-hidden opacity-0' : 'pt-1.5'
      }`}
      style={{ paddingBottom: keyboardUp ? 0 : 'max(0.25rem, env(safe-area-inset-bottom, 0.25rem))' }}
    >
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
        "flex flex-col items-center gap-0.5 transition-all duration-300 active:scale-95 relative",
        active
          ? "text-alchemy-accent"
          : hasUpdates
            ? "text-alchemy-paper/40 nav-glow"
            : "text-alchemy-paper/40"
      )}
    >
      <div className="relative">
        <Icon size={22} />
        {hasUpdates && (
          <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-alchemy-accent animate-pulse shadow-[0_0_6px_rgba(232,213,163,0.8)]" />
        )}
      </div>
      <span className="text-[10px] font-sans font-medium tracking-wide">{label}</span>
    </button>
  );
}
