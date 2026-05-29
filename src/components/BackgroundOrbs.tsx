import React from 'react';

export default function BackgroundOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* Glow orb 1 - Indigo/Violet */}
      <div 
        className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] max-w-[600px] max-h-[600px] rounded-full opacity-25 blur-[120px] mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, rgba(139, 92, 246, 0.1) 50%, transparent 100%)',
          animation: 'pulse-glow 15s ease-in-out infinite alternate'
        }}
      />
      {/* Glow orb 2 - Pink/Rose */}
      <div 
        className="absolute bottom-[-10%] right-[-10%] w-[55vw] h-[55vw] max-w-[550px] max-h-[550px] rounded-full opacity-20 blur-[130px] mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(236, 72, 153, 0.35) 0%, rgba(244, 63, 94, 0.08) 55%, transparent 100%)',
          animation: 'pulse-glow 18s ease-in-out infinite alternate-reverse'
        }}
      />
      {/* Glow orb 3 - Soft Blue (Center Top) */}
      <div 
        className="absolute top-[25%] left-[45%] w-[40vw] h-[40vw] max-w-[400px] rounded-full opacity-15 blur-[100px] mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, transparent 70%)',
          animation: 'pulse-glow 22s ease-in-out infinite'
        }}
      />
    </div>
  );
}
