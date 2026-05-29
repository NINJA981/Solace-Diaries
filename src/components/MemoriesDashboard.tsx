import React, { useState, useEffect } from 'react';
import { Brain, Heart, Sparkles, Send, CheckCircle, Clock, Target, Users, Compass, Activity, CalendarDays } from 'lucide-react';
import { API_BASE } from '../api';

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
      case 'ambition': return <Target className="w-4 h-4 text-[#AF5D45]" />;
      case 'relationship': return <Users className="w-4 h-4 text-[#4A6447]" />;
      case 'emotional_trend': return <Heart className="w-4 h-4 text-[#9B5D47]" />;
      case 'life_event': return <CalendarDays className="w-4 h-4 text-[#597459]" />;
      case 'unfinished_goal': return <Clock className="w-4 h-4 text-[#60554C]" />;
      case 'milestone': return <Sparkles className="w-4 h-4 text-[#A98E75]" />;
      case 'behavioral_pattern': return <Activity className="w-4 h-4 text-[#2C2621]" />;
      default: return <Compass className="w-4 h-4 text-[#4A6447]" />;
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 font-sans text-[#2C2621] space-y-8 animate-fade-in">
      <div className="border-b border-[#E3DAC9] pb-5 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-[#2C2621] flex items-center gap-3">
            <Brain className="w-7 h-7 text-[#AF5D45]" />
            Solace Memories
          </h2>
          <p className="text-sm text-[#60554C] mt-1">A living map of your recurring thoughts, patterns, and evolving story.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-[#827468] animate-pulse">
          <Brain className="w-10 h-10 mb-4 opacity-50" />
          <p className="text-sm font-semibold">Reading the pages of your story...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {pendingPrompt && (
            <div className="bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl p-6 md:p-8 shadow-sm space-y-5 animate-fade-in relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-[#AF5D45]" />
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#AF5D45]" />
                <h3 className="font-serif font-bold text-lg text-[#2C2621]">A moment to reflect</h3>
              </div>
              <p className="text-[#4A3F35] text-lg font-serif italic leading-relaxed">"{pendingPrompt.promptText}"</p>
              
              {submitted ? (
                <div className="flex items-center gap-2 text-[#4A6447] bg-[#E5ECE4] p-3 rounded-xl border border-[#C1D2BD]">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-semibold text-sm">Response saved. Solace will remember this.</span>
                </div>
              ) : (
                <form onSubmit={submitResponse} className="space-y-3">
                  <textarea
                    placeholder="Write your thoughts..."
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    className="w-full bg-[#FAF6EE] border border-[#DFD5C4] focus:border-[#AF5D45] rounded-xl py-3 px-4 text-sm text-[#2C2621] placeholder-[#A09384] outline-none transition min-h-[100px] resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting || !response.trim()}
                      className="bg-[#AF5D45] hover:bg-[#9B5D47] text-white font-bold px-5 py-2.5 rounded-xl text-sm transition flex items-center gap-2 disabled:opacity-50"
                    >
                      {submitting ? 'Saving...' : <><Send className="w-4 h-4" /> Share with Solace</>}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="space-y-6">
            <h3 className="font-serif font-bold text-xl text-[#2C2621]">Your Memory Graph</h3>
            {memories.length === 0 ? (
              <div className="bg-[#FAF6EE] border border-[#E3DAC9] p-8 rounded-2xl text-center">
                <p className="text-[#827468] text-sm">Your memory graph is quiet. Keep writing, and Solace will begin to notice your recurring themes.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {memories.map(memory => (
                  <div key={memory.id} className="bg-[#FFFDF9] border border-[#DFD5C4] p-5 rounded-2xl hover:shadow-md transition group">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 bg-[#FAF6EE] rounded-lg border border-[#E3DAC9]">
                        {getCategoryIcon(memory.category)}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#827468]">{getCategoryLabel(memory.category)}</span>
                    </div>
                    <p className="text-sm text-[#4A3F35] leading-relaxed mb-4">{memory.content}</p>
                    <div className="flex items-center justify-between text-[10px] text-[#A09384] font-medium pt-3 border-t border-[#E3DAC9]/50">
                      <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Strength: {memory.strength}</span>
                      <span>{new Date(memory.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
