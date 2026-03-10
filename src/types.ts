export interface Archetype {
  id: string;
  name: string;
  description: string;
  personalManifestation?: string;
  unlocked?: boolean;
  guidance?: string;
  image: string;
  recentlyUpdated?: boolean;
  updatedAt?: string;
}

export interface SymbolEntry {
  term: string;
  meaning: string;
}

export interface ProjectionEntry {
  id?: number;
  target: string;
  trait: string;
  archetype: string;
  status?: 'active' | 'integrated';
  created_at?: string;
}

export interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  isTranscribing?: boolean;
  insight?: {
    type: string;
    content: string;
  };
  symbol?: SymbolEntry;
  projection?: ProjectionEntry;
}

export type Mode = 'Projection Work' | 'Dream Weaver' | 'Active Imagination' | 'Free Talk';
