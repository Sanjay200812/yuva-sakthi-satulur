import React, { useMemo } from 'react';

export const AmbientParticles: React.FC = () => {
  const particles = useMemo(() => {
    return Array.from({ length: 24 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 6 + 2,
      duration: Math.random() * 12 + 8,
      delay: Math.random() * 5,
      isGold: i % 2 === 0,
      opacity: Math.random() * 0.5 + 0.2,
    }));
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Deep atmospheric glowing orbs */}
      <div className="absolute -top-40 left-1/4 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl" />
      <div className="absolute top-1/3 -right-20 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -left-20 w-80 h-80 bg-indigo-600/15 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 right-1/4 w-96 h-96 bg-purple-700/15 rounded-full blur-3xl" />

      {/* Floating particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className={`absolute rounded-full transition-transform ${
            p.isGold
              ? 'bg-gradient-to-t from-amber-400 to-yellow-200 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
              : 'bg-gradient-to-t from-purple-400 to-indigo-200 shadow-[0_0_8px_rgba(168,85,247,0.7)]'
          }`}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.opacity,
            animation: `floatSlow ${p.duration}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
};
