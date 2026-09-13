import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, Ticket, Award, ArrowRight, ShieldCheck, Zap, Users, Gift, Calendar, CreditCard, Tag, Layers } from 'lucide-react';
import { InteractiveTicket } from './InteractiveTicket.tsx';

interface HeroSectionProps {
  onOpenBooking: () => void;
  onExplorePrize: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenBooking, onExplorePrize }) => {
  return (
    <section className="relative min-h-[90vh] pt-28 pb-14 sm:pt-36 sm:pb-20 px-4 sm:px-6 overflow-hidden flex flex-col justify-center">
      {/* Background festive glow flares */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-purple-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-10 w-[380px] h-[380px] bg-amber-500/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
          {/* Left Column: Typography & Action */}
          <div className="lg:col-span-7 text-center lg:text-left space-y-6">
            {/* Top Tag / Pill with Official Logo */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex flex-wrap items-center justify-center lg:justify-start gap-2.5"
            >
              <span className="inline-flex items-center gap-2 pl-1 pr-3.5 py-1 rounded-full bg-purple-950/90 border border-amber-400/40 text-purple-200 text-xs font-bold tracking-wide shadow-[0_0_15px_rgba(245,158,11,0.25)]">
                <span className="w-6 h-6 rounded-full overflow-hidden border border-amber-400/60 shadow-sm shrink-0 flex items-center justify-center bg-[#070B19]">
                  <img src="/logo.jpeg" alt="Emblem" className="w-full h-full object-cover" />
                </span>
                <span className="gold-gradient-text font-display font-extrabold">YUVA SHAKTI YOUTH SATULUR</span>
              </span>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-xs font-bold tracking-wide shadow-sm">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span>DRAW OPENS: 19TH SUNDAY EVENING</span>
              </span>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-xs font-bold tracking-wide shadow-sm">
                <Tag className="w-3.5 h-3.5 text-emerald-400" />
                <span>AVAILABLE: 1501 TO 2250</span>
              </span>
            </motion.div>

            {/* Main Headings */}
            <motion.div
              initial={{ opacity: 0, y: 25 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="space-y-2"
            >
              <h2 className="text-sm sm:text-lg uppercase tracking-[0.25em] font-extrabold text-purple-300 font-display">
                GRAND FESTIVE CELEBRATION
              </h2>

              <h1 className="text-4xl sm:text-6xl md:text-7xl font-black font-display tracking-tight text-white leading-[1.08]">
                LUCKY <span className="gold-gradient-text drop-shadow-[0_0_35px_rgba(245,158,11,0.4)]">DRAW</span>
              </h1>
            </motion.div>

            {/* High-Impact Highlight Row: ₹50 ONLY & 1st Prize 20 KG Laddu & 1501-2250 Range */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-wrap items-center justify-center lg:justify-start gap-3 sm:gap-4 pt-1"
            >
              {/* ₹50 ONLY Badge */}
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500/20 to-yellow-500/10 border border-amber-400/50 shadow-[0_0_25px_rgba(245,158,11,0.25)]">
                <span className="text-xs text-amber-200 uppercase font-semibold">Price:</span>
                <span className="text-2xl sm:text-3xl font-black font-display text-amber-300">
                  ₹50
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-extrabold uppercase">
                  ONLY
                </span>
              </div>

              {/* 1st Prize Highlight */}
              <button
                onClick={onExplorePrize}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-purple-900/40 hover:bg-purple-900/60 border border-purple-500/40 transition-all text-left group cursor-pointer"
              >
                <div className="w-8 h-8 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-[10px] text-purple-300 uppercase font-bold tracking-wider">
                    1ST PRIZE
                  </span>
                  <span className="block text-sm sm:text-base font-extrabold text-white font-display group-hover:text-amber-300 transition-colors">
                    20 KG LADDU 🏆
                  </span>
                </div>
              </button>

              {/* Available Range Chip */}
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-700/80">
                <Layers className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="text-left">
                  <span className="block text-[9px] text-slate-400 uppercase font-mono">Series Range:</span>
                  <span className="block text-xs font-bold text-amber-300 font-mono">#1501 – #2250</span>
                </div>
              </div>
            </motion.div>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-sm sm:text-base text-slate-300 max-w-xl mx-auto lg:mx-0 font-normal leading-relaxed"
            >
              Join the grand festive celebration organized by <strong className="text-white font-semibold">Yuva Shakti Youth Satulur</strong>. For just ₹50, secure your official digital lucky draw ticket (Coupons available from <strong className="text-amber-300 font-bold">1501 to 2250</strong>) and stand a chance to win the majestic <strong className="text-amber-300 font-semibold">20 KG Maha Laddu</strong>! Draw opens on <strong className="text-white font-bold">19th Sunday Evening</strong>.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-3"
            >
              <button
                id="hero-get-coupon-cta"
                onClick={onOpenBooking}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl font-display font-extrabold text-base sm:text-lg text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 hover:from-amber-200 hover:to-yellow-400 shadow-[0_0_35px_rgba(245,158,11,0.5)] hover:shadow-[0_0_45px_rgba(245,158,11,0.8)] hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-3 group"
              >
                <Ticket className="w-5 h-5 text-slate-950 group-hover:rotate-12 transition-transform" />
                <span>GET YOUR COUPON (₹50)</span>
                <ArrowRight className="w-5 h-5 text-slate-950 group-hover:translate-x-1 transition-transform" />
              </button>

              <a
                href="#prize"
                className="w-full sm:w-auto px-6 py-4 rounded-2xl font-semibold text-sm sm:text-base text-slate-200 hover:text-white bg-slate-900/80 hover:bg-slate-800/80 border border-slate-700/80 hover:border-purple-500/50 transition-all text-center flex items-center justify-center gap-2"
              >
                <Gift className="w-4 h-4 text-purple-400" />
                <span>View Prize Details</span>
              </a>
            </motion.div>

            {/* Micro Trust Indicators */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="pt-4 grid grid-cols-3 gap-2 sm:gap-4 max-w-lg mx-auto lg:mx-0 border-t border-slate-800/60"
            >
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-400">
                <CreditCard className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Direct Merchant UPI</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-400">
                <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>19th Sun Evening</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-400">
                <Tag className="w-4 h-4 text-purple-400 shrink-0" />
                <span>#1501 to #2250</span>
              </div>
            </motion.div>
          </div>

          {/* Right Column: Large Interactive Ticket Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="lg:col-span-5 flex flex-col items-center justify-center relative"
          >
            {/* Top badge above ticket */}
            <div className="mb-2 text-center">
              <span className="text-[11px] font-mono font-bold text-amber-300/90 tracking-wider bg-slate-900/90 px-3 py-1 rounded-full border border-amber-400/30">
                ⭐ OFFICIAL EVENT PASS (#1501 - #2250)
              </span>
            </div>

            {/* The Ticket Component */}
            <InteractiveTicket
              onSelect={onOpenBooking}
              customNumber="YSYS-2025-1501"
              customName="YOUR LUCKY TICKET"
            />

            {/* Interactive hint */}
            <div className="mt-3 text-center">
              <p className="text-xs text-slate-400">
                ✨ Coupons allocated directly from available pool: <strong className="text-amber-300">1501 to 2250</strong>
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
