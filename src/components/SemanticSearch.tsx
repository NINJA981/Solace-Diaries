import React, { useState } from 'react';
import { Search, Heart, BookOpen, Clock, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchResult } from '../types';
import { API_BASE } from '../api';

interface SemanticSearchProps {
  token: string;
  userApiKey: string | null;
}

export default function SemanticSearch({ token, userApiKey }: SemanticSearchProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`
      };
      if (userApiKey) {
        headers['x-gemini-api-key'] = userApiKey;
      }

      const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, {
        headers
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to search entries.');
      }

      setResults(data);
    } catch (err: any) {
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] relative z-10">
      
      {/* Cover Header */}
      <div className="border-b border-white/5 pb-6 mb-8">
        <h2 className="text-2xl font-serif font-bold text-[#F3F3F5] flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center border border-[#8B5CF6]/20">
            <Search className="w-4.5 h-4.5 text-[#8B5CF6]" />
          </div>
          Semantic Search
        </h2>
        <p className="text-xs text-[#ADA9BA] mt-2.5 leading-relaxed">
          Retrieve past diary pages using semantic concepts, emotional cues, or topic contexts rather than exact string queries.
        </p>
      </div>

      {/* Query Bar */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2.5">
          <div className="relative grow">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ADA9BA]/50 w-4 h-4" />
            <input
              type="text"
              required
              placeholder="Search concepts e.g. 'feeling overwhelmed but holding hope' or 'creative breakthroughs'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full glass-input rounded-xl py-3 pl-11 pr-4 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] hover:from-[#7C3AED] hover:to-[#4F46E5] text-white font-bold px-6 rounded-xl text-xs flex items-center gap-2 cursor-pointer transition-all duration-300 disabled:opacity-50 shadow-lg shadow-indigo-500/10"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Search'
            )}
          </button>
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-xs text-rose-300 mb-6">
          {error}
        </div>
      )}

      {/* Results Rendering */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-20 text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#8B5CF6]/10 flex items-center justify-center mx-auto border border-[#8B5CF6]/20">
              <Heart className="w-5 h-5 text-[#EC4899] fill-[#EC4899] animate-bounce" />
            </div>
            <p className="text-sm font-serif font-bold text-[#F3F3F5]">Exploring your story archive...</p>
            <p className="text-xs text-[#ADA9BA] max-w-sm mx-auto leading-relaxed">Scanning diary pages and analyzing semantic coordinates.</p>
          </motion.div>
        ) : results ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">
              Found {results.length} semantic correlation{results.length !== 1 ? 's' : ''}
            </span>

            {results.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-3xl border border-white/5 shadow-sm">
                <p className="text-[#ADA9BA] font-serif text-sm">No correlations found</p>
                <p className="text-[#ADA9BA]/60 text-xs mt-1">Try expanding your search query description.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {results.map(({ entry, score }, index) => {
                  const percentage = Math.max(0, Math.min(100, Math.round(score * 100)));
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.05 } }}
                      className="glass-card hover:bg-white/[0.04] border border-white/5 hover:border-white/10 p-6 rounded-3xl space-y-4 hover:shadow-xl transition-all duration-300"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                            {entry.mood}
                          </span>
                          <div className="text-xs text-[#ADA9BA] flex items-center gap-1.5 font-medium">
                            <Clock className="w-3.5 h-3.5 text-[#8B5CF6]" />
                            <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {/* Score Badge */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-[#8B5CF6]">{percentage}% match</span>
                          <div className="w-20 bg-white/[0.05] h-1.5 rounded-full overflow-hidden border border-white/5">
                            <div
                              className="bg-gradient-to-r from-[#8B5CF6] to-[#EC4899] h-full rounded-full"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <h3 className="text-lg font-serif font-bold text-[#F3F3F5] tracking-tight">{entry.title}</h3>
                        <p className="text-[#ADA9BA] text-sm leading-relaxed whitespace-pre-line">
                          {entry.content}
                        </p>
                      </div>

                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {entry.tags.map((tg) => (
                            <span
                              key={tg}
                              className="flex items-center gap-1 text-[10px] bg-white/[0.03] text-[#ADA9BA] px-2.5 py-0.5 rounded-md border border-white/5"
                            >
                              <Tag className="w-2.5 h-2.5 text-[#8B5CF6]" />
                              <span>{tg}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 glass-card rounded-3xl border border-white/5"
          >
            <BookOpen className="w-10 h-10 text-[#8B5CF6] mx-auto mb-4 animate-pulse" />
            <p className="text-xs text-[#ADA9BA] italic font-medium">Describe a feeling or memory context above to begin searching.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
