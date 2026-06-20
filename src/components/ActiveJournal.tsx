import React, { useState, useEffect } from 'react';
import { BookOpen, AlertCircle, Save, CheckCircle, Heart, Notebook, Mic, Sparkles, Eye, EyeOff, Trash, X, Paperclip, Image as LucideImage } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { JournalEntry, ImageAsset } from '../types';
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
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<ImageAsset[]>([]);
  const [deletedImageIds, setDeletedImageIds] = useState<string[]>([]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

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
      setExistingImages(activeEntry.images || []);
      setSavedData(null);
    } else {
      setTitle('');
      setContent('');
      setExistingImages([]);
      setSavedData(null);
    }
    // Clear preview states when loading an entry
    setSelectedFiles([]);
    setPreviews([]);
    setDeletedImageIds([]);
  }, [activeEntry]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    
    const validFiles: File[] = [];
    let fileError: string | null = null;

    files.forEach((file) => {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimes.includes(file.type)) {
        fileError = 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        fileError = 'File size limit exceeded. Images must be smaller than 5MB.';
        return;
      }
      validFiles.push(file);
    });

    if (fileError) {
      setError(fileError);
      return;
    }

    const newFiles = [...selectedFiles, ...validFiles];
    setSelectedFiles(newFiles);

    const newPreviews = validFiles.map((file) => URL.createObjectURL(file));
    setPreviews([...previews, ...newPreviews]);
    setError(null);
  };

  const removeSelectedFile = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const markExistingImageForDeletion = (id: string) => {
    setDeletedImageIds((prev) => [...prev, id]);
    setExistingImages((prev) => prev.filter((img) => img.id !== id));
  };

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
        'Authorization': `Bearer ${token}`
      };
      if (userApiKey) {
        headers['x-gemini-api-key'] = userApiKey;
      }
      if (customPrompt) {
        headers['x-custom-prompt'] = customPrompt;
      }

      const formData = new FormData();
      formData.append('title', title || 'Untitled Reflection');
      formData.append('content', content);

      selectedFiles.forEach((file) => {
        formData.append('images', file);
      });

      if (deletedImageIds.length > 0) {
        formData.append('deletedImageIds', JSON.stringify(deletedImageIds));
      }

      const response = await fetch(`${API_BASE}${url}`, {
        method,
        headers,
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze and save thoughts.');
      }

      setSavedData(data);
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      
      // Clear file upload states and update current images
      setSelectedFiles([]);
      setPreviews([]);
      setDeletedImageIds([]);
      if (data && data.images) {
        setExistingImages(data.images);
      }

      onSaveSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save entry. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] relative z-10">
      
      {/* Top Header - Fades out in focus mode */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.div 
            initial={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden', marginBottom: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-between border-b border-white/5 pb-5 mb-8"
          >
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white/[0.03] border border-white/10 rounded-xl flex items-center justify-center text-[#8B5CF6]">
                <Notebook className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-serif font-bold text-[#F3F3F5] tracking-tight">
                  {activeEntry ? 'Edit Reflection' : 'New Reflection'}
                </h2>
                <p className="text-xs text-[#ADA9BA] leading-relaxed">Transcribe your day. AI analysis aggregates tags and emotional loops automatically.</p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="text-xs font-bold text-[#ADA9BA] hover:text-[#F3F3F5] bg-white/[0.04] hover:bg-white/[0.08] px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Daily proactive reflection prompt card */}
      <AnimatePresence>
        {pendingPrompt && !activeEntry && !savedData && !isFocusMode && (
          <motion.div 
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="mb-6 bg-gradient-to-r from-[#8B5CF6]/10 via-[#EC4899]/10 to-transparent border border-[#8B5CF6]/20 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden backdrop-blur-md"
          >
            <div className="absolute top-0 left-0 w-[3px] h-full bg-gradient-to-b from-[#8B5CF6] to-[#EC4899]" />
            <div className="flex gap-3">
              <Sparkles className="w-5 h-5 text-[#8B5CF6] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-[#ADA9BA] uppercase tracking-wider">A thought to capture</p>
                <p className="text-sm text-[#F3F3F5] font-serif italic mt-0.5">"{pendingPrompt.promptText}"</p>
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
              className="text-xs bg-white/[0.04] border border-white/10 hover:border-[#8B5CF6] text-[#E7E7EC] px-4 py-2 rounded-xl transition-all duration-200 font-semibold shrink-0"
            >
              Respond
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Grid: Left = Editor, Right = AI Companion / Meta */}
      <div className={`grid grid-cols-1 ${isFocusMode ? 'lg:grid-cols-1' : 'lg:grid-cols-3'} gap-8 transition-all duration-500`}>
        
        {/* Lined Notebook Paper Writer Area */}
        <motion.form 
          layout
          onSubmit={handleSave} 
          className="lg:col-span-2 glass-card rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 relative overflow-hidden"
        >
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-3 text-rose-300 text-xs animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Form Actions Header inside Editor */}
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">
              {isFocusMode ? 'Focus Sanctuary' : 'Reflection Page'}
            </span>
            
            <div className="flex items-center gap-3">
              {/* Focus Mode Trigger */}
              <button
                type="button"
                onClick={() => setIsFocusMode(!isFocusMode)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-white/10 text-[#ADA9BA] hover:text-[#F3F3F5] transition cursor-pointer select-none"
                title={isFocusMode ? "Leave Focus Mode" : "Enter Distraction-Free Focus"}
              >
                {isFocusMode ? (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Exit Focus</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Focus Mode</span>
                  </>
                )}
              </button>

              {/* Dictation */}
              <button
                type="button"
                onClick={toggleRecording}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition border cursor-pointer select-none ${
                  isRecording
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 animate-pulse ring-2 ring-rose-500/10'
                    : speechSupported
                    ? 'bg-white/[0.04] border-white/5 hover:border-[#8B5CF6] text-[#ADA9BA] hover:text-[#F3F3F5]'
                    : 'bg-white/[0.01] border-white/5 text-zinc-600 cursor-not-allowed opacity-60'
                }`}
                title={speechSupported ? "Voice dictation" : "Voice unsupported"}
                disabled={!speechSupported}
              >
                {isRecording ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    <span>Listening...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>{speechSupported ? 'Dictate' : 'Dictate'}</span>
                  </>
                )}
              </button>

              {/* Attach Images */}
              <label
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] border border-white/5 hover:border-[#8B5CF6] text-[#ADA9BA] hover:text-[#F3F3F5] transition cursor-pointer select-none"
                title="Attach images (< 5MB)"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span>Attach</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          {/* Title Area */}
          <div className="space-y-1">
            <input
              type="text"
              placeholder="Title your entry (optional)..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent text-xl md:text-2xl font-serif font-bold text-[#F3F3F5] placeholder-[#ADA9BA]/30 border-b border-white/5 py-2 outline-none transition focus:border-[#8B5CF6]"
            />
          </div>

          {/* Text Area */}
          <div className="min-h-[350px] flex flex-col relative">
            <textarea
              placeholder="Begin writing down your thoughts, emotions, dreams..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full grow bg-transparent text-[#E7E7EC] placeholder-[#ADA9BA]/20 text-base leading-relaxed resize-none outline-none focus:ring-0 min-h-[350px] font-sans"
              style={{
                background: 'linear-gradient(var(--notebook-line, rgba(255, 255, 255, 0.02)) 1px, transparent 1px)',
                backgroundSize: '100% 2.2rem',
                lineHeight: '2.2rem'
              }}
            />
          </div>

          {/* Attached Assets Gallery / Previews Grid */}
          {(existingImages.length > 0 || previews.length > 0) && (
            <div className="space-y-3.5 pt-4 border-t border-white/5 animate-fade-in">
              <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">
                Attached Assets ({existingImages.length + previews.length})
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3.5">
                {/* Existing Saved Images */}
                {existingImages.map((img) => (
                  <div key={img.id} className="relative aspect-square rounded-2xl overflow-hidden border border-white/5 group shadow-md bg-white/[0.02]">
                    <img
                      src={img.imageUrl.startsWith('/') ? `${API_BASE}${img.imageUrl}` : img.imageUrl}
                      alt="Journal Entry Image"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => markExistingImageForDeletion(img.id)}
                        className="p-2 bg-rose-500/20 hover:bg-rose-500/80 text-rose-300 hover:text-white rounded-xl transition duration-200 cursor-pointer border border-rose-500/30"
                        title="Delete image"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* New Image Previews */}
                {previews.map((url, idx) => (
                  <div key={url} className="relative aspect-square rounded-2xl overflow-hidden border-2 border-dashed border-[#8B5CF6]/30 group shadow-md bg-white/[0.02]">
                    <img
                      src={url}
                      alt="Upload Preview"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-[#8B5CF6] text-white rounded-md shadow-md">
                      New
                    </div>
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(idx)}
                        className="p-2 bg-rose-500/20 hover:bg-rose-500/80 text-rose-300 hover:text-white rounded-xl transition duration-200 cursor-pointer border border-rose-500/30"
                        title="Remove preview"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer Metadata & Save button */}
          <div className="flex items-center justify-between pt-5 border-t border-white/5 text-xs text-[#ADA9BA] font-medium">
            <div className="flex gap-4">
              <span>{wordCount} words</span>
              <span>{charCount} characters</span>
            </div>
            
            <div className="flex items-center gap-3">
              {lastSavedTime && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-sans">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
                  Saved at {lastSavedTime}
                </span>
              )}

              <button
                type="submit"
                disabled={loading}
                className="bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] hover:from-[#7C3AED] hover:to-[#4F46E5] text-white font-bold px-5 py-3 rounded-xl text-xs transition-all duration-300 flex items-center gap-2 shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 group cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Entry
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.form>

        {/* Dynamic AI Companion Reflection Sidebar - Fades out in focus mode */}
        <AnimatePresence>
          {!isFocusMode && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, width: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6 lg:w-full"
            >
              {loading ? (
                <div className="p-8 glass-card rounded-3xl flex flex-col items-center justify-center text-center py-20 shadow-sm animate-pulse border border-white/5">
                  <div className="w-12 h-12 rounded-2xl bg-[#8B5CF6]/10 flex items-center justify-center mb-4">
                    <Heart className="w-6 h-6 text-[#EC4899] fill-[#EC4899] animate-bounce" />
                  </div>
                  <p className="text-md font-serif font-bold text-[#F3F3F5]">AI Cognitive Sync</p>
                  <p className="text-xs text-[#ADA9BA] mt-2 max-w-[200px] leading-relaxed">Mining thoughts for tags, mood vectors, and semantic relationships...</p>
                </div>
              ) : savedData ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 glass-card rounded-3xl space-y-6 shadow-sm border border-emerald-500/10"
                >
                  <div className="flex items-center gap-2.5 text-emerald-400 font-medium">
                    <CheckCircle className="w-5 h-5 shrink-0" />
                    <span className="font-serif font-semibold text-lg text-[#F3F3F5]">Saved Successfully</span>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">Primary Emotion</span>
                    <span className="inline-block px-3 py-1 text-xs font-bold rounded-full capitalize bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 shadow-sm shadow-indigo-500/5">
                      {savedData.mood}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#ADA9BA]">Detected Tags</span>
                    <div className="flex flex-wrap gap-1.5">
                      {savedData.tags && savedData.tags.length > 0 ? (
                        savedData.tags.map((tg) => (
                          <span key={tg} className="text-xs bg-white/[0.04] hover:bg-white/[0.08] text-[#ADA9BA] hover:text-[#F3F3F5] px-2.5 py-1 rounded-lg border border-white/5 transition-all">
                            #{tg}
                          </span>
                        ))
                      ) : (
                        <span className="text-[#ADA9BA] text-xs">No tags detected today.</span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-[#ADA9BA] leading-relaxed italic bg-white/[0.02] p-4 rounded-2xl border border-white/5 font-serif">
                    "This memory has been safely archived in your story constellation."
                  </p>
                </motion.div>
              ) : (
                <div className="p-6 glass-card rounded-3xl space-y-5 shadow-sm border border-white/5">
                  <div className="flex items-center gap-2 text-[#8B5CF6]">
                    <Heart className="w-4 h-4 text-[#EC4899] fill-[#EC4899]" />
                    <span className="text-xs font-sans font-bold uppercase tracking-wider">AI companion</span>
                  </div>
                  <p className="text-xs text-[#ADA9BA] leading-relaxed">
                    When you save your entry, Solace will analyze your text to map key emotion patterns, create tag indices, and compile semantic vectors.
                  </p>
                  
                  <div className="text-xs space-y-3 pt-2 text-[#ADA9BA]">
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span>Sentiment Mapping</span>
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
                        Listening
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span>Reflective Presets</span>
                      <span className="text-emerald-400 font-semibold">Active</span>
                    </div>
                    <div className="flex justify-between pb-1">
                      <span>Memory Indexing</span>
                      <span className="text-[#8B5CF6] font-semibold">Ready</span>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
