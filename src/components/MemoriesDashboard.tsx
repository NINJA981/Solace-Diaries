import React, { useState, useEffect } from 'react';
import { Brain, Heart, Sparkles, Send, CheckCircle, Clock, Target, Users, Compass, Activity, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
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

interface MemoriesDashboardProps {
  token: string;
}

export default function MemoriesDashboard({ token }: MemoriesDashboardProps) {
  const [memories, setMemories] = useState<MemoryFragment[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<ProactivePrompt | null>(null);
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
      const [memRes, promptRes] = await Promise.all([
        fetch(`${API_BASE}/api/memories/graph`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/memories/pending-prompt`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (memRes.ok) {
        setMemories(await memRes.json());
      }
      if (promptRes.ok) {
        setPendingPrompt(await promptRes.json());
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
      case 'ambition': return <Target className="w-4 h-4 text-[#8B5CF6]" />;
      case 'relationship': return <Users className="w-4 h-4 text-[#3B82F6]" />;
      case 'emotional_trend': return <Heart className="w-4 h-4 text-[#EC4899]" />;
      case 'life_event': return <CalendarDays className="w-4 h-4 text-[#FDA4AF]" />;
      case 'unfinished_goal': return <Clock className="w-4 h-4 text-[#ADA9BA]" />;
      case 'milestone': return <Sparkles className="w-4 h-4 text-[#F43F5E]" />;
      case 'behavioral_pattern': return <Activity className="w-4 h-4 text-[#8B5CF6]" />;
      default: return <Compass className="w-4 h-4 text-[#8B5CF6]" />;
    }
  };

  const getCategoryColorClass = (category: string) => {
    switch (category) {
      case 'ambition': return 'border-violet-500/20 shadow-violet-500/5 bg-violet-500/5';
      case 'relationship': return 'border-blue-500/20 shadow-blue-500/5 bg-blue-500/5';
      case 'emotional_trend': return 'border-pink-500/20 shadow-pink-500/5 bg-pink-500/5';
      case 'life_event': return 'border-rose-300/20 shadow-rose-300/5 bg-rose-300/5';
      case 'unfinished_goal': return 'border-zinc-500/20 shadow-zinc-500/5 bg-zinc-500/5';
      case 'milestone': return 'border-rose-500/20 shadow-rose-500/5 bg-rose-500/5';
      default: return 'border-[#8B5CF6]/20 shadow-[#8B5CF6]/5 bg-[#8B5CF6]/5';
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] space-y-8 animate-fade-in relative z-10">
      
      {/* Immersive memory graph banner with live constellation */}
      <div className="relative h-72 rounded-3xl overflow-hidden border border-white/5 shadow-2xl flex flex-col justify-end p-8 bg-[#09080E]/60 backdrop-blur-md">
        <MemoryConstellation />
        
        {/* Glow overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08070C] via-[#08070C]/40 to-transparent pointer-events-none z-0" />

        <div className="relative z-10 space-y-1.5 max-w-lg">
          <div className="w-10 h-10 bg-white/[0.03] border border-white/10 rounded-2xl flex items-center justify-center text-[#8B5CF6] mb-3 backdrop-blur-md">
            <Brain className="w-5.5 h-5.5 text-[#8B5CF6]" />
          </div>
          <h2 className="text-3xl font-serif font-bold text-[#F3F3F5] tracking-tight">
            Story Constellation
          </h2>
          <p className="text-xs text-[#ADA9BA] leading-relaxed">
            A living semantic map of recurring thought vectors, goals, life milestones, and psychological shifts mapped across your diary history.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-[#ADA9BA] animate-pulse">
          <Brain className="w-10 h-10 mb-4 opacity-50 text-[#8B5CF6]" />
          <p className="text-sm font-semibold">Resolving memories and story nodes...</p>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* Active Proactive Prompt reflection card */}
          {pendingPrompt && (
            <div className="glass-card rounded-3xl p-6 md:p-8 shadow-sm space-y-5 animate-fade-in relative overflow-hidden border border-[#8B5CF6]/10">
              <div className="absolute top-0 left-0 w-[3px] h-full bg-gradient-to-b from-[#8B5CF6] to-[#EC4899]" />
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#8B5CF6]" />
                <h3 className="font-serif font-bold text-lg text-[#F3F3F5]">A moment to reflect</h3>
              </div>
              <p className="text-[#E7E7EC] text-lg font-serif italic leading-relaxed">"{pendingPrompt.promptText}"</p>
              
              {submitted ? (
                <div className="flex items-center gap-2.5 text-emerald-400 bg-emerald-500/10 p-3.5 rounded-2xl border border-emerald-500/20">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-semibold text-sm">Response saved. Solace has updated your memory records.</span>
                </div>
              ) : (
                <form onSubmit={submitResponse} className="space-y-3.5">
                  <textarea
                    placeholder="Write down your response..."
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    className="w-full glass-input rounded-2xl py-3 px-4 text-xs min-h-[100px] resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting || !response.trim()}
                      className="bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] hover:from-[#7C3AED] hover:to-[#4F46E5] text-white font-bold px-5 py-2.5 rounded-xl text-xs transition flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-500/10"
                    >
                      {submitting ? 'Saving...' : <><Send className="w-3.5 h-3.5" /> Transcribe to Solace</>}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Memory Fragments List */}
          <div className="space-y-5">
            <h3 className="font-serif font-bold text-xl text-[#F3F3F5]">Evolving Story Nodes</h3>
            {memories.length === 0 ? (
              <div className="glass-card border border-white/5 p-8 rounded-3xl text-center">
                <p className="text-[#ADA9BA] text-sm leading-relaxed">
                  Your constellation is currently quiet. Keep writing diary reflections and Solace will begin tracing core psychological shifts.
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
                      className={`glass-card border p-5 rounded-3xl hover:shadow-xl transition-all duration-300 group flex flex-col justify-between ${cardColorClass}`}
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="p-2 bg-white/[0.04] rounded-xl border border-white/5">
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
                          <Activity className="w-3 h-3 text-[#8B5CF6]" /> 
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
