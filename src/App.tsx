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
  Settings
} from 'lucide-react';
import LoginScreen from './components/LoginScreen';
import ActiveJournal from './components/ActiveJournal';
import EntriesList from './components/EntriesList';
import SemanticSearch from './components/SemanticSearch';
import MemoryChat from './components/MemoryChat';
import WeeklyInsights from './components/WeeklyInsights';
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
  const [activeTab, setActiveTab] = useState<'write' | 'list' | 'search' | 'chat' | 'insights' | 'settings'>('write');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [userApiKey, setUserApiKey] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

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
    <div className="min-h-screen bg-[#FAF6EE] flex flex-col md:flex-row font-sans text-[#2C2621]">
      {/* Sidebar navigation on Desktop, top header on Mobile */}
      <header className="md:hidden bg-[#F3EDE2] border-b border-[#E3DAC9] p-4 flex items-center justify-between shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#E5ECE4] border border-[#C1D2BD] rounded-lg flex items-center justify-center text-[#4A6447]">
            <Heart className="w-4 h-4 fill-current text-[#A98E75]" />
          </div>
          <span className="font-serif font-bold text-[#2C2621] text-base">Solace Diaries</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-[#60554C] hover:text-[#2C2621] transition"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      {/* Navigation sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 transform ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:sticky md:top-0 md:h-screen md:translate-x-0 transition duration-300 ease-in-out z-30 w-64 bg-[#F3EDE2] border-r border-[#E3DAC9] flex flex-col justify-between shrink-0 pt-0 md:pt-6 pb-6`}
      >
        <div className="flex flex-col space-y-6">
          {/* Logo segment */}
          <div className="p-4 border-b border-[#E3DAC9]/60 flex items-center gap-3">
            <div className="w-9 h-9 bg-[#E5ECE4] border border-[#C1D2BD] rounded-xl flex items-center justify-center text-[#4A6447] shadow-sm">
              <Heart className="w-4.5 h-4.5 fill-[#AF5D45] text-[#AF5D45]" />
            </div>
            <div>
              <span className="block font-serif font-bold text-[#2C2621] text-md">Solace Diaries</span>
              <span className="block text-[10px] text-[#827468] font-sans tracking-wide">Simple space for reflection</span>
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition cursor-pointer ${
                activeTab === 'write'
                  ? 'bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD]'
                  : 'text-[#60554C] hover:text-[#2C2621] hover:bg-[#FAF6EE]/70 border border-transparent'
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition cursor-pointer ${
                activeTab === 'list'
                  ? 'bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD]'
                  : 'text-[#60554C] hover:text-[#2C2621] hover:bg-[#FAF6EE]/70 border border-transparent'
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition cursor-pointer ${
                activeTab === 'search'
                  ? 'bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD]'
                  : 'text-[#60554C] hover:text-[#2C2621] hover:bg-[#FAF6EE]/70 border border-transparent'
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD]'
                  : 'text-[#60554C] hover:text-[#2C2621] hover:bg-[#FAF6EE]/70 border border-transparent'
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition cursor-pointer ${
                activeTab === 'insights'
                  ? 'bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD]'
                  : 'text-[#60554C] hover:text-[#2C2621] hover:bg-[#FAF6EE]/70 border border-transparent'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Insights</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('settings');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-tight transition cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-[#E5ECE4] text-[#4A6447] border border-[#C1D2BD]'
                  : 'text-[#60554C] hover:text-[#2C2621] hover:bg-[#FAF6EE]/70 border border-transparent'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* Footer info & Logout button */}
        <div className="px-3 space-y-3">
          <div className="p-3 bg-[#FAF6EE]/90 rounded-xl border border-[#E3DAC9] flex items-center gap-2.5 shadow-sm">
            <div className="w-7 h-7 bg-[#E5ECE4] border border-[#C1D2BD] rounded-lg flex items-center justify-center text-[#4A6447] shrink-0">
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="truncate min-w-0">
              <span className="block text-[8px] font-sans font-medium text-[#827468] uppercase tracking-wider">My Account</span>
              <span className="block text-xs font-medium text-[#2C2621] truncate">{email}</span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-[#827468] hover:text-[#AF5D45] hover:bg-[#AF5D45]/5 border border-transparent transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main workspace frame */}
      <main className="grow overflow-y-auto relative z-10">
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

        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto py-8 px-4 font-sans text-[#2C2621] space-y-6">
            <div className="border-b border-[#E3DAC9] pb-4 mb-6">
              <h2 className="text-2xl font-serif font-bold text-[#2C2621] flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#AF5D45]" />
                Settings
              </h2>
              <p className="text-xs text-[#60554C]">Configure your API key and custom reflection prompts</p>
            </div>

            <div className="bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl p-6 shadow-sm space-y-6">
              {/* Custom Prompt Section */}
              <div className="space-y-4 border-b border-[#E3DAC9]/60 pb-6">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#60554C] uppercase tracking-wider">
                    Custom AI System Prompt
                  </label>
                  <p className="text-[11px] text-[#827468]">
                    Personalize how the reflection guide writes, analyzes, and responds to your memories.
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
                  className="w-full bg-[#FAF6EE] border border-[#DFD5C4] focus:border-[#4A6447] focus:ring-1 focus:ring-[#4A6447] rounded-xl py-3 px-4 text-xs text-[#2C2621] placeholder-[#A09384] outline-none transition min-h-[100px] leading-relaxed resize-y"
                />

                {/* 10 click presets grid */}
                <div className="space-y-2">
                  <span className="block text-[10px] font-sans font-bold text-[#827468] uppercase tracking-wider">
                    Quick Persona Presets
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => {
                          setCustomPrompt(p.prompt);
                          localStorage.setItem('journal_custom_prompt', p.prompt);
                        }}
                        className="text-left bg-[#FAF6EE] hover:bg-[#EBE5D8] border border-[#DFD5C4] hover:border-[#C1D2BD] p-2.5 rounded-xl cursor-pointer transition text-xs space-y-1"
                      >
                        <span className="font-bold text-[#2C2621] block text-[11px]">{p.name}</span>
                        <span className="text-[10px] text-[#827468] block leading-tight">{p.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {customPrompt && (
                  <button
                    onClick={() => {
                      setCustomPrompt(null);
                      localStorage.removeItem('journal_custom_prompt');
                    }}
                    className="text-[11px] font-semibold text-[#AF5D45] hover:underline transition"
                  >
                    Reset System Prompt to Default (Satori Wisdom)
                  </button>
                )}
              </div>

              {/* Gemini API Key Section */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[#60554C] uppercase tracking-wider">
                    Gemini API Key
                  </label>
                  <input
                    type="password"
                    placeholder="Paste your API key here..."
                    value={userApiKey || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUserApiKey(val || null);
                      if (val.trim()) {
                        localStorage.setItem('journal_gemini_api_key', val.trim());
                      } else {
                        localStorage.removeItem('journal_gemini_api_key');
                      }
                    }}
                    className="w-full bg-[#FAF6EE] border border-[#DFD5C4] focus:border-[#4A6447] focus:ring-1 focus:ring-[#4A6447] rounded-xl py-3 px-4 text-sm text-[#2C2621] placeholder-[#A09384] outline-none transition"
                  />
                </div>

                <p className="text-xs text-[#60554C] leading-relaxed">
                  By setting your own API key, all mood analysis, search, chat, and weekly insights will run using your personal key.
                </p>

                {/* How to get an API key tutorial */}
                <div className="p-5 bg-[#FAF6EE] border border-[#E3DAC9] rounded-xl space-y-4">
                  <span className="block text-[10px] font-sans font-bold text-[#827468] uppercase tracking-wider">How to get your API key</span>
                  <ol className="text-xs text-[#60554C] leading-relaxed space-y-3 list-none">
                    <li className="flex gap-3 items-start">
                      <span className="shrink-0 w-5 h-5 bg-[#E5ECE4] border border-[#C1D2BD] rounded-md flex items-center justify-center text-[10px] font-bold text-[#4A6447]">1</span>
                      <span>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[#4A6447] font-semibold underline underline-offset-2 hover:text-[#2C2621] transition">Google AI Studio</a> and sign in with your Google account.</span>
                    </li>
                    <li className="flex gap-3 items-start">
                      <span className="shrink-0 w-5 h-5 bg-[#E5ECE4] border border-[#C1D2BD] rounded-md flex items-center justify-center text-[10px] font-bold text-[#4A6447]">2</span>
                      <span>Click <strong>"Create API Key"</strong> and select a Google Cloud project (or create a new one).</span>
                    </li>
                    <li className="flex gap-3 items-start">
                      <span className="shrink-0 w-5 h-5 bg-[#E5ECE4] border border-[#C1D2BD] rounded-md flex items-center justify-center text-[10px] font-bold text-[#4A6447]">3</span>
                      <span>Copy the generated key (starts with <code className="bg-[#E5ECE4] text-[#4A6447] px-1.5 py-0.5 rounded text-[10px] font-mono">AIza...</code>) and paste it in the field above.</span>
                    </li>
                  </ol>
                  <p className="text-[10px] text-[#827468] leading-relaxed">
                    Your key is stored only in your browser and is never sent to our servers. The free tier includes generous usage limits for personal journaling.
                  </p>
                </div>

                <div className="p-4 bg-[#E5ECE4]/50 border border-[#C1D2BD]/60 rounded-xl text-[#4A6447] text-xs space-y-2 leading-relaxed">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className={`w-2 h-2 rounded-full ${userApiKey ? 'bg-[#4A6447]' : 'bg-[#827468]'}`} />
                    <span>Status: {userApiKey ? 'Custom API Key Active' : 'Using Default Key'}</span>
                  </div>
                  <p>
                    {userApiKey
                      ? "Your custom API key is active. It is stored securely in your browser's local storage and never exposed to third parties."
                      : "No custom API key set. The app is using the default server key."
                    }
                  </p>
                </div>

                {userApiKey && (
                  <button
                    onClick={() => {
                      setUserApiKey(null);
                      localStorage.removeItem('journal_gemini_api_key');
                    }}
                    className="text-xs font-semibold text-[#AF5D45] hover:text-white hover:bg-[#AF5D45] border border-[#AF5D45] px-4 py-2 rounded-xl transition cursor-pointer block text-center w-full"
                  >
                    Clear Custom API Key
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Floating Profile & Sign Out (Bottom Left) */}
      <div className="md:hidden fixed bottom-4 left-4 z-40 font-sans">
        {mobileProfileOpen && (
          <div className="mb-2 p-3 bg-[#FFFDF9]/95 backdrop-blur-md border border-[#DFD5C4] rounded-xl shadow-lg space-y-2.5 min-w-[200px] animate-fade-in">
            <div className="truncate min-w-0">
              <span className="block text-[8px] font-sans font-semibold text-[#827468] uppercase tracking-wider">My Account</span>
              <span className="block text-xs font-semibold text-[#2C2621] truncate">{email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#827468] hover:text-[#AF5D45] transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
        <button
          onClick={() => setMobileProfileOpen(!mobileProfileOpen)}
          className="w-10 h-10 bg-[#E5ECE4] border border-[#C1D2BD] hover:border-[#4A6447] rounded-full flex items-center justify-center text-[#4A6447] shadow-md transition cursor-pointer active:scale-95"
        >
          <User className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
