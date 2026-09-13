import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Sparkles, MapPin, Trophy, ShieldCheck, Flame, Tag } from 'lucide-react';

export const EventCountdown: React.FC = () => {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    // Target: 19th Sunday Evening 6:30 PM
    const calculateTime = () => {
      // Find upcoming 19th Sunday or next 19th
      const now = new Date();
      let targetYear = now.getFullYear();
      let targetMonth = now.getMonth();
      
      // Target 19th at 18:30 (6:30 PM evening)
      let targetDate = new Date(targetYear, targetMonth, 19, 18, 30, 0);
      
      if (now.getTime() > targetDate.getTime()) {
        targetDate = new Date(targetYear, targetMonth + 1, 19, 18, 30, 0);
      }

      const diff = targetDate.getTime() - now.getTime();

      if (diff > 0) {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / 1000 / 60) % 60);
        const seconds = Math.floor((diff / 1000) % 60);
        setTimeLeft({ days, hours, minutes, seconds });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative max-w-5xl mx-auto px-4 sm:px-6 my-6 z-20">
      <div className="relative rounded-3xl p-5 sm:p-7 bg-gradient-to-r from-[#141B3F] via-[#101736] to-[#0D132D] border-2 border-amber-400/40 shadow-[0_15px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl overflow-hidden">
        {/* Background ambient lighting */}
        <div className="absolute -top-10 left-1/3 w-60 h-60 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 right-1/4 w-60 h-60 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left Column: Event Date Announcement */}
          <div className="lg:col-span-6 space-y-2 text-center lg:text-left">
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-bold uppercase tracking-wider shadow-sm">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span>OFFICIAL DRAW SCHEDULE</span>
              </span>

              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-950/80 border border-purple-500/40 text-purple-300 text-xs font-mono font-bold">
                <Tag className="w-3 h-3 text-amber-400" />
                Coupons: 1501 to 2250
              </span>
            </div>

            <h3 className="text-2xl sm:text-3xl font-black font-display text-white tracking-tight">
              LUCKY DRAW OPENS:{' '}
              <span className="gold-gradient-text block sm:inline">
                19TH SUNDAY EVENING
              </span>
            </h3>

            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-1 text-xs text-slate-300">
              <span className="flex items-center gap-1 font-semibold text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded-lg border border-purple-500/30">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                6:30 PM Evening Live Draw
              </span>
              <span className="flex items-center gap-1 font-medium text-slate-300 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-700/60">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                Satulur Center Stage
              </span>
            </div>
          </div>

          {/* Right Column: Dynamic Countdown Timer Boxes */}
          <div className="lg:col-span-6 flex flex-col items-center lg:items-end justify-center">
            <div className="grid grid-cols-4 gap-2 sm:gap-3 w-full max-w-sm">
              <div className="p-2.5 sm:p-3 rounded-2xl bg-slate-950/90 border border-purple-500/30 text-center shadow-inner">
                <div className="font-display font-black text-2xl sm:text-3xl text-amber-300">
                  {String(timeLeft.days).padStart(2, '0')}
                </div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">
                  Days
                </div>
              </div>

              <div className="p-2.5 sm:p-3 rounded-2xl bg-slate-950/90 border border-purple-500/30 text-center shadow-inner">
                <div className="font-display font-black text-2xl sm:text-3xl text-white">
                  {String(timeLeft.hours).padStart(2, '0')}
                </div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">
                  Hours
                </div>
              </div>

              <div className="p-2.5 sm:p-3 rounded-2xl bg-slate-950/90 border border-purple-500/30 text-center shadow-inner">
                <div className="font-display font-black text-2xl sm:text-3xl text-white">
                  {String(timeLeft.minutes).padStart(2, '0')}
                </div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">
                  Mins
                </div>
              </div>

              <div className="p-2.5 sm:p-3 rounded-2xl bg-slate-950/90 border border-amber-400/40 text-center shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                <div className="font-display font-black text-2xl sm:text-3xl text-amber-400 animate-pulse">
                  {String(timeLeft.seconds).padStart(2, '0')}
                </div>
                <div className="text-[10px] text-amber-300 font-mono uppercase tracking-wider mt-0.5">
                  Secs
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Available Coupons: 1501 to 2250 (Limited Series)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
