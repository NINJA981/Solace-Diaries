import React, { useState } from 'react';
import { Heart, ArrowRight, Lock, Mail, Eye, EyeOff, Sparkles, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE } from '../api';
import MemoryConstellation from './MemoryConstellation';
import BackgroundOrbs from './BackgroundOrbs';

interface LoginScreenProps {
  onLoginSuccess: (token: string, email: string) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/login';

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onLoginSuccess(data.token, data.user.email);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08070C] flex flex-col lg:flex-row relative overflow-hidden font-sans text-[#E7E7EC]">
      {/* Background ambient orbs */}
      <BackgroundOrbs />

      {/* Left side: Immersive visual storytelling */}
      <div className="hidden lg:flex lg:w-7/12 relative flex-col justify-between p-12 overflow-hidden border-r border-white/5 bg-[#09080E]/40 backdrop-blur-3xl">
        {/* Memory constellation backdrop */}
        <MemoryConstellation />

        {/* Top Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 bg-white/[0.03] border border-white/10 rounded-xl flex items-center justify-center text-[#8B5CF6] shadow-inner backdrop-blur-md">
            <Heart className="w-5 h-5 fill-[#EC4899] text-[#EC4899] drop-shadow-[0_0_8px_rgba(236,72,153,0.5)]" />
          </div>
          <span className="font-serif font-bold text-xl tracking-tight text-[#E7E7EC]">Solace Diaries</span>
        </div>

        {/* Center Storytelling */}
        <div className="my-auto max-w-xl space-y-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 text-[#ADA9BA] text-[11px] font-semibold tracking-wide uppercase">
              <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6] animate-pulse" />
              Mindful Memory Sanctuary
            </div>
            <h2 className="text-4xl xl:text-5xl font-serif font-bold leading-tight tracking-tight text-[#F3F3F5]">
              Your thoughts align. <br />
              Your emotions settle. <br />
              <span className="bg-gradient-to-r from-[#8B5CF6] via-[#EC4899] to-[#FDA4AF] bg-clip-text text-transparent">
                Your memories matter.
              </span>
            </h2>
            <p className="text-[#ADA9BA] text-sm leading-relaxed max-w-md">
              A private, offline-first digital sanctuary designed for deep self-reflection, automated mood tracing, and conversational loops with your history.
            </p>
          </motion.div>

          {/* Interactive features display */}
          <div className="grid grid-cols-2 gap-4 pt-6">
            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 backdrop-blur-md hover:bg-white/[0.04] transition duration-300">
              <BookOpen className="w-5 h-5 text-[#8B5CF6] mb-2" />
              <h4 className="text-xs font-bold text-[#F3F3F5] mb-1">Interactive RAG Chat</h4>
              <p className="text-[11px] text-[#ADA9BA] leading-relaxed">Discuss and query emotional loops with your diary history.</p>
            </div>
            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 backdrop-blur-md hover:bg-white/[0.04] transition duration-300">
              <Heart className="w-5 h-5 text-[#EC4899] mb-2" />
              <h4 className="text-xs font-bold text-[#F3F3F5] mb-1">Mood Landscapes</h4>
              <p className="text-[11px] text-[#ADA9BA] leading-relaxed">Map sentiment distribution and tags to track mental growth.</p>
            </div>
          </div>
        </div>

        {/* Bottom footer credit */}
        <div className="text-[11px] text-[#ADA9BA]/50 relative z-10">
          © {new Date().getFullYear()} Solace. Securely sandboxed in your browser storage.
        </div>
      </div>

      {/* Right side: Glassmorphic auth card */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 relative z-10 lg:w-5/12 bg-[#08070C]/60 backdrop-blur-lg">
        {/* Mobile Logo (only shown on smaller viewports) */}
        <div className="lg:hidden flex flex-col items-center mb-8 text-center">
          <div className="w-12 h-12 bg-white/[0.03] border border-white/10 rounded-2xl flex items-center justify-center mb-3 text-[#8B5CF6] shadow-lg backdrop-blur-md">
            <Heart className="w-6 h-6 fill-[#EC4899] text-[#EC4899]" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-[#F3F3F5]">Solace Diaries</h1>
          <p className="text-xs text-[#ADA9BA] mt-1">Simple space for reflection</p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md glass-card rounded-3xl border border-white/5 shadow-2xl p-8 md:p-10 relative"
        >
          {/* Subtle warm accent border top */}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#8B5CF6] via-[#EC4899] to-transparent rounded-t-3xl" />

          {/* Form Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-serif font-bold tracking-tight text-[#F3F3F5]">
              {isSignUp ? 'Begin your story' : 'Return to sanctuary'}
            </h2>
            <p className="text-[#ADA9BA] text-xs mt-1.5 leading-relaxed">
              {isSignUp 
                ? 'Create a secure space to transcribe your daily reflections.'
                : 'Welcome back to your safe, thoughtful reflections.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-[#F43F5E]/10 border border-[#F43F5E]/20 text-[#FDA4AF] text-xs font-semibold rounded-xl text-center"
              >
                {error}
              </motion.div>
            )}

            <div>
              <label className="block text-[10px] font-sans font-bold text-[#ADA9BA] uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ADA9BA]/50 w-4 h-4" />
                <input
                  type="email"
                  required
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full glass-input rounded-xl py-2.5 pl-10 pr-4 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-sans font-bold text-[#ADA9BA] uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ADA9BA]/50 w-4 h-4" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full glass-input rounded-xl py-2.5 pl-10 pr-10 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#ADA9BA]/50 hover:text-[#F3F3F5] transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] hover:from-[#7C3AED] hover:to-[#4F46E5] text-white font-bold rounded-xl py-3 text-xs transition-all duration-300 flex items-center justify-center gap-2 group cursor-pointer disabled:opacity-50 mt-4 shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  {isSignUp ? 'Initialize Space' : 'Enter Sanctuary'}
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                </>
              )}
            </motion.button>
          </form>

          {/* Toggle Links */}
          <div className="mt-6 pt-5 border-t border-white/5 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
              className="text-xs text-[#ADA9BA] hover:text-[#8B5CF6] font-semibold transition"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "New to Solace Diaries? Create your sanctuary"}
            </button>
          </div>
        </motion.div>

        {/* Mobile footer credit */}
        <div className="lg:hidden mt-8 text-[10px] text-[#ADA9BA]/40">
          © {new Date().getFullYear()} Solace. Securely sandboxed.
        </div>
      </div>
    </div>
  );
}
