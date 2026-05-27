import React, { useState } from 'react';
import { Heart, ArrowRight, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { API_BASE } from '../api';

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
    <div className="min-h-screen bg-[#FAF6EE] flex flex-col items-center justify-center px-4 relative overflow-hidden font-sans text-[#2C2621]">
      {/* Soft warm sunset backdrop colors */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#E3DAC9]/30 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-[#E5ECE4]/40 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-[#FFFDF9] border border-[#DFD5C4] rounded-2xl shadow-xl p-8 md:p-10 relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-14 h-14 bg-[#E5ECE4] border border-[#C1D2BD] rounded-2xl flex items-center justify-center mb-4 text-[#4A6447]">
            <Heart className="w-6 h-6 fill-[#AF5D45] text-[#AF5D45]" />
          </div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-[#2C2621] mb-2">Solace Diaries</h1>
          <p className="text-[#60554C] text-sm leading-relaxed">
            {isSignUp
              ? 'Find quiet peace in your daily diaries'
              : 'Welcome back to your safe, thoughtful space'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3 bg-[#FAF0EC] border border-[#ECD5CB] text-[#9B5D47] text-xs font-medium rounded-xl text-center animate-fade-in shadow-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-sans font-semibold text-[#827468] uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#827468] w-4.5 h-4.5" />
              <input
                type="email"
                required
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#FAF6EE] border border-[#DFD5C4] focus:border-[#4A6447] focus:ring-1 focus:ring-[#4A6447] rounded-xl py-3 pl-11 pr-4 text-sm text-[#2C2621] placeholder-[#A09384] transition outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-sans font-semibold text-[#827468] uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#827468] w-4.5 h-4.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#FAF6EE] border border-[#DFD5C4] focus:border-[#4A6447] focus:ring-1 focus:ring-[#4A6447] rounded-xl py-3 pl-11 pr-11 text-sm text-[#2C2621] placeholder-[#A09384] transition outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#827468] hover:text-[#2C2621] transition"
              >
                {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#597459] hover:bg-[#4A6447] text-white font-semibold rounded-xl py-3.5 text-sm transition flex items-center justify-center gap-2 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-3 shadow-sm hover:shadow-md"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                {isSignUp ? 'Sign Up' : 'Sign In'}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </>
            )}
          </button>
        </form>

        {/* Toggle between states */}
        <div className="mt-6 pt-6 border-t border-[#DFD5C4]/60 text-center">
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
            }}
            className="text-xs text-[#60554C] hover:text-[#4A6447] font-medium transition"
          >
            {isSignUp
              ? 'Already have an account? Sign in here'
              : "New to Solace Diaries? Sign up here"}
          </button>
        </div>
      </div>
    </div>
  );
}
