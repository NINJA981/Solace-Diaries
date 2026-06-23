import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { JournalEntry } from '../types';

interface MemorySparkProps {
  entries: JournalEntry[];
}

export default function MemorySpark({ entries }: MemorySparkProps) {
  const [spark, setSpark] = useState<{ text: string; date: string } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (entries.length === 0) return;

    // Wait a moment after load to show the spark
    const timer = setTimeout(() => {
      // Pick a random entry
      const randomEntry = entries[Math.floor(Math.random() * entries.length)];
      
      // Extract a meaningful sentence (ideally ending in . ! or ?)
      const sentences = randomEntry.content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      if (sentences.length > 0) {
        const randomSentence = sentences[Math.floor(Math.random() * sentences.length)].trim() + '.';
        const dateStr = new Date(randomEntry.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
        
        setSpark({ text: randomSentence, date: dateStr });
        setIsVisible(true);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [entries]);

  if (!spark) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20, rotateX: 10 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          exit={{ opacity: 0, y: -20, filter: 'blur(4px)' }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-8 left-8 z-30 max-w-sm hidden md:block"
        >
          <div className="bg-[#13111A]/90 backdrop-blur-xl border border-white/10 p-5 shadow-2xl relative overflow-hidden group" style={{ borderRadius: '2px' }}>
            {/* Subtle organic light sweep */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[var(--accent-color)]/0 via-[var(--accent-color)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            
            <button 
              onClick={() => setIsVisible(false)}
              className="absolute top-3 right-3 text-white/30 hover:text-white/80 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-start gap-3 relative z-10">
              <Sparkles className="w-4 h-4 text-[var(--accent-color)] shrink-0 mt-1" />
              <div>
                <p className="text-[10px] font-bold text-[#ADA9BA] uppercase tracking-widest mb-2">Past Memory</p>
                <p className="text-sm font-serif text-[#F3F3F5] leading-relaxed italic">
                  "{spark.text}"
                </p>
                <p className="text-[10px] text-[#ADA9BA]/60 mt-3 font-medium">
                  Written on {spark.date}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
