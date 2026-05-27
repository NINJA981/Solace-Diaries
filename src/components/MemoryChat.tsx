import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, MessageSquare, Heart, User, Calendar, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from '../types';
import { API_BASE } from '../api';

interface MemoryChatProps {
  token: string;
  userApiKey: string | null;
}

const SUGGESTIONS = [
  "How has my mood been lately?",
  "List any goals or tasks I mentioned.",
  "What were the highlights of my last week?"
];

export default function MemoryChat({ token, userApiKey }: MemoryChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "Hello! Ask me anything about your past entries (e.g., *'What goals did I set?'* or *'When did I feel most productive?'*). I will search your entries and help answer your questions.",
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
    <div className="max-w-4xl mx-auto py-8 px-4 font-sans text-[#2C2621] h-[calc(100vh-4rem)] flex flex-col">
      {/* Title block */}
      <div className="flex items-center justify-between border-b border-[#E3DAC9] pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#E5ECE4] border border-[#C1D2BD] rounded-xl flex items-center justify-center text-[#4A6447] shadow-sm">
            <MessageSquare className="w-5 h-5 text-[#4A6447]" />
          </div>
          <div>
            <h2 className="text-xl font-serif font-bold text-[#2C2621]">Chat</h2>
            <p className="text-xs text-[#60554C]">Chat with your past journal entries.</p>
          </div>
        </div>
      </div>

      {/* Messages Feed Area */}
      <div className="grow overflow-y-auto py-6 space-y-6 pr-2 min-h-0 scrollbar-thin">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
            >
              {/* Left Avatar for Assistant */}
              {!isUser && (
                <div className="w-8 h-8 bg-[#E5ECE4] border border-[#C1D2BD] rounded-lg flex items-center justify-center text-[#4A6447] shrink-0 shadow-sm mt-1">
                  <Sparkles className="w-4 h-4 text-[#4A6447]" />
                </div>
              )}

              {/* Message block */}
              <div className={`space-y-1.5 max-w-[78%] ${isUser ? 'text-right' : ''}`}>
                <div
                  className={`p-4 rounded-2xl text-[13px] leading-relaxed shadow-sm transition-all duration-200 ${
                    isUser
                      ? 'bg-[#597459] text-white rounded-tr-none'
                      : 'bg-[#FFFDF9] border border-[#DFD5C4] text-[#2C2621] rounded-tl-none'
                  }`}
                >
                  <div className="markdown-body text-left">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>

                {/* Date Cited RAG Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="p-3 bg-[#FDFBF7] border border-[#E3DAC9] rounded-xl space-y-1.5 text-left animate-fade-in shadow-inner">
                    <span className="block text-[9px] font-sans font-bold text-[#827468] uppercase tracking-wider">
                      Referenced entries
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.sources.map((src) => (
                        <div
                          key={src.id}
                          className="flex items-center gap-1 bg-[#FFFDF9] border border-[#DFD5C4] px-2 py-0.5 rounded-md text-[9px] text-[#60554C]"
                        >
                          <Calendar className="w-2.5 h-2.5 text-[#4A6447]" />
                          <span className="font-serif font-bold">{src.title}</span>
                          <span className="text-[#827468] font-sans">({src.date})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <span className="block text-[9px] text-[#827468] font-sans tracking-wide px-1">
                  {msg.timestamp}
                </span>
              </div>

              {/* Right Avatar for User */}
              {isUser && (
                <div className="w-8 h-8 bg-[#EBE5D8] border border-[#DFD5C4] rounded-lg flex items-center justify-center text-[#60554C] shrink-0 shadow-sm mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Loading Indicator inside Chat bubble */}
        {loading && (
          <div className="flex gap-3.5 last:animate-pulse">
            <div className="w-8 h-8 bg-[#E5ECE4] border border-[#C1D2BD] rounded-lg flex items-center justify-center text-[#4A6447] shrink-0 shadow-sm mt-1">
              <Sparkles className="w-4 h-4 text-[#4A6447] animate-spin" />
            </div>
            <div className="space-y-1.5 max-w-[70%]">
              <div className="p-4 bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl rounded-tl-none shadow-sm">
                <div className="flex gap-1.5 items-center py-1">
                  <span className="w-2 h-2 bg-[#C1D2BD] rounded-full animate-bounce delay-75" />
                  <span className="w-2 h-2 bg-[#C1D2BD] rounded-full animate-bounce delay-150" />
                  <span className="w-2 h-2 bg-[#C1D2BD] rounded-full animate-bounce delay-300" />
                </div>
              </div>
              <span className="block text-[9px] text-[#827468] px-1 font-medium">Searching entries...</span>
            </div>
          </div>
        )}

        {/* Messaging prompt failures */}
        {error && (
          <div className="p-3 bg-[#FAF0EC] border border-[#ECD5CB] text-[#9B5D47] text-xs rounded-xl flex items-center gap-2 shadow-sm animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#AF5D45]" />
            <span>{error}</span>
          </div>
        )}
        
        <div ref={feedEndRef} />
      </div>

      {/* Suggestion Chips & Form Bar */}
      <div className="pt-4 shrink-0 border-t border-[#E3DAC9] space-y-4">
        {/* Suggestion Chips shown when there's only the welcome message */}
        {messages.length === 1 && !loading && (
          <div className="space-y-2 animate-fade-in">
            <span className="block text-[9px] font-sans font-bold text-[#827468] uppercase tracking-wider">Suggested Questions</span>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  onClick={() => handleSend(sug)}
                  className="bg-[#FFFDF9] hover:bg-[#FAF6EE] text-[#60554C] hover:text-[#2C2621] border border-[#DFD5C4] hover:border-[#C1D2BD] text-xs px-3.5 py-1.5 rounded-xl cursor-pointer transition shadow-sm"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Bar */}
        <form onSubmit={handleSubmitForm}>
          <div className="relative flex items-center bg-[#FFFDF9] border border-[#DFD5C4] focus-within:border-[#4A6447] focus-within:ring-1 focus-within:ring-[#4A6447] rounded-2xl shadow-sm transition p-1 pr-2">
            <input
              type="text"
              required
              disabled={loading}
              placeholder="Ask a question about your entries..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full bg-transparent py-3.5 px-4 text-xs text-[#2C2621] placeholder-[#A09384] outline-none border-none focus:ring-0 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-[#597459] hover:bg-[#4A6447] disabled:bg-[#FAF6EE] text-white disabled:text-[#B5B0A2] font-bold w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition disabled:cursor-not-allowed shrink-0 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
