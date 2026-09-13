import React from 'react';
import { motion } from 'motion/react';
import { Ticket, BookmarkCheck, Trophy, Sparkles, ArrowRight, Calendar, CreditCard } from 'lucide-react';

interface HowItWorksProps {
  onOpenBooking: () => void;
}

export const HowItWorks: React.FC<HowItWorksProps> = ({ onOpenBooking }) => {
  const steps = [
    {
      number: '01',
      title: 'GET YOUR COUPON',
      subtitle: 'Instant UPI Payment (₹50)',
      detail: 'Select 1 or more coupons for ₹50 each. Pay directly via UPI (PhonePe/GPay/Paytm/FamApp) and submit proof for instant automated verification.',
      icon: CreditCard,
      accent: 'from-purple-500 to-indigo-500',
      badge: '₹50 UPI Entry',
    },
    {
      number: '02',
      title: 'SAVE YOUR COUPON NUMBER',
      subtitle: 'Keep your coupon details safely.',
      detail: 'Get your instant digital pass with unique serial numbers (e.g., YSYS-2025-XXXX). Take a screenshot or download the ticket.',
      icon: BookmarkCheck,
      accent: 'from-amber-400 to-yellow-500',
      badge: 'Digital Pass Issued',
    },
    {
      number: '03',
      title: 'WAIT FOR THE LUCKY DRAW',
      subtitle: 'Draw opens: 19th Sunday Evening',
      detail: 'Join the grand public draw on 19th Sunday Evening (6:30 PM) at Satulur Center. Winner takes home the Grand 20 KG Laddu!',
      icon: Trophy,
      accent: 'from-yellow-400 to-amber-500',
      badge: '19th Sunday Evening',
    },
  ];

  return (
    <section id="how-it-works" className="relative py-20 sm:py-28 px-4 sm:px-6 overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-purple-600/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center space-y-3 mb-14 sm:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-purple-500/30 text-purple-300 text-xs font-bold tracking-widest uppercase shadow-sm"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>SIMPLE & TRANSPARENT PROCESS</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black font-display tracking-tight text-white"
          >
            HOW IT <span className="gold-gradient-text">WORKS</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-sm sm:text-base text-slate-400 max-w-lg mx-auto"
          >
            Three simple steps to enter the Yuva Shakti Youth Satulur Lucky Draw.
          </motion.p>
        </div>

        {/* 3 Step Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {steps.map((step, idx) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.15, duration: 0.6 }}
              className="relative group p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-slate-900/90 to-slate-950/90 border border-purple-500/20 hover:border-amber-400/50 transition-all duration-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)] flex flex-col justify-between"
            >
              {/* Step number badge & Icon */}
              <div>
                <div className="flex items-center justify-between mb-6">
                  <span className="font-display font-black text-3xl sm:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-amber-400">
                    {step.number}
                  </span>

                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-950 to-slate-900 border border-purple-500/30 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(168,85,247,0.2)] group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all">
                    <step.icon className="w-6 h-6" />
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg sm:text-xl font-black font-display text-white tracking-tight group-hover:text-amber-300 transition-colors">
                    {step.title}
                  </h3>
                  <p className="text-sm font-semibold text-purple-300">
                    {step.subtitle}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-400 pt-1 leading-relaxed">
                    {step.detail}
                  </p>
                </div>
              </div>

              {/* Bottom Tag */}
              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-amber-400 font-mono text-[11px] font-semibold">
                  {step.badge}
                </span>
                <span className="text-slate-500 group-hover:text-purple-300 transition-colors font-medium">
                  Step {step.number}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Action Prompt */}
        <div className="mt-12 text-center">
          <button
            onClick={onOpenBooking}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/40 text-purple-200 text-xs sm:text-sm font-bold tracking-wide transition-all cursor-pointer shadow-[0_0_20px_rgba(168,85,247,0.2)]"
          >
            <Ticket className="w-4 h-4 text-amber-400" />
            <span>Ready? Get Your Coupon for ₹50</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
};
