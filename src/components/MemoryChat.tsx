import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, MessageSquare, Heart, User, Calendar, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from '../types';
import { API_BASE } from '../api';

interface MemoryChatProps {
  token: string;
  userApiKey: string | null;
  customPrompt: string | null;
}

const SUGGESTIONS = [
  "How has my mood been lately?",
  "List any goals or tasks I mentioned.",
  "What were the highlights of my last week?"
];

export default function MemoryChat({ token, userApiKey, customPrompt }: MemoryChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hello. Ask me anything about your past entries (e.g., *'What goals did I set?'* or *'When did I feel most productive?'*). I will search your entries and help answer your questions.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const feedEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat when new messages appear
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);

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

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: textToSend })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to assemble thoughts.');
      }

      const assistantMsg: ChatMessage = {
        id: Math.random().toString(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sources: data.sources
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setError(err.message || 'We could not deliver your prompt. Please try again.');
      setInput(textToSend);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      handleSend(input);
      setInput('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#E7E7EC] h-[calc(100vh-4rem)] flex flex-col relative z-10">
      
      {/* Title block */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-xl flex items-center justify-center text-[#8B5CF6] shadow-sm">
            <MessageSquare className="w-5 h-5 text-[#8B5CF6]" />
          </div>
          <div>
            <h2 className="text-xl font-serif font-bold text-[#F3F3F5]">Reflective Dialogue</h2>
            <p className="text-xs text-[#ADA9BA]">Hold conversational reflection loops with your past diaries.</p>
          </div>
        </div>
      </div>

      {/* Messages Feed Area */}
      <div className="grow overflow-y-auto py-6 space-y-6 pr-2 min-h-0 scrollbar-thin">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {/* Left Avatar for Assistant */}
              {!isUser && (
                <div className="w-8 h-8 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-lg flex items-center justify-center text-[#8B5CF6] shrink-0 shadow-sm mt-1">
                  <Sparkles className="w-4 h-4 text-[#8B5CF6] animate-pulse" />
                </div>
              )}

              {/* Message block */}
              <div className={`space-y-2 max-w-[78%] ${isUser ? 'text-right' : ''}`}>
                <div
                  className={`p-4 rounded-2xl text-[13px] leading-relaxed shadow-sm transition-all duration-200 ${
                    isUser
                      ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white rounded-tr-none'
                      : 'glass-card border border-white/5 text-[#E7E7EC] rounded-tl-none'
                  }`}
                >
                  <div className="markdown-body text-left">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>

                {/* Date Cited RAG Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-3 bg-white/[0.01] border border-white/5 rounded-2xl space-y-2 text-left shadow-inner"
                  >
                    <span className="block text-[9px] font-sans font-bold text-[#ADA9BA] uppercase tracking-wider">
                      Archived Evidence Cited
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {msg.sources.map((src) => (
                        <div
                          key={src.id}
                          className="flex items-center gap-1.5 bg-white/[0.03] hover:bg-[#8B5CF6]/10 border border-white/5 hover:border-[#8B5CF6]/30 px-2.5 py-1 rounded-lg text-[9px] text-[#ADA9BA] hover:text-[#F3F3F5] transition duration-200"
                        >
                          <Calendar className="w-3 h-3 text-[#8B5CF6]" />
                          <span className="font-serif font-semibold">{src.title}</span>
                          <span className="opacity-65">({src.date})</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <span className="block text-[9px] text-[#ADA9BA]/50 font-sans tracking-wide px-1">
                  {msg.timestamp}
                </span>
              </div>

              {/* Right Avatar for User */}
              {isUser && (
                <div className="w-8 h-8 bg-white/[0.04] border border-white/10 rounded-lg flex items-center justify-center text-[#ADA9BA] shrink-0 shadow-sm mt-1">
                  <User className="w-4 h-4 text-[#8B5CF6]" />
                </div>
              )}
            </motion.div>
          );
        })}

        {/* Loading Indicator inside Chat bubble */}
        {loading && (
          <div className="flex gap-3.5 last:animate-pulse">
            <div className="w-8 h-8 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-lg flex items-center justify-center text-[#8B5CF6] shrink-0 shadow-sm mt-1">
              <Sparkles className="w-4 h-4 text-[#8B5CF6] animate-spin" />
            </div>
            <div className="space-y-1.5 max-w-[70%]">
              <div className="p-4 glass-card border border-white/5 rounded-2xl rounded-tl-none shadow-sm">
                <div className="flex gap-1.5 items-center py-1">
                  <span className="w-1.5 h-1.5 bg-[#8B5CF6] rounded-full animate-bounce delay-75" />
                  <span className="w-1.5 h-1.5 bg-[#EC4899] rounded-full animate-bounce delay-150" />
                  <span className="w-1.5 h-1.5 bg-[#6366F1] rounded-full animate-bounce delay-300" />
                </div>
              </div>
              <span className="block text-[9px] text-[#ADA9BA] px-1">Retrieving memory indices...</span>
            </div>
          </div>
        )}

        {/* Messaging prompt failures */}
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs rounded-xl flex items-center gap-2 shadow-sm animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        
        <div ref={feedEndRef} />
      </div>

      {/* Suggestion Chips & Form Bar */}
      <div className="pt-4 shrink-0 border-t border-white/5 space-y-4">
        {/* Suggestion Chips shown when there's only the welcome message */}
        {messages.length === 1 && !loading && (
          <div className="space-y-2.5 animate-fade-in">
            <span className="block text-[9px] font-sans font-bold text-[#ADA9BA] uppercase tracking-wider">Suggested Reflection Vectors</span>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  onClick={() => handleSend(sug)}
                  className="bg-white/[0.02] hover:bg-white/[0.06] text-[#ADA9BA] hover:text-[#F3F3F5] border border-white/5 hover:border-white/10 text-xs px-3.5 py-1.5 rounded-xl cursor-pointer transition shadow-sm"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Bar */}
        <form onSubmit={handleSubmitForm}>
          <div className="relative flex items-center bg-white/[0.02] border border-white/5 focus-within:border-[#8B5CF6] focus-within:ring-1 focus-within:ring-[#8B5CF6] rounded-2xl shadow-sm transition p-1 pr-2 backdrop-blur-md">
            <input
              type="text"
              required
              disabled={loading}
              placeholder="Ask a question about your entries..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full bg-transparent py-3.5 px-4 text-xs text-[#E7E7EC] placeholder-[#ADA9BA]/20 outline-none border-none focus:ring-0 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] hover:from-[#7C3AED] hover:to-[#4F46E5] disabled:bg-white/[0.04] text-white disabled:text-[#ADA9BA]/30 font-bold w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition disabled:cursor-not-allowed shrink-0 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
