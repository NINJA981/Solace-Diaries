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
          <div className="w-9 h-9 rounded-[2px] bg-[var(--accent-color)]/10 flex items-center justify-center border border-[var(--accent-color)]/20">
            <Search className="w-4.5 h-4.5 text-[var(--accent-color)]" />
          </div>
          Semantic Search
        </h2>
        <p className="text-xs text-[#ADA9BA] mt-2.5 leading-relaxed">
          Find past journal entries by concept or meaning, rather than just exact keywords.
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
              placeholder="Search by meaning, e.g., 'feeling overwhelmed but hopeful' or 'creative ideas'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full glass-input rounded-[2px] py-3 pl-11 pr-4 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] text-white font-bold px-6 rounded-[2px] text-xs flex items-center gap-2 cursor-pointer transition-all duration-300 disabled:opacity-50 shadow-md"
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
        <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-[2px] text-xs text-rose-300 mb-6">
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
            <div className="w-12 h-12 rounded-[2px] bg-[var(--accent-color)]/10 flex items-center justify-center mx-auto border border-[var(--accent-color)]/20">
              <Heart className="w-5 h-5 text-[var(--accent-heart)] fill-[var(--accent-heart)] animate-bounce" />
            </div>
            <p className="text-sm font-serif font-bold text-[#F3F3F5]">Searching journal entries...</p>
            <p className="text-xs text-[#ADA9BA] max-w-sm mx-auto leading-relaxed">Searching through journal entries...</p>
          </motion.div>
        ) : results ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
          >
            <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">
              Found {results.length} match{results.length !== 1 ? 'es' : ''}
            </span>

            {results.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-[2px] border border-white/5 shadow-sm">
                <p className="text-[#ADA9BA] font-serif text-sm">No matches found</p>
                <p className="text-[#ADA9BA]/60 text-xs mt-1">Try using different words or a longer description.</p>
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
                      className="glass-card hover:bg-white/[0.04] border border-white/5 hover:border-white/10 p-6 rounded-[2px] space-y-4 hover:shadow-xl transition-all duration-300"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-[2px] bg-[var(--accent-color)]/10 text-[var(--accent-color)] border border-[var(--accent-color)]/20">
                            {entry.mood}
                          </span>
                          <div className="text-xs text-[#ADA9BA] flex items-center gap-1.5 font-medium">
                            <Clock className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                            <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {/* Score Badge */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-[var(--accent-color)]">{percentage}% match</span>
                          <div className="w-20 bg-white/[0.05] h-1.5 rounded-full overflow-hidden border border-white/5">
                            <div
                              className="bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] h-full rounded-full"
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

                      {/* Image attachments list */}
                      {entry.images && entry.images.length > 0 && (
                        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 pt-1">
                          {entry.images.map((img) => (
                            <a
                              key={img.id}
                              href={img.imageUrl.startsWith('/') ? `${API_BASE}${img.imageUrl}` : img.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block aspect-square rounded-[2px] overflow-hidden border border-white/5 bg-white/[0.01] hover:border-[var(--accent-color)]/30 transition duration-300 shadow-sm"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <img
                                src={img.imageUrl.startsWith('/') ? `${API_BASE}${img.imageUrl}` : img.imageUrl}
                                alt="Journal Attachment"
                                className="w-full h-full object-cover hover:scale-105 transition duration-300"
                              />
                            </a>
                          ))}
                        </div>
                      )}

                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {entry.tags.map((tg) => (
                            <span
                              key={tg}
                              className="flex items-center gap-1 text-[10px] bg-white/[0.03] text-[#ADA9BA] px-2.5 py-0.5 rounded-[2px] border border-white/5"
                            >
                              <Tag className="w-2.5 h-2.5 text-[var(--accent-color)]" />
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
            className="text-center py-16 glass-card rounded-[2px] border border-white/5"
          >
            <BookOpen className="w-10 h-10 text-[var(--accent-color)] mx-auto mb-4 animate-pulse" />
            <p className="text-xs text-[#ADA9BA] italic font-medium">Describe a feeling or memory context above to begin searching.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
