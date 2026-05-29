import React, { useState, useEffect } from 'react';
import { BookOpen, AlertCircle, Save, CheckCircle, Heart, Notebook, Mic } from 'lucide-react';
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
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [pendingPrompt, setPendingPrompt] = useState<any>(null);

  useEffect(() => {
    // Fetch pending prompt for today
    fetch(`${API_BASE}/api/memories/pending-prompt`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.promptText) {
          setPendingPrompt(data);
        }
      })
      .catch(() => {});
  }, [token]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setSpeechSupported(false);
      return;
    }

    const rec = new SpeechRecognitionClass();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setContent((prev) => {
          const suffix = prev.endsWith(' ') || prev.length === 0 ? '' : ' ';
          return prev + suffix + finalTranscript;
        });
      }
    };

    rec.onerror = (err: any) => {
      console.error('Speech recognition error:', err);
      if (err.error === 'not-allowed') {
        setError('Microphone access was denied. Please allow microphone access in your browser settings.');
      } else if (err.error === 'network') {
        setError('A network error occurred during voice transcription. Check your internet connection.');
      } else {
        setError(`Voice input error: ${err.error}`);
      }
      setIsRecording(false);
    };

    rec.onend = () => {
      setIsRecording(false);
    };

    setRecognition(rec);

    return () => {
      try {
        rec.stop();
      } catch (e) {}
    };
  }, []);

  const toggleRecording = () => {
    if (!recognition) {
      setError('Voice dictation is not supported in this browser. Please use Chrome, Safari, or Edge.');
      return;
    }

    if (isRecording) {
      recognition.stop();
      setIsRecording(false);
    } else {
      setError(null);
      try {
        recognition.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start voice recognition:', err);
        setError('Failed to start recording. Please try again.');
      }
    }
  };


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

      {pendingPrompt && !activeEntry && !savedData && (
        <div className="mb-6 bg-[#FAF6EE] border border-[#AF5D45]/30 rounded-2xl p-5 shadow-sm animate-fade-in flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex gap-3">
            <Sparkles className="w-5 h-5 text-[#AF5D45] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#2C2621]">Solace reached out:</p>
              <p className="text-sm text-[#4A3F35] font-serif italic">"{pendingPrompt.promptText}"</p>
            </div>
          </div>
          <button
            onClick={() => {
              setTitle('Reflecting on Solace\'s thought');
              setContent(`*In response to: "${pendingPrompt.promptText}"*\n\n`);
              // Mark as delivered in background
              fetch(`${API_BASE}/api/memories/prompt/${pendingPrompt.id}/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ responseText: 'Acknowledged through new entry.' })
              }).then(() => setPendingPrompt(null));
            }}
            className="text-xs bg-[#FFFDF9] border border-[#DFD5C4] hover:border-[#AF5D45] text-[#AF5D45] px-4 py-2 rounded-xl transition font-semibold shrink-0"
          >
            Write in response
          </button>
        </div>
      )}

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

          {/* Voice to Text Dictation Bar */}
          <div className="flex items-center justify-between border-b border-[#E3DAC9]/60 pb-2 pt-1">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#827468]">
              Journal Page
            </span>
            <button
              type="button"
              onClick={toggleRecording}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition border cursor-pointer select-none ${
                isRecording
                  ? 'bg-orange-50 border-[#AF5D45] text-[#AF5D45] animate-pulse ring-2 ring-[#AF5D45]/10'
                  : speechSupported
                  ? 'bg-[#FAF6EE] border-[#DFD5C4] hover:border-[#4A6447] text-[#60554C] hover:text-[#2C2621]'
                  : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
              }`}
              title={speechSupported ? "Voice to Text (Dictate)" : "Voice dictation is unsupported in this browser"}
              disabled={!speechSupported}
            >
              {isRecording ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#AF5D45] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#AF5D45]"></span>
                  </span>
                  <span>Listening (Tap to stop)...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>{speechSupported ? 'Dictate Thoughts' : 'Voice Unsupported'}</span>
                </>
              )}
            </button>
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
