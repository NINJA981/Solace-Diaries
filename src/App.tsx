import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  BookOpen,
  Calendar,
  Search,
  MessageSquare,
  TrendingUp,
  LogOut,
  User,
  Heart,
  Menu,
  X,
  Settings,
  Eye,
  EyeOff,
  Check,
  HelpCircle,
  Activity,
  Shield,
  Brain,
  Compass,
  Users,
  Key,
  RefreshCw,
  Sliders,
  Cpu,
  ExternalLink,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import LoginScreen from './components/LoginScreen';
import ActiveJournal from './components/ActiveJournal';
import EntriesList from './components/EntriesList';
import SemanticSearch from './components/SemanticSearch';
import MemoryChat from './components/MemoryChat';
import WeeklyInsights from './components/WeeklyInsights';
import MemoriesDashboard from './components/MemoriesDashboard';
import BackgroundOrbs from './components/BackgroundOrbs';
import MemorySpark from './components/MemorySpark';
import { JournalEntry } from './types';
import { API_BASE } from './api';

const PRESETS = [
  {
    name: "🌿 Satori (Philosophical)",
    desc: "IFS-informed parts work, self-compassion, Stoic and Taoist wisdom.",
    prompt: "Adopt a warm, compassionate, and deeply philosophical tone. Draw on Internal Family Systems (IFS) to help identify protective and vulnerable parts of my emotions, and Compassion-Focused Therapy (CFT) to soothingly validate struggles. Integrate Stoic and Taoist perspectives on acceptance."
  },
  {
    name: "🧠 CBT Coach",
    desc: "Evidence-based reframing, logical restructuring, distortion alerts.",
    prompt: "Adopt a practical, structured, and action-oriented tone of a Cognitive Behavioral Therapy (CBT) coach. Focus on helping me identify cognitive distortions (e.g., catastrophizing, black-and-white thinking, emotional reasoning) and guide me through realistic, evidence-based reframing exercises."
  },
  {
    name: "🧘 Zen Witness",
    desc: "Pure presence, breathing guidance, zero analysis or judgment.",
    prompt: "Adopt a minimalist, deeply validating, and calm presence. Do not analyze, solve, or offer intellectual advice. Focus purely on echoing back core feelings with extreme empathy, encouraging mindful breathing, and anchoring me in the present moment."
  },
  {
    name: "🌀 Jungian Analyst",
    desc: "Unconscious shadow work, dream analysis, metaphor parsing.",
    prompt: "Adopt the persona of a Jungian depth psychologist. Look for recurring symbols, metaphors, unconscious patterns, and potential 'shadow' aspects of my personality in my entries. Guide me toward integration and exploring my dreamlike state of mind."
  },
  {
    name: "📣 Cheerleader",
    desc: "Inspirational, high energy, unconditional positive regard.",
    prompt: "Adopt a high-energy, warm, and enthusiastically supportive tone. Act as my biggest cheerleader, highlighting every tiny win, reinforcing positive aspects, and offering unconditional positive regard and warm encouragement to boost my confidence."
  },
  {
    name: "🏛️ Stoic Philosopher",
    desc: "Equanimity, self-discipline, dichotomy of control.",
    prompt: "Adopt the calm, resilient, and objective voice of a Stoic philosopher. Help me separate what is in my control from what is not. Emphasize emotional equanimity, virtue, self-discipline, and finding strength or wisdom in life's challenges."
  },
  {
    name: "❓ Socratic Guide",
    desc: "Deep curious questions that lead to self-realization.",
    prompt: "Do not give answers, solutions, or direct advice. Instead, ask deep, curious, and clarifying Socratic questions that prompt me to look deeper, challenge my own assumptions, and find my own inner wisdom."
  },
  {
    name: "✨ Poetic Soul",
    desc: "Artistic, literary, framing life through seasonal growth.",
    prompt: "Adopt a poetic, literary, and evocative tone. Reflect my entries back to me using beautiful natural metaphors, seasonal themes, and artistic prose, treating my life story as a rich, evolving work of literature."
  },
  {
    name: "🤝 Accountability",
    desc: "Logical tracker check-in, tracking goals and values alignment.",
    prompt: "Adopt a direct, logical, and highly structured tone. Focus on my progress, actions, consistency, and patterns of behavior. Help me clarify my goals and evaluate if my current choices align with my stated core values."
  },
  {
    name: "👥 IFS Explorer",
    desc: "Explore internal family systems, welcome internal parts.",
    prompt: "Focus explicitly on Internal Family Systems (IFS) parts work. Help me identify, name, and get to know the different parts of my system (e.g., my inner critic, an anxious protector, an over-achieving part, or a hurt child part) and check if I can speak to them from a space of calm, curious Core Self."
  }
];

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [activeTab, setActiveTab] = useState<'write' | 'list' | 'search' | 'chat' | 'insights' | 'memories' | 'settings'>('write');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [userApiKey, setUserApiKey] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [keyTestingStatus, setKeyTestingStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('journal_theme') as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    const bodyClass = document.body.classList;
    if (theme === 'light') {
      bodyClass.add('light');
    } else {
      bodyClass.remove('light');
    }
    localStorage.setItem('journal_theme', theme);
  }, [theme]);

  const testApiKey = async () => {
    if (!userApiKey) return;
    setKeyTestingStatus('testing');
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash?key=${userApiKey}`);
      if (res.ok) {
        setKeyTestingStatus('valid');
      } else {
        setKeyTestingStatus('invalid');
      }
    } catch (e) {
      setKeyTestingStatus('invalid');
    }
  };

  // Restore authenticated session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('journal_jwt_token');
    const savedEmail = localStorage.getItem('journal_user_email');
    const savedApiKey = localStorage.getItem('journal_gemini_api_key');
    const savedCustomPrompt = localStorage.getItem('journal_custom_prompt');
    if (savedToken && savedEmail) {
      setToken(savedToken);
      setEmail(savedEmail);
    }
    if (savedApiKey) {
      setUserApiKey(savedApiKey);
    }
    if (savedCustomPrompt) {
      setCustomPrompt(savedCustomPrompt);
    }
  }, []);

  // Fetch entries whenever token resolves
  const fetchEntries = async (activeAuthToken: string) => {
    setLoadingEntries(true);
    try {
      const response = await fetch(`${API_BASE}/api/entries`, {
        headers: {
          'Authorization': `Bearer ${activeAuthToken}`
        }
      });
      const data = await response.json();
      if (response.ok) {
        setEntries(data);
      } else {
        // Clear stale session
        if (response.status === 401) {
          handleLogout();
        }
      }
    } catch (err) {
      console.error('Failed to resolve database entries.', err);
    } finally {
      setLoadingEntries(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchEntries(token);
    }
  }, [token]);

  const handleLoginSuccess = (newToken: string, userEmail: string) => {
    localStorage.setItem('journal_jwt_token', newToken);
    localStorage.setItem('journal_user_email', userEmail);
    setToken(newToken);
    setEmail(userEmail);
  };

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (err) {
        console.warn('Silent local logout resolved', err);
      }
    }
    localStorage.removeItem('journal_jwt_token');
    localStorage.removeItem('journal_user_email');
    setToken(null);
    setEmail('');
    setEntries([]);
    setActiveEntry(null);
    setActiveTab('write');
  };

  const handleDeleteEntry = async (id: string) => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/entries/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        if (activeEntry?.id === id) {
          setActiveEntry(null);
        }
      }
    } catch (err) {
      console.error('Failed to remove journal from storage index', err);
    }
  };

  const handleEditEntry = (entry: JournalEntry) => {
    setActiveEntry(entry);
    setActiveTab('write');
  };

  const handleSaveSuccess = () => {
    if (token) {
      fetchEntries(token);
    }
  };

  if (!token) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen md:h-screen bg-[var(--bg-main)] flex flex-col font-sans text-[var(--text-main)] relative overflow-hidden transition-colors duration-300">
      {/* Background ambient lighting */}
      {theme === 'dark' && <BackgroundOrbs />}

      {/* Top Minimalist Navigation (Desktop) - Hides in Focus Mode */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.header
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="hidden md:flex fixed top-0 left-0 right-0 z-40 p-4 items-center justify-between pointer-events-none"
          >
            <div className="flex items-center gap-3 pointer-events-auto">
              <div className="w-10 h-10 bg-white/[0.02] backdrop-blur-md border border-white/10 rounded-[2px] flex items-center justify-center shadow-sm">
                <Heart className="w-5 h-5 text-[var(--accent-heart)] fill-[var(--accent-heart)]" />
              </div>
              <span className="font-serif font-bold text-[#F3F3F5] tracking-tight">Solace Diaries</span>
            </div>

            <nav className="flex items-center gap-1 bg-white/[0.02] backdrop-blur-md border border-white/10 p-1 rounded-[2px] shadow-sm pointer-events-auto">
              <button onClick={() => { setActiveTab('write'); setActiveEntry(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold transition-all ${activeTab === 'write' ? 'bg-[var(--accent-color)] text-white shadow-md' : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.04]'}`}> <BookOpen className="w-4 h-4" /> <span>Write</span> </button>
              <button onClick={() => setActiveTab('list')} className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold transition-all ${activeTab === 'list' ? 'bg-[var(--accent-color)] text-white shadow-md' : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.04]'}`}> <Calendar className="w-4 h-4" /> <span>Entries</span> </button>
              <button onClick={() => setActiveTab('search')} className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold transition-all ${activeTab === 'search' ? 'bg-[var(--accent-color)] text-white shadow-md' : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.04]'}`}> <Search className="w-4 h-4" /> <span>Search</span> </button>
              <button onClick={() => setActiveTab('chat')} className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold transition-all ${activeTab === 'chat' ? 'bg-[var(--accent-color)] text-white shadow-md' : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.04]'}`}> <MessageSquare className="w-4 h-4" /> <span>Chat</span> </button>
              <button onClick={() => setActiveTab('insights')} className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold transition-all ${activeTab === 'insights' ? 'bg-[var(--accent-color)] text-white shadow-md' : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.04]'}`}> <TrendingUp className="w-4 h-4" /> <span>Insights</span> </button>
              <button onClick={() => setActiveTab('memories')} className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-xs font-semibold transition-all ${activeTab === 'memories' ? 'bg-[var(--accent-color)] text-white shadow-md' : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.04]'}`}> <Brain className="w-4 h-4" /> <span>Memories</span> </button>
            </nav>

            <div className="flex items-center gap-2 pointer-events-auto">
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="w-10 h-10 bg-white/[0.02] backdrop-blur-md border border-white/10 rounded-[2px] flex items-center justify-center text-[#ADA9BA] hover:text-[var(--accent-color)] transition cursor-pointer">
                {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
              </button>
              <button onClick={() => setActiveTab('settings')} className="w-10 h-10 bg-white/[0.02] backdrop-blur-md border border-white/10 rounded-[2px] flex items-center justify-center text-[#ADA9BA] hover:text-[var(--accent-color)] transition cursor-pointer">
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={handleLogout} className="w-10 h-10 bg-white/[0.02] backdrop-blur-md border border-white/10 rounded-[2px] flex items-center justify-center text-[#ADA9BA] hover:text-rose-400 transition cursor-pointer">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Main workspace frame */}
      <main className={`grow relative z-10 flex flex-col min-h-0 ${isFocusMode ? '' : 'md:pt-24 pb-24 md:pb-8'} ${activeTab === 'chat' ? 'overflow-hidden' : 'overflow-y-auto scrollbar-thin'}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab + (activeEntry ? `-${activeEntry.id}` : '')}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="grow flex flex-col min-h-0 w-full max-w-6xl mx-auto"
          >
            {activeTab === 'write' && (
              <ActiveJournal
                token={token}
                userApiKey={userApiKey}
                customPrompt={customPrompt}
                activeEntry={activeEntry}
                onSaveSuccess={handleSaveSuccess}
                onCancel={() => {
                  setActiveEntry(null);
                  setActiveTab('list');
                }}
                isFocusMode={isFocusMode}
                setIsFocusMode={setIsFocusMode}
              />
            )}

            {activeTab === 'list' && (
              <EntriesList
                entries={entries}
                onEditEntry={handleEditEntry}
                onDeleteEntry={handleDeleteEntry}
              />
            )}

            {activeTab === 'search' && <SemanticSearch token={token} userApiKey={userApiKey} />}

            {activeTab === 'chat' && <MemoryChat token={token} userApiKey={userApiKey} customPrompt={customPrompt} />}

            {activeTab === 'insights' && <WeeklyInsights token={token} userApiKey={userApiKey} entriesCount={entries.length} customPrompt={customPrompt} />}

            {activeTab === 'memories' && <MemoriesDashboard token={token} />}

            {activeTab === 'settings' && (
              <div className="max-w-6xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] space-y-8">
                {/* Header banner */}
                <div className="border-b border-white/5 pb-5 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-serif font-bold text-[#F3F3F5] flex items-center gap-3">
                      <Settings className="w-7 h-7 text-[var(--accent-color)]" />
                      Settings
                    </h2>
                    <p className="text-sm text-[#ADA9BA] mt-1">Customize your private journal workspace, system prompts, and API credentials.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: AI Persona Options (Col-span 7) */}
                  <div className="lg:col-span-7 space-y-6">
                    <div className="glass-card rounded-[2px] p-6 shadow-sm space-y-6">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-4">
                        <Sliders className="w-5 h-5 text-[var(--accent-color)]" />
                        <h3 className="font-serif font-bold text-lg text-[#F3F3F5]">AI Response Tone</h3>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-bold text-[#ADA9BA] uppercase tracking-wider">
                            Current System Prompt
                          </label>
                          <p className="text-xs text-[#ADA9BA]">
                            This shapes the tone and behavior of the AI for your daily analyses, summaries, and chat responses.
                          </p>
                        </div>

                        <textarea
                          placeholder="E.g., Adopt a warm, compassionate, Stoicism-focused voice..."
                          value={customPrompt || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomPrompt(val || null);
                            if (val.trim()) {
                              localStorage.setItem('journal_custom_prompt', val);
                            } else {
                              localStorage.removeItem('journal_custom_prompt');
                            }
                          }}
                          className="w-full glass-input rounded-[2px] py-3 px-4 text-xs placeholder-[#ADA9BA]/40 outline-none transition min-h-[120px] leading-relaxed resize-y font-mono"
                        />

                        {customPrompt ? (
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                              <Check className="w-3 h-3" /> Custom Prompt Active
                            </span>
                            <button
                              onClick={() => {
                                setCustomPrompt(null);
                                localStorage.removeItem('journal_custom_prompt');
                              }}
                              className="text-xs font-semibold text-[var(--accent-color)] hover:underline flex items-center gap-1 transition"
                            >
                              <RefreshCw className="w-3 h-3" /> Reset to Default (Satori - Warm & Philosophical)
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-[#ADA9BA] block">
                            Using Default: 🌿 Satori (Warm & Philosophical)
                          </span>
                        )}
                      </div>

                      {/* 10 click presets grid */}
                      <div className="space-y-3 pt-4 border-t border-white/5">
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-[#ADA9BA] uppercase tracking-wider">
                            Tone Presets
                          </h4>
                          <p className="text-xs text-[#ADA9BA]">
                            Choose a preset style for how the AI responds to your journal entries.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {PRESETS.map((p) => {
                            const isActive = customPrompt === p.prompt || (!customPrompt && p.name.includes("Satori"));
                            
                            // Map specific icon for each preset style
                            let PresetIcon = Sparkles;
                            if (p.name.includes("CBT")) PresetIcon = Brain;
                            else if (p.name.includes("Zen")) PresetIcon = Heart;
                            else if (p.name.includes("Jungian")) PresetIcon = Compass;
                            else if (p.name.includes("Stoic")) PresetIcon = Shield;
                            else if (p.name.includes("Accountability")) PresetIcon = Activity;
                            else if (p.name.includes("Socratic")) PresetIcon = HelpCircle;
                            else if (p.name.includes("IFS")) PresetIcon = Users;
                            else if (p.name.includes("Poetic")) PresetIcon = Compass;

                            return (
                              <button
                                key={p.name}
                                onClick={() => {
                                  setCustomPrompt(p.prompt);
                                  localStorage.setItem('journal_custom_prompt', p.prompt);
                                }}
                                className={`text-left border p-3 rounded-[2px] cursor-pointer transition-all duration-300 flex gap-3 items-start select-none ${
                                  isActive
                                    ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)] ring-2 ring-[var(--accent-color)]/10 text-[var(--text-title)] font-bold'
                                    : 'glass-card hover:bg-white/[0.04] border-white/5 hover:border-white/10 text-[#ADA9BA] hover:text-[#F3F3F5]'
                                }`}
                              >
                                <div className={`p-2 rounded-[2px] shrink-0 ${isActive ? 'bg-[var(--accent-color)] text-white' : 'bg-white/[0.04] text-[#ADA9BA]'}`}>
                                  <PresetIcon className="w-4 h-4" />
                                </div>
                                <div className="space-y-0.5">
                                  <span className="font-bold text-[#F3F3F5] block text-xs flex items-center gap-1.5">
                                    {p.name}
                                    {isActive && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                                  </span>
                                  <span className="text-[10px] leading-normal block opacity-80">{p.desc}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: API & Privacy (Col-span 5) */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Credentials Panel */}
                    <div className="glass-card rounded-[2px] p-6 shadow-sm space-y-5">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-4">
                        <Key className="w-5 h-5 text-[var(--accent-color)]" />
                        <h3 className="font-serif font-bold text-lg text-[#F3F3F5]">API Credentials</h3>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-bold text-[#ADA9BA] uppercase tracking-wider">
                            Gemini API Key
                          </label>
                          <div className="relative">
                            <input
                              type={showApiKey ? "text" : "password"}
                              placeholder={userApiKey ? "••••••••••••••••••••••••" : "Paste your Gemini API key..."}
                              value={userApiKey || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setUserApiKey(val || null);
                                setKeyTestingStatus('idle');
                                if (val.trim()) {
                                  localStorage.setItem('journal_gemini_api_key', val.trim());
                                } else {
                                  localStorage.removeItem('journal_gemini_api_key');
                                }
                              }}
                              className="w-full glass-input rounded-[2px] py-2.5 pl-4 pr-10 text-xs font-mono placeholder-[#ADA9BA]/40 outline-none transition"
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#ADA9BA] hover:text-[#F3F3F5] transition"
                            >
                              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <p className="text-[11px] text-[#ADA9BA] leading-relaxed">
                          Search indexing, entry analysis, summaries, and chat features will use your custom API key.
                        </p>

                        {/* Test and status buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={testApiKey}
                            disabled={!userApiKey || keyTestingStatus === 'testing'}
                            className="flex-1 bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] text-white font-bold py-2 px-3 rounded-[2px] transition cursor-pointer text-xs flex items-center justify-center gap-1.5"
                          >
                            {keyTestingStatus === 'testing' ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Verifying...
                              </>
                            ) : (
                              <>
                                <Activity className="w-3.5 h-3.5" />
                                Test Connection
                              </>
                            )}
                          </button>

                          {userApiKey && (
                            <button
                              onClick={() => {
                                setUserApiKey(null);
                                localStorage.removeItem('journal_gemini_api_key');
                                setKeyTestingStatus('idle');
                              }}
                              className="bg-transparent border border-rose-500/50 hover:bg-rose-500/10 text-rose-400 font-bold py-2 px-3 rounded-[2px] transition cursor-pointer text-xs"
                            >
                              Clear Key
                            </button>
                          )}
                        </div>

                        {/* Connection Test Result Feedback */}
                        {keyTestingStatus === 'testing' && (
                          <div className="p-3 rounded-[2px] text-xs flex gap-2.5 items-center border bg-white/[0.01] border-white/5 text-[#ADA9BA] animate-pulse">
                            <RefreshCw className="w-4 h-4 animate-spin text-[var(--accent-color)] shrink-0" />
                            <div>
                              <p className="font-bold text-[#F3F3F5]">Verifying connection...</p>
                              <p className="text-[10px] opacity-90 mt-0.5">Connecting to the Google Gemini API.</p>
                            </div>
                          </div>
                        )}

                        {keyTestingStatus !== 'idle' && keyTestingStatus !== 'testing' && (
                          <div className={`p-3 rounded-[2px] text-xs flex gap-2.5 items-start border animate-fade-in ${
                            keyTestingStatus === 'valid'
                              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                              : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
                          }`}>
                            <div className="shrink-0 mt-0.5">
                              {keyTestingStatus === 'valid' ? <Check className="w-4 h-4" /> : <HelpCircle className="w-4 h-4" />}
                            </div>
                            <div>
                              <p className="font-bold">
                                {keyTestingStatus === 'valid' ? 'Verified Successfully' : 'Verification Failed'}
                              </p>
                              <p className="text-[10px] opacity-90 mt-0.5">
                                {keyTestingStatus === 'valid'
                                  ? 'Your API key is active and successfully communicated with Gemini API endpoints.'
                                  : 'The API returned an authentication error. Verify the characters and ensure billing or usage constraints are met.'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Secure Architecture Info Card */}
                    <div className="glass-card rounded-[2px] p-5 space-y-4 text-[#ADA9BA]">
                      <div className="flex items-center gap-2 text-[#F3F3F5] font-bold text-xs uppercase tracking-wider">
                        <Shield className="w-4.5 h-4.5 text-[var(--accent-color)]" />
                        <span>Security & Sandbox Privacy</span>
                      </div>
                      <p className="text-xs leading-relaxed">
                        Solace Diaries is built with a client-only architecture. Your API key and custom system prompts are stored only in your browser's local storage.
                      </p>
                      <p className="text-xs leading-relaxed">
                        Requests to analyze or query entries run directly from your browser, meaning your keys are never sent to or stored on any external databases.
                      </p>
                      <div className="pt-2">
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[var(--accent-color)] underline underline-offset-2 hover:text-white transition inline-flex items-center gap-1"
                        >
                          Retrieve API Key from Google AI Studio
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Memory Spark (Desktop only, hides in focus) */}
      {activeTab === 'write' && !isFocusMode && <MemorySpark entries={entries} />}

      {/* Bottom Floating Action Island (Mobile) */}
      <AnimatePresence>
        {!isFocusMode && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden fixed bottom-6 left-4 right-4 z-40 flex justify-center pointer-events-none"
          >
            <nav className="flex items-center gap-1 bg-[#13111A]/90 backdrop-blur-md border border-white/10 p-2 rounded-[2px] shadow-2xl pointer-events-auto overflow-x-auto scrollbar-none w-full max-w-[400px]">
              <button onClick={() => { setActiveTab('write'); setActiveEntry(null); }} className={`p-2.5 rounded-[2px] transition shrink-0 ${activeTab === 'write' ? 'bg-[var(--accent-color)] text-white' : 'text-[#ADA9BA] hover:text-[var(--accent-color)]'}`}><BookOpen className="w-5 h-5" /></button>
              <button onClick={() => setActiveTab('list')} className={`p-2.5 rounded-[2px] transition shrink-0 ${activeTab === 'list' ? 'bg-[var(--accent-color)] text-white' : 'text-[#ADA9BA] hover:text-[var(--accent-color)]'}`}><Calendar className="w-5 h-5" /></button>
              <button onClick={() => setActiveTab('search')} className={`p-2.5 rounded-[2px] transition shrink-0 ${activeTab === 'search' ? 'bg-[var(--accent-color)] text-white' : 'text-[#ADA9BA] hover:text-[var(--accent-color)]'}`}><Search className="w-5 h-5" /></button>
              <button onClick={() => setActiveTab('chat')} className={`p-2.5 rounded-[2px] transition shrink-0 ${activeTab === 'chat' ? 'bg-[var(--accent-color)] text-white' : 'text-[#ADA9BA] hover:text-[var(--accent-color)]'}`}><MessageSquare className="w-5 h-5" /></button>
              <button onClick={() => setActiveTab('memories')} className={`p-2.5 rounded-[2px] transition shrink-0 ${activeTab === 'memories' ? 'bg-[var(--accent-color)] text-white' : 'text-[#ADA9BA] hover:text-[var(--accent-color)]'}`}><Brain className="w-5 h-5" /></button>
              <div className="w-px h-8 bg-white/10 mx-1 shrink-0" />
              <button onClick={() => setActiveTab('settings')} className={`p-2.5 rounded-[2px] transition shrink-0 ${activeTab === 'settings' ? 'bg-[var(--accent-color)] text-white' : 'text-[#ADA9BA] hover:text-[var(--accent-color)]'}`}><Settings className="w-5 h-5" /></button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
