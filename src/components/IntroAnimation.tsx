import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ArrowRight } from 'lucide-react';

interface IntroAnimationProps {
  onComplete: () => void;
}

export const IntroAnimation: React.FC<IntroAnimationProps> = ({ onComplete }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Automatically finish after 2.1 seconds
    const timer = setTimeout(() => {
      handleSkip();
    }, 2200);

    return () => clearTimeout(timer);
  }, []);

  const handleSkip = () => {
    setIsVisible(false);
    setTimeout(() => {
      onComplete();
    }, 500); // allow fade out
  };

  const line1 = 'YUVA SHAKTI';
  const line2 = 'YOUTH SATULUR';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070B19] text-white px-6 select-none overflow-hidden"
        >
          {/* Subtle ambient lighting */}
          <div className="absolute w-[360px] h-[360px] bg-purple-600/20 rounded-full blur-[100px] animate-pulse-glow" />
          <div className="absolute w-[280px] h-[280px] bg-amber-500/15 rounded-full blur-[90px] animate-pulse-glow" style={{ animationDelay: '1s' }} />

          {/* Small emblem / icon badge */}
          <motion.div
            initial={{ opacity: 0, y: -15, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/80 border border-amber-400/30 text-amber-300 text-xs font-semibold tracking-widest uppercase mb-6 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" style={{ animationDuration: '4s' }} />
            <span>LUCKY DRAW 2025</span>
          </motion.div>

          {/* Main Title Letter by Letter */}
          <div className="text-center">
            <div className="overflow-hidden mb-1">
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
                  },
                }}
                className="flex justify-center items-center flex-wrap gap-x-3 text-3xl sm:text-5xl md:text-6xl font-black tracking-tight font-display"
              >
                {line1.split(' ').map((word, wordIndex) => (
                  <span key={wordIndex} className="inline-flex">
                    {word.split('').map((char, charIndex) => (
                      <motion.span
                        key={charIndex}
                        variants={{
                          hidden: { opacity: 0, y: 30, filter: 'blur(8px)' },
                          visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
                        }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="text-transparent bg-clip-text bg-gradient-to-r from-purple-200 via-white to-purple-300 drop-shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                      >
                        {char}
                      </motion.span>
                    ))}
                  </span>
                ))}
              </motion.div>
            </div>

            <div className="overflow-hidden">
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: { staggerChildren: 0.04, delayChildren: 0.45 },
                  },
                }}
                className="flex justify-center items-center flex-wrap gap-x-3 text-3xl sm:text-5xl md:text-6xl font-black tracking-wider font-display"
              >
                {line2.split(' ').map((word, wordIndex) => (
                  <span key={wordIndex} className="inline-flex">
                    {word.split('').map((char, charIndex) => (
                      <motion.span
                        key={charIndex}
                        variants={{
                          hidden: { opacity: 0, y: 30, filter: 'blur(8px)' },
                          visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
                        }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-500 drop-shadow-[0_0_25px_rgba(245,158,11,0.5)]"
                      >
                        {char}
                      </motion.span>
                    ))}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* Subtitle tag */}
            <motion.p
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.5 }}
              className="mt-4 text-xs sm:text-sm text-slate-400 tracking-widest uppercase font-medium"
            >
              1st Prize: <span className="text-amber-300 font-bold">20 KG Laddu</span> • Coupon: <span className="text-purple-300 font-bold">₹50</span>
            </motion.p>
          </div>

          {/* Progress loader bar */}
          <div className="w-48 h-1 bg-slate-800/80 rounded-full mt-10 overflow-hidden border border-slate-700/50">
            <motion.div
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 1.9, ease: 'easeInOut' }}
              className="h-full bg-gradient-to-r from-purple-500 via-amber-400 to-yellow-300"
            />
          </div>

          {/* Skip button */}
          <motion.button
            id="intro-skip-btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={handleSkip}
            className="absolute bottom-8 right-8 flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors bg-slate-900/60 hover:bg-slate-800/80 border border-slate-700/50 rounded-full cursor-pointer backdrop-blur-sm"
          >
            <span>Skip</span>
            <ArrowRight className="w-3 h-3" />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
