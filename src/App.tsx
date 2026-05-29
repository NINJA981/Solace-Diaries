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
  ExternalLink
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
    <div className="min-h-screen bg-[#08070C] flex flex-col md:flex-row font-sans text-[#E7E7EC] relative overflow-hidden">
      {/* Background ambient lighting */}
      <BackgroundOrbs />

      {/* Sidebar navigation on Desktop, top header on Mobile */}
      <header className="md:hidden bg-[#13111A]/90 backdrop-blur-md border-b border-white/5 p-4 flex items-center justify-between shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/[0.03] border border-white/10 rounded-lg flex items-center justify-center text-[#8B5CF6]">
            <Heart className="w-4.5 h-4.5 fill-[#EC4899] text-[#EC4899]" />
          </div>
          <span className="font-serif font-bold text-[#F3F3F5] text-base">Solace Diaries</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-[#ADA9BA] hover:text-[#F3F3F5] transition"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      {/* Navigation sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 transform ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:sticky md:top-0 md:h-screen md:translate-x-0 transition duration-300 ease-in-out z-30 w-64 glass-panel border-r border-white/5 flex flex-col justify-between shrink-0 pt-0 md:pt-6 pb-6`}
      >
        <div className="flex flex-col space-y-6">
          {/* Logo segment */}
          <div className="p-4 border-b border-white/5 flex items-center gap-3">
            <div className="w-9 h-9 bg-white/[0.03] border border-white/10 rounded-xl flex items-center justify-center text-[#8B5CF6] shadow-sm">
              <Heart className="w-4.5 h-4.5 fill-[#EC4899] text-[#EC4899]" />
            </div>
            <div>
              <span className="block font-serif font-bold text-[#F3F3F5] text-md leading-tight">Solace Diaries</span>
              <span className="block text-[9px] text-[#ADA9BA] font-sans tracking-wide">Sanctuary of reflections</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="px-3 space-y-1">
            <button
              onClick={() => {
                setActiveTab('write');
                setActiveEntry(null);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'write'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>{activeEntry ? 'Edit Entry' : 'Write'}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('list');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'list'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Entries</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('search');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'search'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <Search className="w-4 h-4" />
              <span>Search</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('chat');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Chat</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('insights');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'insights'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Insights</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('memories');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'memories'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <Brain className="w-4 h-4" />
              <span>Memories</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('settings');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-white/[0.04] text-white border-l-2 border-[#8B5CF6] shadow-sm font-bold'
                  : 'text-[#ADA9BA] hover:text-[#F3F3F5] hover:bg-white/[0.02] border-l-2 border-transparent'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* Footer info & Logout button */}
        <div className="px-3 space-y-3">
          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl flex items-center gap-2.5 shadow-inner backdrop-blur-md">
            <div className="w-7 h-7 bg-white/[0.05] border border-white/10 rounded-lg flex items-center justify-center text-[#ADA9BA] shrink-0">
              <User className="w-3.5 h-3.5 text-[#8B5CF6]" />
            </div>
            <div className="truncate min-w-0">
              <span className="block text-[8px] font-sans font-semibold text-[#ADA9BA] uppercase tracking-wider">My Account</span>
              <span className="block text-xs font-semibold text-[#F3F3F5] truncate">{email}</span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-[#ADA9BA] hover:text-[#F43F5E] hover:bg-[#F43F5E]/10 transition-all duration-200 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main workspace frame */}
      <main className="grow overflow-y-auto relative z-10 flex flex-col min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab + (activeEntry ? `-${activeEntry.id}` : '')}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="grow"
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
                      <Settings className="w-7 h-7 text-[#8B5CF6]" />
                      Settings
                    </h2>
                    <p className="text-sm text-[#ADA9BA] mt-1">Customize your private AI sanctuary, system prompts, and API credentials.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: AI Persona Options (Col-span 7) */}
                  <div className="lg:col-span-7 space-y-6">
                    <div className="glass-card rounded-2xl p-6 shadow-sm space-y-6">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-4">
                        <Sliders className="w-5 h-5 text-[#8B5CF6]" />
                        <h3 className="font-serif font-bold text-lg text-[#F3F3F5]">AI Voice & Reflection Style</h3>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-bold text-[#ADA9BA] uppercase tracking-wider">
                            Current System Prompt
                          </label>
                          <p className="text-xs text-[#ADA9BA]">
                            This shapes the tone, perspective, and depth of your daily analyses, insights, and chats.
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
                          className="w-full glass-input rounded-xl py-3 px-4 text-xs placeholder-[#ADA9BA]/40 outline-none transition min-h-[120px] leading-relaxed resize-y font-mono"
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
                              className="text-xs font-semibold text-[#8B5CF6] hover:underline flex items-center gap-1 transition"
                            >
                              <RefreshCw className="w-3 h-3" /> Reset to Default (Satori Wisdom)
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
                            Quick Persona Presets
                          </h4>
                          <p className="text-xs text-[#ADA9BA]">
                            Instantly swap between these carefully crafted psychological and philosophical frames.
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
                                className={`text-left border p-3 rounded-xl cursor-pointer transition-all duration-300 flex gap-3 items-start select-none ${
                                  isActive
                                    ? 'bg-[#8B5CF6]/10 border-[#8B5CF6] ring-2 ring-[#8B5CF6]/10 text-white'
                                    : 'glass-card hover:bg-white/[0.04] border-white/5 hover:border-white/10 text-[#ADA9BA] hover:text-[#F3F3F5]'
                                }`}
                              >
                                <div className={`p-2 rounded-lg shrink-0 ${isActive ? 'bg-[#8B5CF6] text-white' : 'bg-white/[0.04] text-[#ADA9BA]'}`}>
                                  <PresetIcon className="w-4 h-4" />
                                </div>
                                <div className="space-y-0.5">
                                  <span className="font-bold text-[#F3F3F5] block text-xs flex items-center gap-1.5">
                                    {p.name}
                                    {isActive && <Check className="w-3.5 h-3.5 text-[#8B5CF6]" />}
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
                    <div className="glass-card rounded-2xl p-6 shadow-sm space-y-5">
                      <div className="flex items-center gap-2 border-b border-white/5 pb-4">
                        <Key className="w-5 h-5 text-[#8B5CF6]" />
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
                              className="w-full glass-input rounded-xl py-2.5 pl-4 pr-10 text-xs font-mono placeholder-[#ADA9BA]/40 outline-none transition"
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
                          All semantic search vector processing, entry parsing, summaries, and chat features will use your custom key when set.
                        </p>

                        {/* Test and status buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={testApiKey}
                            disabled={!userApiKey || keyTestingStatus === 'testing'}
                            className="flex-1 bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] hover:from-[#7C3AED] hover:to-[#4F46E5] disabled:from-[#ADA9BA]/20 disabled:to-[#ADA9BA]/20 text-white font-bold py-2 px-3 rounded-xl transition cursor-pointer text-xs flex items-center justify-center gap-1.5"
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
                              className="bg-transparent border border-rose-500/50 hover:bg-rose-500/10 text-rose-400 font-bold py-2 px-3 rounded-xl transition cursor-pointer text-xs"
                            >
                              Clear Key
                            </button>
                          )}
                        </div>

                        {/* Connection Test Result Feedback */}
                        {keyTestingStatus === 'testing' && (
                          <div className="p-3 rounded-xl text-xs flex gap-2.5 items-center border bg-white/[0.01] border-white/5 text-[#ADA9BA] animate-pulse">
                            <RefreshCw className="w-4 h-4 animate-spin text-[#8B5CF6] shrink-0" />
                            <div>
                              <p className="font-bold text-[#F3F3F5]">Verifying connection...</p>
                              <p className="text-[10px] opacity-90 mt-0.5">Attempting a secure handshake with the Google Gemini API.</p>
                            </div>
                          </div>
                        )}

                        {keyTestingStatus !== 'idle' && keyTestingStatus !== 'testing' && (
                          <div className={`p-3 rounded-xl text-xs flex gap-2.5 items-start border animate-fade-in ${
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
                    <div className="glass-card rounded-2xl p-5 space-y-4 text-[#ADA9BA]">
                      <div className="flex items-center gap-2 text-[#F3F3F5] font-bold text-xs uppercase tracking-wider">
                        <Shield className="w-4.5 h-4.5 text-[#8B5CF6]" />
                        <span>Security & Sandbox Privacy</span>
                      </div>
                      <p className="text-xs leading-relaxed">
                        Solace Diaries implements a <strong>zero server-side key footprint</strong> architecture. Your API key and custom system instructions are stored exclusively inside your browser's local sandbox (local storage).
                      </p>
                      <p className="text-xs leading-relaxed">
                        Requests to analyze or query entries utilize your API key directly on your hardware or through browser-directed requests, meaning your keys are never stored on any shared databases.
                      </p>
                      <div className="pt-2">
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-[#8B5CF6] underline underline-offset-2 hover:text-white transition inline-flex items-center gap-1"
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

      {/* Mobile Floating Profile & Sign Out (Bottom Left) */}
      <div className="md:hidden fixed bottom-4 left-4 z-40 font-sans">
        {mobileProfileOpen && (
          <div className="mb-2 p-3 bg-[#13111A]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-lg space-y-2.5 min-w-[200px] animate-fade-in">
            <div className="truncate min-w-0">
              <span className="block text-[8px] font-sans font-semibold text-[#ADA9BA] uppercase tracking-wider">My Account</span>
              <span className="block text-xs font-semibold text-[#F3F3F5] truncate">{email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#ADA9BA] hover:text-[#F43F5E] transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
        <button
          onClick={() => setMobileProfileOpen(!mobileProfileOpen)}
          className="w-10 h-10 bg-white/[0.04] border border-white/10 hover:border-[#8B5CF6] rounded-full flex items-center justify-center text-white shadow-md transition cursor-pointer active:scale-95"
        >
          <User className="w-5 h-5 text-[#8B5CF6]" />
        </button>
      </div>
    </div>
  );
}
