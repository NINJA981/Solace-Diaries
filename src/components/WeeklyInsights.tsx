import React, { useEffect, useState } from 'react';
import { Sparkles, Calendar, TrendingUp, Tag, PlusCircle, AlertCircle, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { WeeklyInsights as InsightsType } from '../types';
import { API_BASE } from '../api';

interface WeeklyInsightsProps {
  token: string;
  userApiKey: string | null;
  entriesCount: number;
}

export default function WeeklyInsights({ token, userApiKey, entriesCount }: WeeklyInsightsProps) {
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
      <div className="max-w-4xl mx-auto py-20 text-center space-y-4 font-sans text-[#2C2621]">
        <RefreshCw className="w-9 h-9 text-[#4A6447] animate-spin mx-auto" />
        <h3 className="text-base font-serif font-bold text-[#2C2621]">Analyzing entry patterns...</h3>
        <p className="text-xs text-[#60554C] max-w-sm mx-auto leading-relaxed">Generating mood graphs and insights...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 font-sans text-[#2C2621] space-y-4">
        <div className="p-4 bg-[#FAF0EC] border border-[#ECD5CB] rounded-xl flex items-center gap-3 text-[#9B5D47] text-sm shadow-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-[#AF5D45]" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchInsights}
          className="bg-[#EBE5D8] hover:bg-[#DFD5C4] text-[#60554C] hover:text-[#2C2621] text-xs px-4 py-2.5 rounded-xl transition"
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
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#2C2621] space-y-8 animate-fade-in">
      {/* Description header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E3DAC9] pb-6">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2621] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#AF5D45]" />
            Insights
          </h2>
          <p className="text-xs text-[#60554C] mt-1.5 leading-relaxed">Review your journal patterns and AI-generated insights.</p>
        </div>

        <button
          onClick={fetchInsights}
          className="flex items-center gap-1.5 text-xs text-[#60554C] hover:text-[#2C2621] bg-[#FFFDF9] border border-[#DFD5C4] hover:border-[#C1D2BD] px-4 py-2.5 rounded-xl cursor-pointer transition shadow-sm font-semibold"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {entriesCount === 0 ? (
        <div className="text-center py-16 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl shadow-sm">
          <TrendingUp className="w-9 h-9 text-[#827468] mx-auto mb-3" />
          <p className="text-base font-serif font-bold text-[#2C2621]">No insights available</p>
          <p className="text-xs text-[#60554C] mt-1.5 max-w-[280px] mx-auto leading-relaxed">Write entries to unlock mood graphs and insights.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mood distribution column */}
          <div className="p-6 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl space-y-5 shadow-sm">
            <span className="block text-[10px] font-sans font-semibold text-[#827468] uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#AF5D45]" />
              Mood Distribution
            </span>

            {moodList.length === 0 ? (
              <p className="text-xs text-[#827468] italic">No data available</p>
            ) : (
              <div className="space-y-4">
                {moodList.map((m) => {
                  const percentage = Math.round((m.count / maxMoodVal) * 100);
                  return (
                    <div key={m.mood} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="capitalize font-semibold text-[#4A3F35]">{m.mood}</span>
                        <span className="text-[#827468] font-medium">{m.count} {m.count === 1 ? 'entry' : 'entries'}</span>
                      </div>
                      <div className="w-full bg-[#FAF6EE] border border-[#DFD5C4] h-3.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#AF5D45] h-full rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags cloud column */}
          <div className="p-6 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl space-y-5 shadow-sm">
            <span className="block text-[10px] font-sans font-semibold text-[#827468] uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-[#4A6447]" />
              Top Tags
            </span>

            {tagList.length === 0 ? (
              <p className="text-xs text-[#827468] italic">No data available</p>
            ) : (
              <div className="space-y-4">
                {tagList.map((t) => {
                  const percentage = Math.round((t.count / maxTagVal) * 100);
                  return (
                    <div key={t.tag} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-[#4A3F35]">#{t.tag}</span>
                        <span className="text-[#827468] font-medium">{t.count} {t.count === 1 ? 'entry' : 'entries'}</span>
                      </div>
                      <div className="w-full bg-[#FAF6EE] border border-[#DFD5C4] h-3.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#597459] h-full rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversational md insights sheet spanning both columns */}
          <div className="md:col-span-2 p-6 bg-[#FDFBF7] border border-[#DFD5C4] rounded-2xl space-y-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#4A6447] border-b border-[#E3DAC9] pb-3">
              <PlusCircle className="w-4 h-4 text-[#AF5D45]" />
              <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#4A6447]">AI Summary & Insights</span>
            </div>

            <div className="markdown-body text-sm leading-relaxed text-[#4A3F35] space-y-3 prose max-w-none">
              <ReactMarkdown>{data?.markdownSummary || 'Generating summary...'}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
