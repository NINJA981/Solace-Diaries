import React, { useState } from 'react';
import { Heart, ArrowRight, Lock, Mail, Eye, EyeOff, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
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
          <div className="w-10 h-10 bg-white/[0.03] border border-white/10 rounded-[2px] flex items-center justify-center text-[var(--accent-color)] shadow-inner backdrop-blur-md">
            <Heart className="w-4 h-4 fill-[var(--accent-heart)] text-[var(--accent-heart)] drop-shadow-[0_0_8px_rgba(var(--accent-heart-rgb),0.3)]" />
          </div>
          <span className="font-serif font-bold text-lg tracking-tight text-[#E7E7EC]">Solace Diaries</span>
        </div>

        {/* Center Storytelling (Editorial layout) */}
        <div className="my-auto max-w-xl space-y-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-white/[0.02] border border-white/5 text-[#ADA9BA] text-[10px] font-mono tracking-widest uppercase">
              <Sparkles className="w-3 h-3 text-[var(--accent-color)] animate-pulse" />
              Private Journal Space
            </div>
            <h1 className="text-4xl xl:text-6xl font-serif font-medium leading-[1.1] tracking-tight text-[#F3F3F5]">
              A quiet place <br />
              for your thoughts.
            </h1>
            <p className="text-[#ADA9BA] text-sm leading-relaxed max-w-md mt-6">
              Capture moments, understand patterns, and revisit memories through thoughtful conversations with your journal.
            </p>
          </motion.div>

          {/* Index-style vertical list of features (Betraying Bento Grid) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4 pt-8 border-t border-white/5"
          >
            <div className="flex items-baseline gap-4 py-2 border-b border-white/5 group hover:border-white/10 transition">
              <span className="font-mono text-[9px] text-[var(--accent-color)] tracking-widest">01 / CRYPTO</span>
              <span className="text-[#F3F3F5] text-xs font-semibold uppercase tracking-wider">Private by Default</span>
              <span className="text-[11px] text-[#ADA9BA] ml-auto">Sandboxed in browser storage</span>
            </div>
            <div className="flex items-baseline gap-4 py-2 border-b border-white/5 group hover:border-white/10 transition">
              <span className="font-mono text-[9px] text-[var(--accent-color)] tracking-widest">02 / INTERACTIVE</span>
              <span className="text-[#F3F3F5] text-xs font-semibold uppercase tracking-wider">AI Memory Search</span>
              <span className="text-[11px] text-[#ADA9BA] ml-auto">Search entries by meaning</span>
            </div>
            <div className="flex items-baseline gap-4 py-2 border-b border-white/5 group hover:border-white/10 transition">
              <span className="font-mono text-[9px] text-[var(--accent-color)] tracking-widest">03 / METRICS</span>
              <span className="text-[#F3F3F5] text-xs font-semibold uppercase tracking-wider">Mood Insights</span>
              <span className="text-[11px] text-[#ADA9BA] ml-auto">Track mood trends</span>
            </div>
          </motion.div>
        </div>

        {/* Bottom footer credit */}
        <div className="text-[10px] font-mono tracking-wider text-[#ADA9BA]/40 relative z-10 uppercase">
          © {new Date().getFullYear()} Solace. Securely sandboxed.
        </div>
      </div>

      {/* Right side: Glassmorphic auth card */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 relative z-10 lg:w-5/12 bg-[#08070C]/60 backdrop-blur-lg">
        {/* Mobile Logo (only shown on smaller viewports) */}
        <div className="lg:hidden flex flex-col items-center mb-8 text-center">
          <div className="w-12 h-12 bg-white/[0.03] border border-white/10 rounded-[2px] flex items-center justify-center mb-3 text-[var(--accent-color)] shadow-lg backdrop-blur-md">
            <Heart className="w-6 h-6 fill-[var(--accent-heart)] text-[var(--accent-heart)]" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-[#F3F3F5]">Solace Diaries</h1>
          <p className="text-xs text-[#ADA9BA] mt-1">Your personal journal</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md bg-[#09080E]/40 backdrop-blur-3xl border border-white/10 rounded-[2px] shadow-[0_30px_60px_rgba(0,0,0,0.3)] p-10 relative"
        >
          {/* Minimal top hairline border */}
          <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-[var(--accent-color)] via-[var(--accent-heart)] to-transparent" />

          {/* Form Header */}
          <div className="mb-8">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent-color)] block mb-1">
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </span>
            <h2 className="text-2xl font-serif font-medium tracking-tight text-[#F3F3F5]">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-[#ADA9BA] text-xs mt-2 leading-relaxed">
              {isSignUp
                ? 'Create a secure, private account for your daily journal.'
                : 'Sign in to access your journal entries.'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-[#F43F5E]/10 border border-[#F43F5E]/20 text-[#FDA4AF] text-xs font-semibold rounded-[2px] text-center"
              >
                {error}
              </motion.div>
            )}

            <div className="space-y-2">
              <label className="block text-[10px] font-mono font-semibold text-[#ADA9BA]/60 uppercase tracking-widest">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[#ADA9BA]/40 w-4 h-4 z-10" />
                <input
                  type="email"
                  required
                  placeholder="name@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full glass-input py-2.5 pl-9 pr-4 text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-mono font-semibold text-[#ADA9BA]/60 uppercase tracking-widest">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[#ADA9BA]/40 w-4 h-4 z-10" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full glass-input py-2.5 pl-9 pr-10 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#ADA9BA]/40 hover:text-[#F3F3F5] transition"
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
              className="w-full bg-gradient-to-r from-[var(--accent-gradient-from)] to-[var(--accent-gradient-to)] text-white hover:opacity-95 font-mono uppercase tracking-widest text-[11px] py-3.5 transition-all duration-300 rounded-[2px] cursor-pointer disabled:opacity-50 mt-4 shadow-lg shadow-black/20"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-[var(--bg-main)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>{isSignUp ? 'Sign Up' : 'Sign In'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              )}
            </motion.button>
          </form>

          {/* Toggle Links */}
          <div className="mt-8 pt-5 border-t border-white/5 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError(null);
              }}
              className="text-[10px] font-mono uppercase tracking-wider text-[#ADA9BA] hover:text-[var(--accent-color)] transition cursor-pointer"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "New to Solace Diaries? Create an account"}
            </button>
          </div>
        </motion.div>

        {/* Mobile footer credit */}
        <div className="lg:hidden mt-8 text-[9px] font-mono tracking-wider text-[#ADA9BA]/40 uppercase">
          © {new Date().getFullYear()} Solace. Securely sandboxed.
        </div>
      </div>
    </div>
  );
}
