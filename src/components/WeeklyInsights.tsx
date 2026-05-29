import React, { useEffect, useState } from 'react';
import { Sparkles, Calendar, TrendingUp, Tag, PlusCircle, AlertCircle, RefreshCw, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { WeeklyInsights as InsightsType } from '../types';
import { API_BASE } from '../api';

interface WeeklyInsightsProps {
  token: string;
  userApiKey: string | null;
  entriesCount: number;
  customPrompt: string | null;
}

export default function WeeklyInsights({ token, userApiKey, entriesCount, customPrompt }: WeeklyInsightsProps) {
  const [data, setData] = useState<InsightsType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
      };
      if (userApiKey) {
        headers['x-gemini-api-key'] = userApiKey;
      }
      if (customPrompt) {
        headers['x-custom-prompt'] = customPrompt;
      }

      const response = await fetch(`${API_BASE}/api/insights`, {
        headers
      });
      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to compile insights.');
      }

      setData(resData);
    } catch (err: any) {
      setError(err.message || 'Failed to load insights.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, [entriesCount]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-20 text-center space-y-4 font-sans text-[#E7E7EC]">
        <div className="w-12 h-12 rounded-2xl bg-[#8B5CF6]/10 flex items-center justify-center mx-auto border border-[#8B5CF6]/20">
          <Heart className="w-5 h-5 text-[#EC4899] fill-[#EC4899] animate-pulse" />
        </div>
        <h3 className="text-base font-serif font-bold text-[#F3F3F5]">Analyzing narrative patterns...</h3>
        <p className="text-xs text-[#ADA9BA] max-w-sm mx-auto leading-relaxed">Aggregating emotional states and mapping weekly growth vectors.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 font-sans text-[#E7E7EC] space-y-4">
        <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-center gap-3 text-rose-300 text-xs shadow-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchInsights}
          className="bg-white/[0.04] hover:bg-white/[0.08] text-[#E7E7EC] text-xs px-4 py-2.5 rounded-xl transition cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const moodList = data?.moodDistribution || [];
  const tagList = data?.tagDistribution || [];
  const maxMoodVal = moodList.length > 0 ? Math.max(...moodList.map((m) => m.count)) : 1;
  const maxTagVal = tagList.length > 0 ? Math.max(...tagList.map((t) => t.count)) : 1;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] space-y-8 animate-fade-in">
      
      {/* Description header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#F3F3F5] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#8B5CF6]" />
            Narrative Insights
          </h2>
          <p className="text-xs text-[#ADA9BA] mt-1.5 leading-relaxed">Review emotional trends, tag distributions, and AI-compiled weekly summaries.</p>
        </div>

        <button
          onClick={fetchInsights}
          className="flex items-center gap-1.5 text-xs text-[#ADA9BA] hover:text-[#F3F3F5] bg-white/[0.02] border border-white/5 hover:border-white/10 px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-sm font-semibold"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Analysis
        </button>
      </div>

      {entriesCount === 0 ? (
        <div className="text-center py-16 glass-card rounded-3xl border border-white/5 shadow-sm">
          <TrendingUp className="w-9 h-9 text-[#8B5CF6] mx-auto mb-3 animate-pulse" />
          <p className="text-base font-serif font-bold text-[#F3F3F5]">No insights available</p>
          <p className="text-xs text-[#ADA9BA] mt-2 max-w-[280px] mx-auto leading-relaxed">
            Write more journal reflections to trace sentiment charts and unlock narrative summaries.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mood distribution column */}
          <div className="p-6 glass-card rounded-3xl space-y-5 border border-white/5 hover:border-white/10 transition-all duration-300">
            <span className="block text-[10px] font-sans font-bold text-[#ADA9BA] uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#8B5CF6]" />
              Emotion Distribution
            </span>

            {moodList.length === 0 ? (
              <p className="text-xs text-[#ADA9BA]/60 italic">No emotional data mapped yet.</p>
            ) : (
              <div className="space-y-4">
                {moodList.map((m) => {
                  const percentage = Math.round((m.count / maxMoodVal) * 100);
                  return (
                    <div key={m.mood} className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="capitalize font-semibold text-[#E7E7EC]">{m.mood}</span>
                        <span className="text-[#ADA9BA]">{m.count} {m.count === 1 ? 'entry' : 'entries'}</span>
                      </div>
                      <div className="w-full bg-white/[0.03] border border-white/5 h-2.5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] h-full rounded-full"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags cloud column */}
          <div className="p-6 glass-card rounded-3xl space-y-5 border border-white/5 hover:border-white/10 transition-all duration-300">
            <span className="block text-[10px] font-sans font-bold text-[#ADA9BA] uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-[#EC4899]" />
              Top Reflection Tags
            </span>

            {tagList.length === 0 ? (
              <p className="text-xs text-[#ADA9BA]/60 italic">No tags logged yet.</p>
            ) : (
              <div className="space-y-4">
                {tagList.map((t) => {
                  const percentage = Math.round((t.count / maxTagVal) * 100);
                  return (
                    <div key={t.tag} className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-[#E7E7EC]">#{t.tag}</span>
                        <span className="text-[#ADA9BA]">{t.count} {t.count === 1 ? 'entry' : 'entries'}</span>
                      </div>
                      <div className="w-full bg-white/[0.03] border border-white/5 h-2.5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
                          className="bg-gradient-to-r from-[#EC4899] to-[#FDA4AF] h-full rounded-full"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversational md insights sheet spanning both columns */}
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:col-span-2 p-6 glass-card rounded-3xl space-y-4 border border-white/5"
          >
            <div className="flex items-center gap-2 text-[#ADA9BA] border-b border-white/5 pb-3">
              <PlusCircle className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">AI Summary & Observations</span>
            </div>

            <div className="markdown-body text-sm leading-relaxed text-[#ADA9BA] space-y-3 prose max-w-none">
              <ReactMarkdown>{data?.markdownSummary || 'Synthesizing observational summary...'}</ReactMarkdown>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
