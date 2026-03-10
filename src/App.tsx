/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import Navigation from './components/Sidebar';
import Vessel from './components/Vessel';
import Mandala from './components/Mandala';
import Stars from './components/Stars';
import { Archetype, SymbolEntry, ProjectionEntry } from './types';
import { INITIAL_ARCHETYPES } from './constants';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'vessel' | 'mandala'>('vessel');
  const [archetypes, setArchetypes] = useState<Archetype[]>(INITIAL_ARCHETYPES);
  const [symbols, setSymbols] = useState<SymbolEntry[]>([]);
  const [projections, setProjections] = useState<ProjectionEntry[]>([]);
  const [openArchetypes, setOpenArchetypes] = useState<string[]>([]);
  const [activeArchetype, setActiveArchetype] = useState<string | null>(null);
  const [pendingUpdates, setPendingUpdates] = useState<{ insight: boolean; symbol: boolean; projection: boolean }>({ insight: false, symbol: false, projection: false });

  const handleContentUpdate = useCallback((type: 'insight' | 'symbol' | 'projection') => {
    setPendingUpdates(prev => ({ ...prev, [type]: true }));
  }, []);
  const [userId] = useState(() => {
    const key = 'psyche_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  });

  const fetchUserData = useCallback(async () => {
    try {
      const [symRes, projRes] = await Promise.all([
        fetch(`/api/symbols/${userId}`),
        fetch(`/api/projections/${userId}`),
      ]);
      setSymbols(await symRes.json());
      setProjections(await projRes.json());
    } catch {}
  }, [userId]);

  useEffect(() => {
    fetchProfile();
    fetchUserData();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch(`/api/profile/${userId}`);
      const data = await res.json();
      
      if (data.archetypes) {
        setArchetypes(prev => prev.map(a => {
          const dbData = data.archetypes.find((da: any) => da.archetype_id === a.id);
          if (dbData) {
            return {
              ...a,
              personalManifestation: dbData.personal_manifestation,
              unlocked: true,
              guidance: dbData.guidance,
              updatedAt: dbData.updated_at || undefined,
              recentlyUpdated: dbData.seen === 0,
            };
          }
          return a;
        }));
      }
    } catch (error) {
      console.error("Failed to fetch profile", error);
    }
  };

  const handleInsightArchive = async (archetypeId: string, content: string, guidance?: string) => {
    try {
      await fetch('/api/archive-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, archetypeId, content, guidance }),
      });
      await fetchProfile();
    } catch (error) {
      console.error("Failed to archive insight", error);
    }
  };

  const handleMarkSeen = (archetypeId: string) => {
    setArchetypes(prev => prev.map(a =>
      a.id === archetypeId ? { ...a, recentlyUpdated: false } : a
    ));
    fetch(`/api/archetype-seen/${userId}/${archetypeId}`, { method: 'PATCH' }).catch(() => {});
  };

  const handleProjectionUpdate = async (id: number, status: 'active' | 'integrated') => {
    try {
      await fetch(`/api/projections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      fetchUserData();
    } catch {}
  };

  const MAX_OPEN_ARCHETYPES = 5;

  const handleTalkToArchetype = (id: string) => {
    setOpenArchetypes(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      return next.length > MAX_OPEN_ARCHETYPES ? next.slice(-MAX_OPEN_ARCHETYPES) : next;
    });
    setActiveArchetype(id);
    setActiveTab('vessel');
  };

  const handleCloseArchetype = (id: string) => {
    setOpenArchetypes(prev => prev.filter(a => a !== id));
    setActiveArchetype(prev => prev === id ? null : prev);
  };

  return (
    <div className="flex flex-col h-full bg-alchemy-black overflow-hidden relative">
      <Stars />
      
      <Navigation activeTab={activeTab} hasUpdates={pendingUpdates.insight || pendingUpdates.symbol || pendingUpdates.projection} setActiveTab={(tab) => {
        setActiveTab(tab);
        if (tab === 'mandala') {
          setPendingUpdates({ insight: false, symbol: false, projection: false });
          fetchProfile();
          fetchUserData();
        }
      }} />
      
      <main className="flex-1 relative overflow-hidden" style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 8px))' }}>
        {/* Background Ambient Elements */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-alchemy-accent/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-alchemy-blue/30 rounded-full blur-[120px]" />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="h-full overflow-y-auto relative z-10"
          >
            {activeTab === 'vessel' ? (
              <Vessel
                userId={userId}
                onInsightArchive={handleInsightArchive}
                onContentUpdate={handleContentUpdate}
                openArchetypes={openArchetypes}
                activeArchetype={activeArchetype}
                onSelectArchetype={setActiveArchetype}
                onCloseArchetype={handleCloseArchetype}
              />
            ) : (
              <Mandala
                archetypes={archetypes}
                onTalk={handleTalkToArchetype}
                symbols={symbols}
                projections={projections}
                onProjectionUpdate={handleProjectionUpdate}
                onMarkSeen={handleMarkSeen}
                newSymbols={pendingUpdates.symbol}
                newProjections={pendingUpdates.projection}
                onPanelSeen={(panel) => setPendingUpdates(prev => ({ ...prev, [panel === 'symbols' ? 'symbol' : 'projection']: false }))}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
