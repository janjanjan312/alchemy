import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Send, Sparkles, Moon, Eye, Loader2, Mic, Keyboard, BookOpen, ScanEye, Menu, SquarePen, X, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Message, Mode, SymbolEntry, ProjectionEntry } from '../types';
import { chat, chatWithArchetype, SessionSummary, UserProfile, ArchetypeContext } from '../services/ai';
import { searchKnowledge } from '../services/embedding';
import { ARCHETYPE_PERSONAS } from '../services/archetypePersonas';
import { INITIAL_ARCHETYPES } from '../constants';
import { startRecording as startASRRecording, type PushToTalkController } from '../services/pushToTalk';
import { detectCrisis } from '../services/guardrails';
import CrisisModal from './CrisisModal';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ARCHETYPE_NAMES: Record<string, string> = Object.fromEntries(
  INITIAL_ARCHETYPES.map(a => [a.id, a.name])
);

const MODE_META: Record<string, { icon: typeof Eye; label: string }> = {
  'Projection Work': { icon: Eye, label: '投射' },
  'Dream Weaver': { icon: Moon, label: '梦境' },
  'Active Imagination': { icon: Sparkles, label: '积极想象' },
  'Free Talk': { icon: Sparkles, label: '探索' },
};

function formatTime(dateStr: string): string {
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function groupSessions(sessions: any[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const groups: { label: string; items: any[] }[] = [
    { label: '今天', items: [] },
    { label: '本周', items: [] },
    { label: '更早', items: [] },
  ];
  for (const s of sessions) {
    const norm = s.updated_at.includes('T') ? s.updated_at : s.updated_at.replace(' ', 'T') + 'Z';
    const d = new Date(norm);
    if (d >= today) groups[0].items.push(s);
    else if (d >= weekAgo) groups[1].items.push(s);
    else groups[2].items.push(s);
  }
  return groups.filter(g => g.items.length > 0);
}

const INITIAL_MESSAGES: Record<string, string> = {
  'Projection Work': '有些人会触发我们特别强烈的情绪——烦躁、崇拜、嫉妒或排斥。这往往映照着你内心尚未觉察的一面。\n\n**最近有没有谁让你情绪反应特别大？**',
  'Dream Weaver': '梦境是无意识最直接的语言，即使零碎的片段也藏着重要信息。\n\n**说说你最近印象深的一个梦吧**——场景、人物、情绪，想到什么说什么。',
  'Active Imagination': '找一个舒适的姿势，闭上眼睛，让注意力转向内在。不需要刻意控制，只需观察内心浮现的画面。\n\n当你准备好后，**描述你看到的**——什么场景？有谁？正在发生什么？',
  'Free Talk': '这里是一个安全自由的探索空间。近期的困惑、一段关系的纠结、对自己的好奇，或者只是想倾诉，都可以。\n\n**今天，你心里最想聊的是什么？**',
};

const TOPIC_POOL = [
  // Shadow: 投射与压抑的特质
  '我特别讨厌某个人身上的一个特质，但这种强烈的厌恶连我自己都觉得不正常',
  // Persona: 面具与真实自我的脱节
  '我在不同场合表现得像完全不同的人，有时候不确定哪个才是真实的我',
  // Anima/Animus: 关系中的投射模式
  '我总是被同一类型的人吸引，而且每次的结局都惊人地相似',
  // Animus/Anima: 内在批判之声
  '我脑海里经常有一个声音在评判我，告诉我做得还不够好',
  // Great Mother: 母亲情结
  '我和母亲的关系很复杂——既离不开又觉得窒息',
  // Father: 权威情结
  '我发现自己面对权威人物时，总会有一种本能的反应模式——要么反抗，要么过度顺从',
  // Hero: 英雄之旅与考验
  '我正面对一个重大的人生抉择，感觉这个选择会定义「我是谁」',
  // Puer Aeternus: 永恒少年与落地困难
  '我有很多计划和灵感，但总是难以坚持到底，好像一旦开始就失去了兴趣',
  // Child: 内在小孩与童年创伤
  '某些童年的场景会突然闪回，带来和当时一样强烈的情绪',
  // Trickster: 用幽默回避深层议题
  '我习惯用幽默来化解一切，但最近意识到这可能让我一直在回避某些东西',
  // Self: 整合与顿悟
  '我偶尔会有一种「顿悟」的瞬间，好像突然看到了自己生活中某个一直重复的模式',
  // Wise Old Man: 内在智慧与直觉
  '在迷茫的时候，我心里好像有个更深层的声音知道该怎么走，但我总是不敢信任它',
];

function getRandomTopics(count: number): string[] {
  const shuffled = [...TOPIC_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function dbMsgToMessage(m: any): Message {
  const extras = m.extras ? JSON.parse(m.extras) : {};
  return {
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    insight: m.insight_type ? { type: m.insight_type, content: m.insight_content } : undefined,
    symbol: extras.symbol,
    projection: extras.projection,
  };
}

async function persistMsg(sessionId: string, userId: string, msg: Message, mode: Mode) {
  const extras: Record<string, unknown> = {};
  if (msg.symbol) extras.symbol = msg.symbol;
  if (msg.projection) extras.projection = msg.projection;

  try {
    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        role: msg.role,
        content: msg.content,
        mode,
        insightType: msg.insight?.type,
        insightContent: msg.insight?.content,
        extras: Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
      }),
    });
  } catch (e) {
    console.error('Failed to persist message:', e);
  }
}

interface ArchetypeSession {
  messages: Message[];
  ctx: ArchetypeContext | null;
}

interface VesselProps {
  userId: string;
  onInsightArchive: (archetypeId: string, content: string, guidance?: string) => void;
  onContentUpdate?: (type: 'insight' | 'symbol' | 'projection') => void;
  openArchetypes?: string[];
  activeArchetype?: string | null;
  onSelectArchetype?: (id: string | null) => void;
  onCloseArchetype?: (id: string) => void;
}

export default function Vessel({ userId, onInsightArchive, onContentUpdate, openArchetypes = [], activeArchetype, onSelectArchetype, onCloseArchetype }: VesselProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [mode, _setMode] = useState<Mode>(() => {
    return (localStorage.getItem('alchemy_last_mode') as Mode) || 'Free Talk';
  });
  const setMode = useCallback((m: Mode) => {
    localStorage.setItem('alchemy_last_mode', m);
    _setMode(m);
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [inputMethod, setInputMethod] = useState<'voice' | 'text'>('voice');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [userSymbols, setUserSymbols] = useState<SymbolEntry[]>([]);
  const [userProjections, setUserProjections] = useState<ProjectionEntry[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [showCrisisModal, setShowCrisisModal] = useState(false);
  const [suggestedTopics] = useState(() => getRandomTopics(3));
  const [savedProjections, setSavedProjections] = useState<Set<string>>(new Set());
  const [savedInsights, setSavedInsights] = useState<Set<string>>(new Set());
  const [savedSymbols, setSavedSymbols] = useState<Set<string>>(new Set());
  const [tabOrder, setTabOrder] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('alchemy_tab_order') || '{}'); } catch { return {}; }
  });
  const [historySummaries, setHistorySummaries] = useState<SessionSummary[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const archetypeSessions = useRef<Map<string, ArchetypeSession>>(new Map());
  const skipNextModeLoad = useRef(false);
  const normalMessages = useRef<{ mode: Mode; messages: Message[]; sessionId: string | null } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const scrollRef = useRef<HTMLDivElement>(null);
  const modeBarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pushToTalkRef = useRef<PushToTalkController | null>(null);

  const isArchetypeActive = !!activeArchetype && openArchetypes.includes(activeArchetype);

  useEffect(() => {
    (async () => {
      try {
        const [symRes, projRes, profileRes] = await Promise.all([
          fetch(`/api/symbols/${userId}`),
          fetch(`/api/projections/${userId}`),
          fetch(`/api/profile/${userId}`),
        ]);
        const syms = await symRes.json();
        const projs = await projRes.json();
        const profile = await profileRes.json();
        setUserSymbols(syms);
        setUserProjections(projs);

        setSavedSymbols(new Set(syms.map((s: any) => s.term)));
        setSavedProjections(new Set(
          projs.map((p: any) => `${p.target}|${p.trait}|${p.archetype}`)
        ));

        if (profile?.archetypes) {
          const keys = new Set<string>();
          for (const a of profile.archetypes) {
            if (a.personal_manifestation) {
              for (const line of a.personal_manifestation.split('\n').filter(Boolean)) {
                keys.add(`${a.archetype_id}|${line}`);
              }
            }
          }
          setSavedInsights(keys);
        }
      } catch {}
    })();
  }, [userId]);

  useEffect(() => {
    if (!isArchetypeActive || !activeArchetype) {
      if (normalMessages.current) {
        setMessages(normalMessages.current.messages);
        setSessionId(normalMessages.current.sessionId);
        normalMessages.current = null;
      }
      return;
    }

    if (!normalMessages.current) {
      normalMessages.current = { mode, messages, sessionId };
    }

    const existing = archetypeSessions.current.get(activeArchetype);
    if (existing) {
      setMessages(existing.messages);
      setSessionLoading(false);
    } else {
      const persona = ARCHETYPE_PERSONAS[activeArchetype];
      if (!persona) return;
      const greeting: Message = { role: 'model', content: persona.greeting, timestamp: new Date().toISOString() };
      setMessages([greeting]);
      setSessionId(null);
      setSessionLoading(true);

      (async () => {
        try {
          const res = await fetch(`/api/archetype-context/${userId}/${activeArchetype}`);
          const ctx = await res.json();
          archetypeSessions.current.set(activeArchetype, { messages: [greeting], ctx });
        } catch {
          archetypeSessions.current.set(activeArchetype, { messages: [greeting], ctx: null });
        }
        setSessionLoading(false);
      })();
    }

    requestAnimationFrame(() => {
      if (modeBarRef.current) {
        modeBarRef.current.scrollTo({ left: modeBarRef.current.scrollWidth, behavior: 'smooth' });
      }
    });
  }, [activeArchetype, isArchetypeActive, userId]);

  function makeGreeting(m: Mode): Message {
    return { role: 'model', content: INITIAL_MESSAGES[m], timestamp: new Date().toISOString() };
  }

  useEffect(() => {
    if (isArchetypeActive) return;
    if (skipNextModeLoad.current) {
      skipNextModeLoad.current = false;
      return;
    }
    let cancelled = false;

    (async () => {
      setSessionLoading(true);
      setMessages([]);

      try {
        const [sessionRes, summaryRes, profileRes] = await Promise.all([
          fetch(`/api/sessions/${userId}?mode=${encodeURIComponent(mode)}`),
          fetch(`/api/summaries/${userId}?limit=3`),
          fetch(`/api/user-profile/${userId}`),
        ]);
        const sessions = await sessionRes.json();
        const summaries = await summaryRes.json();
        const profile = await profileRes.json();
        if (cancelled) return;

        setHistorySummaries(summaries);
        setUserProfile(profile);

        if (sessions.length > 0) {
          const sid = sessions[0].id;
          const msgRes = await fetch(`/api/sessions/${sid}/messages`);
          const dbMessages = await msgRes.json();
          if (cancelled) return;

          if (dbMessages.length > 0) {
            setSessionId(sid);
            setMessages(dbMessages.map(dbMsgToMessage));
            setSessionLoading(false);
            return;
          }
        }

        setSessionId(null);
        setMessages([makeGreeting(mode)]);
      } catch (e) {
        console.error('Session load failed:', e);
        if (!cancelled) {
          setSessionId(null);
          setMessages([makeGreeting(mode)]);
        }
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [mode, userId]);

  const prevMsgLen = useRef(0);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const added = messages.length - prevMsgLen.current;
    prevMsgLen.current = messages.length;

    const isBatchLoad = added > 1 || added < 0;

    const doScroll = () => {
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: isBatchLoad ? 'instant' : 'smooth' });
    };

    doScroll();
    if (isBatchLoad) {
      const timer = setTimeout(doScroll, 550);
      return () => clearTimeout(timer);
    }
  }, [messages, isThinking]);

  useEffect(() => {
    if (inputMethod === 'text' && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input, inputMethod]);

  const pendingUserMsgs = useRef<Message[]>([]);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const BATCH_DELAY = 1500;

  const triggerReply = useCallback(async () => {
    const batch = pendingUserMsgs.current;
    pendingUserMsgs.current = [];
    if (batch.length === 0) return;

    const tabId = isArchetypeActive && activeArchetype ? activeArchetype : mode;
    setTabOrder(prev => {
      const next = { ...prev, [tabId]: Date.now() };
      localStorage.setItem('alchemy_tab_order', JSON.stringify(next));
      return next;
    });

    setIsLoading(true);

    let sid = sessionId;
    if (!sid && !isArchetypeActive) {
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, mode }),
        });
        const ns = await res.json();
        sid = ns.id;
        setSessionId(sid);
        const greeting = makeGreeting(mode);
        await persistMsg(sid!, userId, greeting, mode);
      } catch {
        sid = null;
      }
    }

    for (const um of batch) {
      if (sid) persistMsg(sid, userId, um, mode);
    }

    const combinedInput = batch.map(m => m.content).join('\n');
    const isCrisis = detectCrisis(combinedInput);
    if (isCrisis) setShowCrisisModal(true);

    try {
      let modelMsg: Message;
      const knowledgeChunks = isCrisis ? [] : await searchKnowledge(combinedInput, 3).catch(() => []);

      const currentMessages = messagesRef.current;
      const historyMessages = currentMessages.slice(0, currentMessages.length - batch.length);
      if (isArchetypeActive && activeArchetype) {
        const session = archetypeSessions.current.get(activeArchetype);
        const persona = ARCHETYPE_PERSONAS[activeArchetype];
        const text = await chatWithArchetype(
          persona.voice,
          session?.ctx || { archetype: null, projections: [], symbols: [], profile: null, recentSummaries: [] },
          historyMessages,
          combinedInput,
        );
        modelMsg = { role: 'model', content: text, timestamp: new Date().toISOString() };
      } else {
        const { text, insight, symbol, projection } = await chat({
          messages: historyMessages,
          mode,
          userInput: combinedInput,
          userSymbols,
          userProjections,
          isCrisis,
          historySummaries,
          userProfile,
          knowledgeChunks,
        });
        const isDuplicateProjection = projection && currentMessages.some(
          m => m.projection && m.projection.target === projection.target && m.projection.trait === projection.trait
        );
        modelMsg = { role: 'model', content: text, timestamp: new Date().toISOString(), insight, symbol, projection: isDuplicateProjection ? undefined : projection };
      }

      setMessages(prev => {
        const updated = [...prev, modelMsg];
        if (isArchetypeActive && activeArchetype) {
          const session = archetypeSessions.current.get(activeArchetype);
          if (session) session.messages = updated;
        }
        return updated;
      });
      if (sid) persistMsg(sid, userId, modelMsg, mode);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        role: 'model',
        content: "抱歉，我现在无法连接到深层意识。请稍后再试。",
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
      if (pendingUserMsgs.current.length > 0) {
        replyTimer.current = setTimeout(() => {
          triggerReply();
        }, BATCH_DELAY);
      } else {
        setIsThinking(false);
      }
    }
  }, [mode, sessionId, userId, historySummaries, userProfile, isArchetypeActive, activeArchetype, userSymbols, userProjections]);

  const handleSend = useCallback(async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim()) return;

    const userMsg: Message = {
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => {
      const updated = [...prev, userMsg];
      if (isArchetypeActive && activeArchetype) {
        const session = archetypeSessions.current.get(activeArchetype);
        if (session) session.messages = updated;
      }
      return updated;
    });
    flushSync(() => setInput(''));
    setIsThinking(true);

    pendingUserMsgs.current.push(userMsg);

    if (!isLoading) {
      if (replyTimer.current) clearTimeout(replyTimer.current);
      replyTimer.current = setTimeout(() => {
        triggerReply();
      }, BATCH_DELAY);
    }
  }, [input, isLoading, isArchetypeActive, activeArchetype, triggerReply]);

  const startRecording = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsRecording(true);

    try {
      pushToTalkRef.current = await startASRRecording('zh');
    } catch (err) {
      console.error('Recording failed:', err);
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isRecording) return;
    setIsRecording(false);
    setIsTranscribing(true);

    const placeholderMsg: Message = {
      role: 'user',
      content: '',
      timestamp: new Date().toISOString(),
      isTranscribing: true,
    };
    setMessages(prev => {
      const updated = [...prev, placeholderMsg];
      if (isArchetypeActive && activeArchetype) {
        const session = archetypeSessions.current.get(activeArchetype);
        if (session) session.messages = updated;
      }
      return updated;
    });

    try {
      const text = await pushToTalkRef.current?.stop();
      pushToTalkRef.current = null;

      if (text?.trim()) {
        const finalMsg: Message = { ...placeholderMsg, content: text, isTranscribing: false };
        setMessages(prev => {
          const updated = prev.map(m => m === placeholderMsg ? finalMsg : m);
          if (isArchetypeActive && activeArchetype) {
            const session = archetypeSessions.current.get(activeArchetype);
            if (session) session.messages = updated;
          }
          return updated;
        });
        setIsTranscribing(false);
        setIsThinking(true);

        pendingUserMsgs.current.push(finalMsg);
        if (!isLoading) {
          if (replyTimer.current) clearTimeout(replyTimer.current);
          triggerReply();
        }
      } else {
        setMessages(prev => prev.filter(m => m !== placeholderMsg));
        setIsTranscribing(false);
      }
    } catch (err) {
      console.error('Stop recording failed:', err);
      setMessages(prev => prev.filter(m => m !== placeholderMsg));
      setIsTranscribing(false);
      pushToTalkRef.current = null;
    }
  }, [isRecording, isLoading, isArchetypeActive, activeArchetype, triggerReply]);

  const openSidebar = useCallback(async () => {
    setShowSidebar(true);
    try {
      const res = await fetch(`/api/sessions/${userId}`);
      setAllSessions(await res.json());
    } catch {}
  }, [userId]);

  const loadSessionById = useCallback(async (sid: string, sessionMode: string) => {
    if (sid === sessionId) { setShowSidebar(false); return; }
    setShowSidebar(false);
    if (sessionMode !== mode) {
      skipNextModeLoad.current = true;
      setMode(sessionMode as Mode);
    }
    setSessionLoading(true);
    setMessages([]);
    try {
      const msgRes = await fetch(`/api/sessions/${sid}/messages`);
      const dbMessages = await msgRes.json();
      setSessionId(sid);
      setMessages(dbMessages.length > 0 ? dbMessages.map(dbMsgToMessage) : [makeGreeting(sessionMode as Mode)]);
    } catch {
      setMessages([makeGreeting(sessionMode as Mode)]);
    } finally {
      setSessionLoading(false);
    }
  }, [userId, mode, sessionId]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
      setAllSessions(prev => prev.filter(s => s.id !== sid));
      if (sid === sessionId) {
        setSessionId(null);
        setMessages([makeGreeting(mode)]);
      }
    } catch {}
  }, [sessionId, mode]);

  const summarizeSession = useCallback((sid: string) => {
    fetch(`/api/sessions/${sid}/summarize`, { method: 'POST' }).catch(() => {});
  }, []);

  const handleNewChat = useCallback(async () => {
    if (sessionId) summarizeSession(sessionId);

    setShowSidebar(false);
    setSessionLoading(true);
    setMessages([]);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, mode }),
      });
      const ns = await res.json();
      const greeting = makeGreeting(mode);
      setSessionId(ns.id);
      setMessages([greeting]);
      await persistMsg(ns.id, userId, greeting, mode);

      const [sumRes, profRes] = await Promise.all([
        fetch(`/api/summaries/${userId}?limit=3`),
        fetch(`/api/user-profile/${userId}`),
      ]);
      setHistorySummaries(await sumRes.json());
      setUserProfile(await profRes.json());
    } catch {
      setMessages([makeGreeting(mode)]);
    } finally {
      setSessionLoading(false);
    }
  }, [mode, userId, sessionId, summarizeSession]);

  const handleSaveSymbol = useCallback(async (term: string, meaning: string) => {
    if (savedSymbols.has(term)) return;
    setSavedSymbols(prev => new Set(prev).add(term));
    try {
      await fetch('/api/symbols', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, term, meaning }),
      });
      setUserSymbols(prev => {
        const idx = prev.findIndex(s => s.term === term);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { term, meaning };
          return updated;
        }
        return [...prev, { term, meaning }];
      });
      onContentUpdate?.('symbol');
    } catch (e) {
      console.error('Failed to save symbol:', e);
      setSavedSymbols(prev => { const next = new Set(prev); next.delete(term); return next; });
    }
  }, [userId, savedSymbols, onContentUpdate]);

  const handleSaveProjection = useCallback(async (target: string, trait: string, archetype: string) => {
    const key = `${target}|${trait}|${archetype}`;
    if (savedProjections.has(key)) return;
    try {
      await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, target, trait, archetypeId: archetype }),
      });
      setUserProjections(prev => [...prev, { target, trait, archetype, status: 'active' as const }]);
      setSavedProjections(prev => new Set(prev).add(key));

      const insightText = `[投射] 在「${target}」身上识别到「${trait}」的投射`;
      const archetypeName = ARCHETYPE_NAMES[archetype] || archetype;
      const guidanceText = `留意你对「${target}」的「${trait}」感受——它可能映射着你与内在${archetypeName}的未完成对话。今天试着问自己：这份感受最早出现在什么时候？`;
      onInsightArchive(archetype, insightText, guidanceText);
      onContentUpdate?.('projection');
    } catch (e) {
      console.error('Failed to save projection:', e);
    }
  }, [userId, savedProjections, onInsightArchive, onContentUpdate]);

  const handleSaveInsight = useCallback(async (archetypeId: string, content: string) => {
    const key = `${archetypeId}|${content}`;
    if (savedInsights.has(key)) return;
    setSavedInsights(prev => new Set(prev).add(key));
    const archetypeName = ARCHETYPE_NAMES[archetypeId] || archetypeId;
    const guidanceText = `你发现了关于内在「${archetypeName}」的重要洞察。今天试着留意生活中与这份觉察相呼应的时刻。`;
    onInsightArchive(archetypeId, content, guidanceText);
    onContentUpdate?.('insight');
  }, [savedInsights, onInsightArchive, onContentUpdate]);

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto px-3 lg:px-4">
      {/* Mode Switcher */}
      <div ref={modeBarRef} className="flex items-center justify-center gap-2 lg:gap-4 py-4 lg:py-6 overflow-x-auto no-scrollbar">
        {!isArchetypeActive && (
          <button
            onClick={openSidebar}
            className="p-2.5 rounded-full text-alchemy-paper/40 hover:text-alchemy-accent transition-colors"
          >
            <Menu size={20} />
          </button>
        )}
        {(() => {
          const modeTabs = [
            { id: 'Free Talk', icon: Sparkles, label: '探索', type: 'mode' as const },
            { id: 'Projection Work', icon: Eye, label: '投射', type: 'mode' as const },
            { id: 'Dream Weaver', icon: Moon, label: '梦境', type: 'mode' as const },
          ];
          const archTabs = openArchetypes.map(archId => ({
            id: archId, icon: Users, label: ARCHETYPE_NAMES[archId] || archId, type: 'archetype' as const,
          }));
          const all = [...modeTabs, ...archTabs];
          const activeTabId = isArchetypeActive ? activeArchetype : mode;
          const sorted = [...all].sort((a, b) => (tabOrder[b.id] || 0) - (tabOrder[a.id] || 0));
          return sorted.map(tab => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.type === 'archetype' ? `arch-${tab.id}` : tab.id}
                onClick={() => {
                  if (tab.type === 'archetype') onSelectArchetype?.(tab.id);
                  else { onSelectArchetype?.(null); setMode(tab.id as Mode); }
                }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-full transition-all duration-500 text-[13px] whitespace-nowrap",
                  isActive
                    ? "bg-alchemy-accent text-alchemy-black shadow-[0_0_15px_rgba(232,213,163,0.3)]"
                    : "bg-white/5 text-alchemy-paper/60 hover:bg-white/10"
                )}
              >
                <tab.icon size={tab.type === 'archetype' ? 16 : 18} />
                <span className="font-sans font-normal tracking-wider">{tab.label}</span>
                {tab.type === 'archetype' && (
                  <X
                    size={14}
                    className="ml-1 opacity-60 hover:opacity-100 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseArchetype?.(tab.id);
                      archetypeSessions.current.delete(tab.id);
                    }}
                  />
                )}
              </button>
            );
          });
        })()}
      </div>

      {/* Chat Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-6 lg:space-y-8 py-4 lg:py-8 no-scrollbar"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex flex-col",
                msg.role === 'user' ? "items-end" : "items-start"
              )}
            >
              <div className={cn(
                "max-w-[90%] lg:max-w-[85%] rounded-2xl px-4 lg:px-6 py-3 lg:py-4",
                msg.role === 'user' 
                  ? "bg-alchemy-accent/10 border border-alchemy-accent/20 text-alchemy-paper" 
                  : "bg-white/5 border border-white/10 text-alchemy-paper/90"
              )}>
                {msg.isTranscribing ? (
                  <div className="flex items-center gap-1.5 py-1">
                    <span className="w-2 h-2 rounded-full bg-alchemy-accent/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-alchemy-accent/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-alchemy-accent/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                ) : (
                <div className="prose prose-sm prose-invert max-w-none font-normal text-[14px] leading-relaxed opacity-90 [&>p+p]:mt-4">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                )}
              </div>
              
              {msg.insight && messages.findIndex(m => m.insight?.type === msg.insight!.type && m.insight?.content === msg.insight!.content) === i && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mt-4 p-4 rounded-xl border border-alchemy-accent/40 bg-alchemy-accent/5 max-w-[280px] lg:max-w-xs"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={16} className="text-alchemy-accent" />
                    <span className="text-xs uppercase tracking-widest font-sans font-bold text-alchemy-accent">新洞察</span>
                  </div>
                  <p className="text-[14px] font-normal italic mb-3 opacity-80">"{msg.insight.content}"</p>
                  <button 
                    onClick={() => handleSaveInsight(msg.insight!.type, msg.insight!.content)}
                    disabled={savedInsights.has(`${msg.insight.type}|${msg.insight.content}`)}
                    className={cn(
                      "w-full py-2.5 rounded-xl text-sm font-sans font-semibold transition-all",
                      savedInsights.has(`${msg.insight.type}|${msg.insight.content}`)
                        ? "bg-alchemy-accent/10 text-alchemy-accent/60 border border-alchemy-accent/20 cursor-default"
                        : "bg-[rgba(232,213,163,0.06)] text-alchemy-accent border border-alchemy-accent/20 backdrop-blur-lg hover:bg-[rgba(232,213,163,0.1)]"
                    )}
                  >
                    {savedInsights.has(`${msg.insight.type}|${msg.insight.content}`) ? '已归档 ✓' : '确认归档'}
                  </button>
                </motion.div>
              )}

              {msg.symbol && messages.findIndex(m => m.symbol?.term === msg.symbol!.term) === i && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mt-4 p-4 rounded-xl border border-alchemy-accent/25 bg-alchemy-accent/5 max-w-[280px] lg:max-w-xs"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen size={16} className="text-alchemy-accent/85" />
                    <span className="text-xs uppercase tracking-widest font-sans font-bold text-alchemy-accent/85">新象征</span>
                  </div>
                  <p className="text-[14px] font-normal mb-1 text-alchemy-paper">
                    「{msg.symbol.term}」
                  </p>
                  <p className="text-[13px] font-normal italic mb-3 opacity-60">{msg.symbol.meaning}</p>
                  <button
                    onClick={() => handleSaveSymbol(msg.symbol!.term, msg.symbol!.meaning)}
                    disabled={savedSymbols.has(msg.symbol.term)}
                    className={cn(
                      "w-full py-2.5 rounded-xl text-sm font-sans font-bold transition-all",
                      savedSymbols.has(msg.symbol.term)
                        ? "bg-alchemy-accent/5 text-alchemy-accent/50 border border-alchemy-accent/15 cursor-default"
                        : "bg-alchemy-accent/15 text-alchemy-accent border border-alchemy-accent/30 hover:bg-alchemy-accent/25"
                    )}
                  >
                    {savedSymbols.has(msg.symbol.term) ? '已存入 ✓' : '存入词典'}
                  </button>
                </motion.div>
              )}

              {msg.projection && messages.findIndex(m => m.projection && `${m.projection.target}|${m.projection.trait}|${m.projection.archetype}` === `${msg.projection!.target}|${msg.projection!.trait}|${msg.projection!.archetype}`) === i && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mt-4 p-4 rounded-xl border border-alchemy-accent/15 bg-[rgba(232,213,163,0.02)] backdrop-blur-sm max-w-[280px] lg:max-w-xs"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ScanEye size={16} className="text-alchemy-accent/70" />
                    <span className="text-xs uppercase tracking-widest font-sans font-bold text-alchemy-accent/70">投射识别</span>
                  </div>
                  <div className="space-y-1 mb-3">
                    <p className="text-[13px] font-normal text-alchemy-paper/80">
                      <span className="text-white/40">对象</span> {msg.projection.target}
                    </p>
                    <p className="text-[13px] font-normal text-alchemy-paper/80">
                      <span className="text-white/40">特质</span> {msg.projection.trait}
                    </p>
                    <p className="text-[13px] font-normal text-alchemy-paper/80">
                      <span className="text-white/40">原型</span> {msg.projection.archetype}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSaveProjection(msg.projection!.target, msg.projection!.trait, msg.projection!.archetype)}
                    disabled={savedProjections.has(`${msg.projection.target}|${msg.projection.trait}|${msg.projection.archetype}`)}
                    className={cn(
                      "w-full py-2.5 rounded-xl text-sm font-sans font-semibold transition-all",
                      savedProjections.has(`${msg.projection.target}|${msg.projection.trait}|${msg.projection.archetype}`)
                        ? "bg-[rgba(232,213,163,0.02)] text-alchemy-accent/30 border border-alchemy-accent/6 cursor-default"
                        : "bg-[rgba(232,213,163,0.06)] text-alchemy-accent border border-alchemy-accent/20 backdrop-blur-lg hover:bg-[rgba(232,213,163,0.1)]"
                    )}
                  >
                    {savedProjections.has(`${msg.projection.target}|${msg.projection.trait}|${msg.projection.archetype}`)
                      ? '已归档 ✓'
                      : '确认归档'}
                  </button>
                </motion.div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        
        {mode === 'Free Talk' && !isArchetypeActive && messages.length <= 1 && !isThinking && (
          <div className="flex flex-col gap-2 items-start">
            {suggestedTopics.map((topic, i) => (
              <button
                key={i}
                onClick={() => handleSend(topic)}
                className="text-left text-[13px] text-alchemy-paper/60 px-4 py-2.5 rounded-2xl border border-white/8 bg-white/3 hover:bg-white/8 hover:border-alchemy-accent/20 hover:text-alchemy-paper/80 transition-all"
              >
                {topic}
              </button>
            ))}
          </div>
        )}

        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 lg:px-6 py-3 lg:py-4 flex items-center gap-3">
              <Loader2 className="animate-spin text-alchemy-accent" size={16} />
              <span className="text-[14px] font-normal italic opacity-60">炼金术师正在沉思...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="pb-1 lg:pb-2 pt-2">
        <div className="relative flex items-end gap-2 bg-white/5 border border-white/10 rounded-3xl p-2 transition-all focus-within:border-alchemy-accent/40">
          <button
            onClick={() => setInputMethod(inputMethod === 'voice' ? 'text' : 'voice')}
            className="p-3 rounded-full text-alchemy-paper/40 hover:text-alchemy-accent transition-colors"
          >
            {inputMethod === 'voice' ? <Keyboard size={20} /> : <Mic size={20} />}
          </button>

          <div className="flex-1 min-h-[48px] flex items-center">
            {inputMethod === 'voice' ? (
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={isTranscribing}
                className={cn(
                  "w-full py-3 px-4 text-left text-alchemy-paper/40 font-normal italic flex items-center gap-3 group text-[14px] select-none transition-all",
                  isRecording && "bg-alchemy-accent/10 text-alchemy-accent",
                  isTranscribing && "opacity-50"
                )}
              >
                <div className={cn(
                  "w-2.5 h-2.5 rounded-full bg-alchemy-accent",
                  isRecording && "animate-ping"
                )} />
                {isRecording ? "正在倾听你的内心 (松手发送)..." : isTranscribing ? "正在转录..." : "长按倾听你的内心..."}
              </button>
            ) : (
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="输入你的感悟..."
                rows={1}
                className="w-full bg-transparent border-none focus:ring-0 focus:outline-none py-3 px-2 resize-none font-sans font-normal text-[14px] placeholder:opacity-30 max-h-32 overflow-y-auto"
              />
            )}
          </div>

          {inputMethod === 'text' && (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-3.5 rounded-full bg-alchemy-accent text-alchemy-black hover:scale-110 transition-transform disabled:opacity-50 disabled:scale-100 shadow-[0_0_15px_rgba(232,213,163,0.3)]"
            >
              <Send size={20} />
            </button>
          )}
        </div>
      </div>
      {/* Crisis Modal */}
      <AnimatePresence>
        {showCrisisModal && <CrisisModal onClose={() => setShowCrisisModal(false)} />}
      </AnimatePresence>

      {/* Session Sidebar */}
      {createPortal(
        <AnimatePresence>
          {showSidebar && (
            <>
              <motion.div
                className="absolute inset-0 bg-black/60 z-[100]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSidebar(false)}
              />
              <motion.div
                className="absolute left-0 top-0 bottom-0 w-[280px] bg-[#0a0a0a] border-r border-white/10 z-[101] flex flex-col"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-5 pb-3">
                  <button
                    onClick={() => setShowSidebar(false)}
                    className="p-2 rounded-full text-white/40 hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* New Chat */}
                <button
                  onClick={handleNewChat}
                  className="mx-4 mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-alchemy-paper/80 hover:bg-white/10 transition-colors"
                >
                  <SquarePen size={16} />
                  <span className="text-[14px]">新建对话</span>
                </button>

                {/* Session List */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-6">
                  {groupSessions(allSessions).map((group) => (
                    <div key={group.label} className="mb-4">
                      <div className="px-3 py-1.5 text-[11px] text-white/30 font-sans">{group.label}</div>
                      {group.items.map((s: any) => {
                        const meta = MODE_META[s.mode] || MODE_META['Projection Work'];
                        const Icon = meta.icon;
                        const isActive = s.id === sessionId;
                        return (
                          <button
                            key={s.id}
                            onClick={() => loadSessionById(s.id, s.mode)}
                            className={cn(
                              "w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-0.5 group",
                              isActive ? "bg-white/10 text-alchemy-paper" : "text-white/50 hover:bg-white/5"
                            )}
                          >
                            <Icon size={14} className="shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] truncate">
                                {s.preview || meta.label}
                              </p>
                              <p className="text-[11px] text-white/25 mt-0.5">{formatTime(s.updated_at)}</p>
                            </div>
                            <span
                              onClick={(e) => handleDeleteSession(e, s.id)}
                              className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/30 hover:text-red-400 transition-all"
                            >
                              <X size={12} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {allSessions.length === 0 && (
                    <p className="text-center text-[13px] text-white/20 italic mt-8">暂无历史对话</p>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.getElementById('root')!
      )}
    </div>
  );
}
