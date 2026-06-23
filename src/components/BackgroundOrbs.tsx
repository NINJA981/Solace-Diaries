import React from 'react';

export default function BackgroundOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* Glow orb 1 - Primary Theme Accent */}
      <div 
        className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] max-w-[600px] max-h-[600px] rounded-full opacity-25 blur-[120px] mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(var(--accent-color-rgb), 0.3) 0%, rgba(var(--accent-color-rgb), 0.05) 50%, transparent 100%)',
          animation: 'pulse-glow 15s ease-in-out infinite alternate'
        }}
      />
      {/* Glow orb 2 - Secondary Theme Accent */}
      <div 
        className="absolute bottom-[-10%] right-[-10%] w-[55vw] h-[55vw] max-w-[550px] max-h-[550px] rounded-full opacity-20 blur-[130px] mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(var(--accent-heart-rgb), 0.25) 0%, rgba(var(--accent-heart-rgb), 0.05) 55%, transparent 100%)',
          animation: 'pulse-glow 18s ease-in-out infinite alternate-reverse'
        }}
      />
      {/* Glow orb 3 - Soft Ambient Blend */}
      <div 
        className="absolute top-[25%] left-[45%] w-[40vw] h-[40vw] max-w-[400px] rounded-full opacity-15 blur-[100px] mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(var(--accent-color-rgb), 0.15) 0%, transparent 70%)',
          animation: 'pulse-glow 22s ease-in-out infinite'
        }}
      />
    </div>
  );
}

