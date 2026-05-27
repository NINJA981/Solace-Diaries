import React, { useState } from 'react';
import { Search, Heart, BookOpen, Clock, Tag } from 'lucide-react';
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
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#2C2621]">
      {/* Cover Header */}
      <div className="border-b border-[#E3DAC9] pb-6 mb-8">
        <h2 className="text-2xl font-serif font-bold text-[#2C2621] flex items-center gap-2">
          <Heart className="w-5 h-5 text-[#AF5D45] fill-[#AF5D45]" />
          Search
        </h2>
        <p className="text-xs text-[#60554C] mt-1.5 leading-relaxed">
          Search your past entries by concept or mood, rather than just exact keywords.
        </p>
      </div>

      {/* Query Bar */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2.5">
          <div className="relative grow">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#827468] w-4.5 h-4.5" />
            <input
              type="text"
              required
              placeholder="Search entries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-[#FFFDF9] border border-[#DFD5C4] focus:border-[#4A6447] focus:ring-1 focus:ring-[#4A6447] rounded-xl py-3 pl-11 pr-4 text-sm text-[#2C2621] placeholder-[#A09384] transition outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-[#597459] hover:bg-[#4A6447] text-white font-bold px-6 rounded-xl text-xs flex items-center gap-2 cursor-pointer transition disabled:opacity-50"
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
        <div className="p-4 bg-[#FAF0EC] border border-[#ECD5CB] rounded-xl text-sm text-[#9B5D47] mt-4">
          {error}
        </div>
      )}

      {/* Results Rendering */}
      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Heart className="w-8 h-8 text-[#AF5D45] animate-bounce mx-auto fill-[#AF5D45]" />
          <p className="text-sm font-serif font-bold text-[#2C2621]">Searching...</p>
          <p className="text-xs text-[#60554C] max-w-sm mx-auto leading-relaxed">Searching your entries for related topics and feelings.</p>
        </div>
      ) : results ? (
        <div className="space-y-6 animate-fade-in">
          <span className="block text-[10px] font-sans font-semibold uppercase tracking-wider text-[#827468]">
            Found {results.length} result{results.length !== 1 ? 's' : ''}
          </span>

          {results.length === 0 ? (
            <div className="text-center py-12 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl shadow-sm">
              <p className="text-[#60554C] font-serif text-sm">No results found</p>
              <p className="text-[#827468] text-xs mt-1">Try different search terms or write more entries.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map(({ entry, score }) => {
                const percentage = Math.max(0, Math.min(100, Math.round(score * 100)));
                return (
                  <div
                    key={entry.id}
                    className="p-6 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl space-y-4 hover:border-[#C1D2BD] transition duration-150 shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E3DAC9]/60 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md bg-[#FAF0EC] text-[#9B5D47] border border-[#ECD5CB]">
                          {entry.mood}
                        </span>
                        <div className="text-xs text-[#827468] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#827468]" />
                          <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {/* Score Badge */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#4A6447]">{percentage}% match</span>
                        <div className="w-20 bg-[#FAF6EE] h-2 rounded-full overflow-hidden border border-[#DFD5C4]">
                          <div
                            className="bg-[#597459] h-full rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-lg font-serif font-bold text-[#2C2621] tracking-tight">{entry.title}</h3>
                      <p className="text-[#60554C] text-sm leading-relaxed whitespace-pre-line">
                        {entry.content}
                      </p>
                    </div>

                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {entry.tags.map((tg) => (
                          <span
                            key={tg}
                            className="flex items-center gap-1 text-[10px] bg-[#E5ECE4] text-[#4A6447] px-2.5 py-0.5 rounded-md border border-[#C1D2BD]"
                          >
                            <Tag className="w-2.5 h-2.5" />
                            <span>{tg}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-16 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl shadow-sm">
          <BookOpen className="w-9 h-9 text-[#827468] mx-auto mb-3" />
          <p className="text-xs text-[#60554C] italic">Enter a search query to search your journal entries.</p>
        </div>
      )}
    </div>
  );
}
