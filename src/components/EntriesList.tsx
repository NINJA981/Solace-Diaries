import React, { useState } from 'react';
import { Search, Calendar, Tag, Trash2, Edit2, AlertCircle, Sparkles, Smile } from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { JournalEntry } from '../types';

interface EntriesListProps {
  entries: JournalEntry[];
  onEditEntry: (entry: JournalEntry) => void;
  onDeleteEntry: (id: string) => void;
}

const ALL_MOODS = ['all', 'joyful', 'reflective', 'anxious', 'sad', 'unfocused', 'energetic', 'peaceful', 'tired'];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } }
};

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
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] relative z-10">
      
      {/* Search and Filters Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6 mb-8">
        <div>
          <h2 className="text-2xl font-serif font-bold text-[#F3F3F5] flex items-center gap-2">
            Timeline Archive
          </h2>
          <p className="text-xs text-[#ADA9BA] mt-1">Revisit your thoughts, emotions, and personal trajectory.</p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ADA9BA]/50 w-4 h-4" />
          <input
            type="text"
            placeholder="Search reflections, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full glass-input rounded-xl py-2.5 pl-10 pr-4 text-xs"
          />
        </div>
      </div>

      {/* Mood Filters */}
      <div className="mb-8">
        <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA] mb-2.5">Filter by Emotion</span>
        <div className="flex flex-wrap gap-2 pb-2">
          {ALL_MOODS.map((md) => {
            const isSelected = selectedMood === md;
            return (
              <button
                key={md}
                onClick={() => setSelectedMood(md)}
                className={`px-3.5 py-1.5 text-xs rounded-xl border capitalize cursor-pointer transition-all duration-300 ${
                  isSelected
                    ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-white font-bold shadow-sm shadow-indigo-500/10'
                    : 'glass-card hover:bg-white/[0.04] border-white/5 text-[#ADA9BA] hover:text-[#F3F3F5]'
                }`}
              >
                {md}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline List */}
      {filtered.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16 glass-card rounded-3xl flex flex-col items-center justify-center border border-white/5"
        >
          <Sparkles className="w-10 h-10 text-[#8B5CF6] mb-4 animate-pulse" />
          <p className="text-lg font-serif font-bold text-[#F3F3F5]">Your story starts here.</p>
          <p className="text-xs text-[#ADA9BA] mt-2 max-w-[320px] leading-relaxed">
            {entries.length === 0
              ? 'Begin writing down reflections in the "Write" space to populate your story timeline.'
              : 'No entries found matching your query. Try searching different terms.'}
          </p>
        </motion.div>
      ) : (
        <div className="relative pl-6 md:pl-8 border-l border-white/5 space-y-8">
          
          {/* Vertical Timeline Line Accent Glow */}
          <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-gradient-to-b from-[#8B5CF6] via-[#EC4899] to-transparent pointer-events-none" />

          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-6"
          >
            {filtered.map((entry) => (
              <motion.div
                key={entry.id}
                variants={itemVariants}
                className="relative"
              >
                {/* Timeline node dot */}
                <div className="absolute left-[-31px] md:left-[-37px] top-[14px] w-[11px] h-[11px] rounded-full bg-[#08070C] border-2 border-[#8B5CF6] shadow-[0_0_8px_rgba(139,92,246,0.8)] z-10" />

                {/* Timeline Card */}
                <div className="glass-card hover:bg-white/[0.04] rounded-3xl p-5 md:p-6 shadow-sm hover:shadow-xl transition-all duration-300 border border-white/5 hover:border-white/10 flex flex-col md:flex-row md:items-start justify-between gap-5 relative overflow-hidden group">
                  
                  {/* Subtle color highlight in group hover */}
                  <div className="absolute top-0 left-0 w-[2px] h-0 bg-gradient-to-b from-[#8B5CF6] to-[#EC4899] group-hover:h-full transition-all duration-300" />
                  
                  {/* Left Segment: Meta + Content */}
                  <div className="space-y-3.5 grow">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-block px-3 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {entry.mood}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs text-[#ADA9BA] font-medium">
                        <Calendar className="w-3.5 h-3.5 text-[#8B5CF6]" />
                        <span>{new Date(entry.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <h3 className="text-lg font-serif font-bold text-[#F3F3F5] tracking-tight group-hover:text-white transition duration-200">
                        {entry.title}
                      </h3>
                      <p className="text-[#ADA9BA] text-xs leading-relaxed whitespace-pre-line max-h-32 overflow-hidden overflow-ellipsis">
                        {entry.content}
                      </p>
                    </div>

                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {entry.tags.map((tg) => (
                          <span
                            key={tg}
                            className="flex items-center gap-1 text-[10px] bg-white/[0.03] text-[#ADA9BA] border border-white/5 px-2.5 py-0.5 rounded-md"
                          >
                            <Tag className="w-2.5 h-2.5 text-[#8B5CF6]" />
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
                      className="flex items-center justify-center border border-white/5 hover:border-[#8B5CF6] p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] text-[#ADA9BA] hover:text-[#F3F3F5] transition duration-200 cursor-pointer shadow-sm"
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
                      className="flex items-center justify-center border border-white/5 hover:border-rose-500/30 p-2.5 rounded-xl bg-white/[0.02] hover:bg-rose-500/10 text-[#ADA9BA] hover:text-rose-400 transition duration-200 cursor-pointer shadow-sm"
                      title="Delete entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}
