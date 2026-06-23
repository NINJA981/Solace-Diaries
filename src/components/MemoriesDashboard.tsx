import React, { useState, useEffect } from 'react';
import { Brain, Heart, Sparkles, Send, CheckCircle, Clock, Target, Users, Compass, Activity, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { API_BASE } from '../api';
import MemoryConstellation from './MemoryConstellation';

interface MemoryFragment {
  id: string;
  category: string;
  content: string;
  strength: number;
  updatedAt: string;
}

interface ProactivePrompt {
  id: string;
  promptText: string;
  triggerType: string;
  createdAt: string;
}

interface DurableMemory {
  id: string;
  content: string;
  confidence: number;
  updatedAt: string;
}

interface MemoriesDashboardProps {
  token: string;
}

export default function MemoriesDashboard({ token }: MemoriesDashboardProps) {
  const [memories, setMemories] = useState<MemoryFragment[]>([]);
  const [durableMemories, setDurableMemories] = useState<DurableMemory[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<ProactivePrompt | null>(null);
  const [reflection, setReflection] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetchData();
  }, [token]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [memRes, promptRes, durableRes, reflectionRes] = await Promise.all([
        fetch(`${API_BASE}/api/memories/active`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/memories/pending-prompt`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/memories/durable`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/memories/reflection`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (memRes.ok) {
        setMemories(await memRes.json());
      }
      if (promptRes.ok) {
        setPendingPrompt(await promptRes.json());
      }
      if (durableRes.ok) {
        setDurableMemories(await durableRes.json());
      }
      if (reflectionRes.ok) {
        const refData = await reflectionRes.json();
        setReflection(refData.reflection || '');
      }
    } catch (err) {
      console.error('Failed to load memories', err);
    } finally {
      setLoading(false);
    }
  };

  const submitResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPrompt || !response.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/memories/prompt/${pendingPrompt.id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ responseText: response })
      });
      if (res.ok) {
        setSubmitted(true);
        setTimeout(() => setPendingPrompt(null), 2000);
      }
    } catch (err) {
      console.error('Failed to submit response', err);
    } finally {
      setSubmitting(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'ambition': return <Target className="w-4 h-4 text-[var(--accent-color)]" />;
      case 'relationship': return <Users className="w-4 h-4 text-[var(--accent-color)]" />;
      case 'emotional_trend': return <Heart className="w-4 h-4 text-[var(--accent-heart)]" />;
      case 'life_event': return <CalendarDays className="w-4 h-4 text-[var(--accent-heart)]" />;
      case 'unfinished_goal': return <Clock className="w-4 h-4 text-[var(--text-muted)]" />;
      case 'milestone': return <Sparkles className="w-4 h-4 text-[var(--accent-heart)]" />;
      case 'behavioral_pattern': return <Activity className="w-4 h-4 text-[var(--accent-color)]" />;
      default: return <Compass className="w-4 h-4 text-[var(--accent-color)]" />;
    }
  };

  const getCategoryColorClass = (category: string) => {
    switch (category) {
      case 'ambition': return 'border-[var(--accent-color)]/10 bg-[var(--accent-color)]/[0.02] hover:bg-[var(--accent-color)]/[0.04] shadow-sm';
      case 'relationship': return 'border-[var(--accent-color)]/10 bg-[var(--accent-color)]/[0.02] hover:bg-[var(--accent-color)]/[0.04] shadow-sm';
      case 'emotional_trend': return 'border-[var(--accent-heart)]/10 bg-[var(--accent-heart)]/[0.02] hover:bg-[var(--accent-heart)]/[0.04] shadow-sm';
      case 'life_event': return 'border-[var(--accent-heart)]/10 bg-[var(--accent-heart)]/[0.02] hover:bg-[var(--accent-heart)]/[0.04] shadow-sm';
      case 'unfinished_goal': return 'border-stone-500/10 bg-stone-500/[0.02] hover:bg-stone-500/[0.04] shadow-sm';
      case 'milestone': return 'border-[var(--accent-heart)]/10 bg-[var(--accent-heart)]/[0.02] hover:bg-[var(--accent-heart)]/[0.04] shadow-sm';
      default: return 'border-[var(--accent-color)]/10 bg-[var(--accent-color)]/[0.02] hover:bg-[var(--accent-color)]/[0.04] shadow-sm';
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] space-y-8 animate-fade-in relative z-10">
      
      {/* Immersive memory graph banner with live constellation */}
      <div className="relative h-72 rounded-[2px] overflow-hidden border border-white/5 shadow-2xl flex flex-col justify-end p-8 bg-[#09080E]/60 backdrop-blur-md">
        <MemoryConstellation token={token} />
        
        {/* Glow overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08070C] via-[#08070C]/40 to-transparent pointer-events-none z-0" />

        <div className="relative z-10 space-y-1.5 max-w-lg">
          <div className="w-10 h-10 bg-white/[0.03] border border-white/10 rounded-[2px] flex items-center justify-center text-[var(--accent-color)] mb-3 backdrop-blur-md">
            <Brain className="w-5.5 h-5.5 text-[var(--accent-color)]" />
          </div>
          <h2 className="text-3xl font-serif font-bold text-[#F3F3F5] tracking-tight">
            Memory Map
          </h2>
          <p className="text-xs text-[#ADA9BA] leading-relaxed">
            A mapping of recurring concepts, key topics, milestones, and personal insights generated from your journal entries.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-[#ADA9BA] animate-pulse">
          <Brain className="w-10 h-10 mb-4 opacity-50 text-[var(--accent-color)]" />
          <p className="text-sm font-semibold">Loading memories and themes...</p>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* Dynamic Psychological Reflection Card */}
          {reflection && (
            <motion.div 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card rounded-[2px] p-6 md:p-8 shadow-md border border-white/5 space-y-4"
            >
              <div className="flex items-center gap-2.5 text-[var(--accent-color)]">
              <Brain className="w-5 h-5 text-[var(--accent-color)]" />
              <h3 className="font-serif font-bold text-lg text-[#F3F3F5]">Memory Insights</h3>
            </div>
              <div className="prose prose-invert max-w-none text-sm text-[#ADA9BA] leading-relaxed font-sans">
                <ReactMarkdown>{reflection}</ReactMarkdown>
              </div>
            </motion.div>
          )}

          {/* Active Proactive Prompt reflection card */}
          {pendingPrompt && (
            <div className="glass-card rounded-[2px] p-6 md:p-8 shadow-sm space-y-5 animate-fade-in relative overflow-hidden border border-[var(--accent-color)]/10">
              <div className="absolute top-0 left-0 w-[3px] h-full bg-gradient-to-b from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)]" />
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[var(--accent-color)]" />
                <h3 className="font-serif font-bold text-lg text-[#F3F3F5]">A moment to reflect</h3>
              </div>
              <p className="text-[#E7E7EC] text-lg font-serif italic leading-relaxed">"{pendingPrompt.promptText}"</p>
              
              {submitted ? (
                <div className="flex items-center gap-2.5 text-emerald-400 bg-emerald-500/10 p-3.5 rounded-[2px] border border-emerald-500/20">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-semibold text-sm">Response saved. Your memory records have been updated.</span>
                </div>
              ) : (
                <form onSubmit={submitResponse} className="space-y-3.5">
                  <textarea
                    placeholder="Write down your response..."
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    className="w-full glass-input rounded-[2px] py-3 px-4 text-xs min-h-[100px] resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting || !response.trim()}
                      className="bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] text-white font-bold px-5 py-2.5 rounded-[2px] text-xs transition flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-md"
                    >
                      {submitting ? 'Saving...' : <><Send className="w-3.5 h-3.5" /> Save Response</>}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Durable Mind Anchors (Long-Term Memories) */}
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-[var(--accent-color)]" />
              <h3 className="font-serif font-bold text-xl text-[#F3F3F5]">Core Memories</h3>
            </div>
            
            {durableMemories.length === 0 ? (
              <div className="glass-card border border-white/5 p-8 rounded-[2px] text-center bg-[#09080E]/20">
                <p className="text-[#ADA9BA] text-sm leading-relaxed">
                  No core memories have been created yet. Keep writing journal entries to generate permanent highlights.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {durableMemories.map((dMemory, index) => {
                  return (
                    <motion.div
                      key={dMemory.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.04 } }}
                      className="glass-card border border-[var(--accent-color)]/10 shadow-sm bg-[var(--accent-color)]/[0.01] p-5 rounded-[2px] hover:shadow-xl hover:bg-[var(--accent-color)]/[0.03] transition-all duration-300 group flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--accent-color)]">
                            Core Memory
                          </span>
                          <span className="text-[10px] text-[var(--accent-color)] font-semibold">
                            {(dMemory.confidence * 100).toFixed(0)}% Confidence
                          </span>
                        </div>
                        
                        <p className="text-xs text-[#E7E7EC] leading-relaxed font-serif italic">
                          "{dMemory.content}"
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
                        {/* Confidence Progress Bar */}
                        <div className="w-full bg-white/[0.04] h-1.5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${dMemory.confidence * 100}%` }}
                            transition={{ duration: 0.8, delay: 0.2 }}
                            className="bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] h-full rounded-full"
                          />
                        </div>
                        
                        <div className="flex items-center justify-between text-[9px] text-[#ADA9BA]/50 font-medium">
                          <span>Confidence Level</span>
                          <span>{new Date(dMemory.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Memory Fragments List */}
          <div className="space-y-5">
            <h3 className="font-serif font-bold text-xl text-[#F3F3F5]">Memory Nodes</h3>
            {memories.length === 0 ? (
              <div className="glass-card border border-white/5 p-8 rounded-[2px] text-center">
                <p className="text-[#ADA9BA] text-sm leading-relaxed">
                  Keep writing journal entries to trace topics and emotional patterns.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {memories.map((memory, index) => {
                  const cardColorClass = getCategoryColorClass(memory.category);
                  return (
                    <motion.div 
                      key={memory.id} 
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.04 } }}
                      className={`glass-card border p-5 rounded-[2px] hover:shadow-xl transition-all duration-300 group flex flex-col justify-between ${cardColorClass}`}
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="p-2 bg-white/[0.04] rounded-[2px] border border-white/5">
                            {getCategoryIcon(memory.category)}
                          </div>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[#ADA9BA]">
                            {getCategoryLabel(memory.category)}
                          </span>
                        </div>
                        <p className="text-xs text-[#E7E7EC] leading-relaxed font-serif italic mb-4">
                          "{memory.content}"
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-[9px] text-[#ADA9BA]/50 font-medium pt-3.5 border-t border-white/5">
                        <span className="flex items-center gap-1">
                          <Activity className="w-3 h-3 text-[var(--accent-color)]" /> 
                          Strength: {memory.strength}
                        </span>
                        <span>{new Date(memory.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
