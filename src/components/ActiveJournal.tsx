import React, { useState, useEffect } from 'react';
import { BookOpen, AlertCircle, Save, CheckCircle, Heart, Notebook } from 'lucide-react';
import { JournalEntry } from '../types';
import { API_BASE } from '../api';

interface ActiveJournalProps {
  token: string;
  userApiKey: string | null;
  customPrompt: string | null;
  activeEntry: JournalEntry | null;
  onSaveSuccess: () => void;
  onCancel: () => void;
}

export default function ActiveJournal({ token, userApiKey, customPrompt, activeEntry, onSaveSuccess, onCancel }: ActiveJournalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedData, setSavedData] = useState<JournalEntry | null>(null);

  // Load editing values if preset
  useEffect(() => {
    if (activeEntry) {
      setTitle(activeEntry.title);
      setContent(activeEntry.content);
      setSavedData(null);
    } else {
      setTitle('');
      setContent('');
      setSavedData(null);
    }
  }, [activeEntry]);

  const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
  const charCount = content.length;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('Please enter some text before saving your entry.');
      return;
    }

    setLoading(true);
    setError(null);
    setSavedData(null);

    const method = activeEntry ? 'PUT' : 'POST';
    const url = activeEntry ? `/api/entries/${activeEntry.id}` : '/api/entries';

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };
      if (userApiKey) {
        headers['x-gemini-api-key'] = userApiKey;
      }
      if (customPrompt) {
        headers['x-custom-prompt'] = customPrompt;
      }

      const response = await fetch(`${API_BASE}${url}`, {
        method,
        headers,
        body: JSON.stringify({ title: title || 'Untitled Reflection', content })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze and save thoughts.');
      }

      setSavedData(data);
      onSaveSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save entry. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 font-sans text-[#2C2621]">
      <div className="flex items-center justify-between border-b border-[#E3DAC9] pb-5 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-[#E5ECE4] border border-[#C1D2BD] rounded-xl flex items-center justify-center text-[#4A6447]">
            <Notebook className="w-5 h-5 text-[#4A6447]" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-bold text-[#2C2621] tracking-tight">
              {activeEntry ? 'Edit Entry' : 'New Entry'}
            </h2>
            <p className="text-xs text-[#60554C] leading-relaxed">Write down your thoughts. The AI helper will generate a mood and tags automatically.</p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-xs font-semibold text-[#60554C] hover:text-[#2C2621] bg-[#EBE5D8] hover:bg-[#DFD5C4] px-4 py-2.5 rounded-xl transition"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lined Notebook Paper Writer Area */}
        <form onSubmit={handleSave} className="lg:col-span-2 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl p-6 md:p-8 shadow-sm space-y-6">
          {error && (
            <div className="p-4 bg-[#FAF0EC] border border-[#ECD5CB] rounded-xl flex items-start gap-3 text-[#9B5D47] text-sm animate-fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 text-[#AF5D45]" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <input
              type="text"
              placeholder="Title (optional)..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent text-xl md:text-2xl font-serif font-bold text-[#2C2621] placeholder-[#A09384] border-b border-[#E3DAC9] py-2 outline-none transition focus:border-[#4A6447]"
            />
          </div>

          <div className="min-h-[350px] flex flex-col">
            <textarea
              placeholder="Start writing..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full grow bg-transparent text-[#4A3F35] placeholder-[#B5A89A] text-base leading-relaxed resize-none outline-none focus:ring-0 min-h-[350px] font-sans paper-textarea"
            />
          </div>

          <div className="flex items-center justify-between pt-5 border-t border-[#E3DAC9] text-xs text-[#827468] font-medium">
            <div className="flex gap-4">
              <span>{wordCount} words</span>
              <span>{charCount} characters</span>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-[#597459] hover:bg-[#4A6447] text-white font-bold px-5 py-3 rounded-xl text-xs transition flex items-center gap-2 shadow-sm hover:shadow group cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Entry
                </>
              )}
            </button>
          </div>
        </form>

        {/* Dynamic AI Companion Reflection Sidebar */}
        <div className="space-y-6">
          {loading ? (
            <div className="p-8 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl flex flex-col items-center justify-center text-center py-20 shadow-sm animate-pulse">
              <Heart className="w-10 h-10 text-[#AF5D45] animate-bounce mb-4 fill-[#AF5D45]" />
              <p className="text-md font-serif font-bold text-[#2C2621]">AI Analysis</p>
              <p className="text-xs text-[#60554C] mt-2 max-w-[200px] leading-relaxed">Analyzing your thoughts...</p>
            </div>
          ) : savedData ? (
            <div className="p-6 bg-[#FDFBF7] border border-[#DFD5C4] rounded-2xl space-y-6 shadow-sm animate-fade-in">
              <div className="flex items-center gap-2.5 text-[#597459] font-medium">
                <CheckCircle className="w-5 h-5 shrink-0" />
                <span className="font-serif font-semibold text-lg">Saved Successfully</span>
              </div>
              <div className="space-y-2">
                <span className="block text-[10px] font-sans font-semibold uppercase tracking-wider text-[#827468]">Mood</span>
                <span className="inline-block px-3.5 py-1 text-xs font-bold rounded-full capitalize bg-[#F5EFEB] text-[#9B5D47] border border-[#E8D6CE]">
                  {savedData.mood}
                </span>
              </div>
              <div className="space-y-2">
                <span className="block text-[10px] font-sans font-semibold uppercase tracking-wider text-[#827468]">Tags</span>
                <div className="flex flex-wrap gap-1.5">
                  {savedData.tags && savedData.tags.length > 0 ? (
                    savedData.tags.map((tg) => (
                      <span key={tg} className="text-xs bg-[#E5ECE4] text-[#4A6447] px-2.5 py-1 rounded-lg border border-[#C1D2BD]">
                        #{tg}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#827468] text-xs">No tags detected today.</span>
                  )}
                </div>
              </div>
              <p className="text-xs text-[#60554C] leading-relaxed italic bg-[#E5ECE4]/30 p-3.5 rounded-xl border border-[#C1D2BD]/50 font-serif">
                "The entry has been analyzed and saved successfully."
              </p>
            </div>
          ) : (
            <div className="p-6 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl space-y-5 shadow-sm">
              <div className="flex items-center gap-2 text-[#4A6447]">
                <Heart className="w-4 h-4 text-[#AF5D45] fill-[#AF5D45]" />
                <span className="text-xs font-sans font-bold uppercase tracking-wider text-[#4A6447]">AI Companion</span>
              </div>
              <p className="text-xs text-[#60554C] leading-relaxed">
                When you click **Save Entry**, the AI will map your journal page to identify tags and analyze your mood.
              </p>
              <div className="text-xs space-y-3 pt-2 text-[#60554C]">
                <div className="flex justify-between border-b border-[#E3DAC9]/60 pb-2">
                  <span>Mood Analysis</span>
                  <span className="text-[#597459] font-semibold">Ready to listen</span>
                </div>
                <div className="flex justify-between border-b border-[#E3DAC9]/60 pb-2">
                  <span>Tag Generation</span>
                  <span className="text-[#597459] font-semibold">Active</span>
                </div>
                <div className="flex justify-between pb-1">
                  <span>Database Sync</span>
                  <span className="text-[#597459] font-semibold">Safe & Cozy</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
