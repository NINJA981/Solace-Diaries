import React, { useState } from 'react';
import { Search, SlidersHorizontal, Calendar, Tag, Trash2, Edit2, Smile, AlertCircle } from 'lucide-react';
import { JournalEntry } from '../types';

interface EntriesListProps {
  entries: JournalEntry[];
  onEditEntry: (entry: JournalEntry) => void;
  onDeleteEntry: (id: string) => void;
}

const ALL_MOODS = ['all', 'joyful', 'reflective', 'anxious', 'sad', 'unfocused', 'energetic', 'peaceful', 'tired'];

export default function EntriesList({ entries, onEditEntry, onDeleteEntry }: EntriesListProps) {
  const [search, setSearch] = useState('');
  const [selectedMood, setSelectedMood] = useState('all');

  // Filter entries locally based on simple query and mood selections
  const filtered = entries.filter((e) => {
    const matchesMood = selectedMood === 'all' || e.mood.toLowerCase() === selectedMood.toLowerCase();
    const cleanSearch = search.toLowerCase().trim();
    const matchesSearch =
      cleanSearch === '' ||
      e.title.toLowerCase().includes(cleanSearch) ||
      e.content.toLowerCase().includes(cleanSearch) ||
      e.tags.some((t) => t.toLowerCase().includes(cleanSearch));

    return matchesMood && matchesSearch;
  });

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#2C2621]">
      {/* Search and Filters Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E3DAC9] pb-6 mb-8">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#2C2621] flex items-center gap-2">
            Entries
          </h2>
          <p className="text-xs text-[#60554C] mt-1">View and manage your journal entries.</p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#827468] w-4.5 h-4.5" />
          <input
            type="text"
            placeholder="Search moments, tags, content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#FFFDF9] border border-[#DFD5C4] focus:border-[#4A6447] focus:ring-1 focus:ring-[#4A6447] rounded-xl py-2.5 pl-10 pr-4 text-xs transition outline-none text-[#2C2621] placeholder-[#A09384]"
          />
        </div>
      </div>

      {/* Mood Filters */}
      <div className="mb-6">
        <span className="block text-[10px] font-sans font-semibold uppercase tracking-wider text-[#827468] mb-2.5">Filter by mood</span>
        <div className="flex flex-wrap gap-1.5 pb-2">
          {ALL_MOODS.map((md) => {
            const isSelected = selectedMood === md;
            return (
              <button
                key={md}
                onClick={() => setSelectedMood(md)}
                className={`px-3.5 py-1.5 text-xs rounded-xl border capitalize cursor-pointer transition ${
                  isSelected
                    ? 'bg-[#E5ECE4] border-[#4A6447] text-[#4A6447] font-bold shadow-sm'
                    : 'bg-[#FFFDF9] border-[#DFD5C4] text-[#60554C] hover:text-[#2C2621] hover:border-[#C1D2BD]'
                }`}
              >
                {md}
              </button>
            );
          })}
        </div>
      </div>

      {/* Entries List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl flex flex-col items-center justify-center shadow-sm">
          <AlertCircle className="w-9 h-9 text-[#827468] mb-3" />
          <p className="text-base font-serif font-bold text-[#2C2621]">No entries found</p>
          <p className="text-xs text-[#60554C] mt-1.5 max-w-[320px] leading-relaxed">
            {entries.length === 0
              ? 'You haven\'t written any entries yet. Click "Write" to start your first entry!'
              : 'Try searching different terms or clearing your current active mood filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="p-6 bg-[#FFFDF9] hover:bg-[#FFFDF9]/90 border border-[#DFD5C4] hover:border-[#C1D2BD] rounded-2xl shadow-sm hover:shadow-md transition duration-200 flex flex-col md:flex-row md:items-start justify-between gap-5"
            >
              {/* Left Segment: Meta + Content */}
              <div className="space-y-3 grow">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-block px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-[#F5EFEB] text-[#9B5D47] border border-[#ECD5CB]">
                    {entry.mood}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-[#827468] font-medium">
                    <Calendar className="w-3.5 h-3.5 text-[#827468]" />
                    <span>{new Date(entry.createdAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-lg font-serif font-bold text-[#2C2621] tracking-tight">{entry.title}</h3>
                  <p className="text-[#60554C] text-sm leading-relaxed whitespace-pre-line max-h-32 overflow-hidden overflow-ellipsis">
                    {entry.content}
                  </p>
                </div>

                {entry.tags && entry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {entry.tags.map((tg) => (
                      <span
                        key={tg}
                        className="flex items-center gap-1 text-[10px] bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD] px-2.5 py-0.5 rounded-md"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        <span>{tg}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Segment: Action Handlers */}
              <div className="flex md:flex-col items-center gap-2 md:justify-start shrink-0">
                <button
                  onClick={() => onEditEntry(entry)}
                  className="flex items-center justify-center border border-[#DFD5C4] hover:border-[#4A6447] p-2.5 rounded-xl bg-white hover:bg-[#FAF6EE] text-[#60554C] hover:text-[#4A6447] transition cursor-pointer shadow-sm"
                  title="Edit entry"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this entry?')) {
                      onDeleteEntry(entry.id);
                    }
                  }}
                  className="flex items-center justify-center border border-[#DFD5C4] hover:border-[#AF5D45]/30 p-2.5 rounded-xl bg-white hover:bg-[#FAF0EC] text-[#827468] hover:text-[#AF5D45] transition cursor-pointer shadow-sm"
                  title="Delete entry"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
