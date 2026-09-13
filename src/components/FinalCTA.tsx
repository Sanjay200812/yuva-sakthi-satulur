import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, Ticket, ArrowRight, Award, Flame, ShieldCheck, Calendar, CreditCard } from 'lucide-react';

interface FinalCTAProps {
  onOpenBooking: () => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = ({ onOpenBooking }) => {
  return (
    <section className="relative py-20 sm:py-28 px-4 sm:px-6 overflow-hidden">
      {/* Intense background glowing flares */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-r from-purple-600/25 via-amber-500/20 to-purple-600/25 rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10">
        <div className="relative rounded-3xl p-8 sm:p-14 bg-gradient-to-br from-[#12183B] via-[#0E1530] to-[#080B1E] border-2 border-amber-400/40 shadow-[0_20px_60px_rgba(0,0,0,0.8)] text-center space-y-6 overflow-hidden">
          {/* Decorative Corner Accents */}
          <div className="absolute -top-12 -right-12 w-36 h-36 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-purple-500/15 rounded-full blur-2xl pointer-events-none" />

          {/* Top Badge */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex flex-wrap items-center justify-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/90 border border-amber-400/40 text-amber-300 text-xs sm:text-sm font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(245,158,11,0.25)]"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>YUVA SHAKTI YOUTH SATULUR</span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>DRAW OPENS 19TH SUNDAY EVENING</span>
          </motion.div>

          {/* Headings */}
          <div className="space-y-3">
            <h3 className="text-3xl sm:text-5xl md:text-6xl font-black font-display tracking-tight text-white uppercase">
              READY TO TRY <span className="gold-gradient-text">YOUR LUCK?</span>
            </h3>

            <p className="text-base sm:text-xl font-bold text-purple-200">
              Win the Majestic <span className="text-amber-300 font-black">20 KG Laddu</span> for just <span className="text-white bg-purple-950 px-2.5 py-0.5 rounded-lg border border-purple-500/30">₹50</span>!
            </p>
          </div>

          <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto">
            Book your digital lucky draw ticket in seconds via secure <strong>VyaparGateway UPI</strong> (GPay, PhonePe, Paytm). Instant verified pass generated immediately.
          </p>

          {/* Big Glowing CTA Button */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              id="final-cta-get-coupon-btn"
              onClick={onOpenBooking}
              className="w-full sm:w-auto px-10 py-5 rounded-2xl font-display font-black text-lg sm:text-xl text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 hover:from-amber-200 hover:to-yellow-300 shadow-[0_0_40px_rgba(245,158,11,0.6)] hover:shadow-[0_0_55px_rgba(245,158,11,0.9)] hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-3 group"
            >
              <Ticket className="w-6 h-6 text-slate-950 group-hover:rotate-12 transition-transform" />
              <span>GET YOUR ₹50 COUPON</span>
              <ArrowRight className="w-6 h-6 text-slate-950 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {/* Micro trust note */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs text-slate-400 border-t border-slate-800/80">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              100% Guaranteed Public Draw
            </span>
            <span className="flex items-center gap-1.5 text-amber-300 font-medium">
              <Calendar className="w-4 h-4" />
              19th Sunday Evening (6:30 PM)
            </span>
            <span className="flex items-center gap-1.5 text-purple-300 font-medium">
              <CreditCard className="w-4 h-4" />
              VyaparGateway Secured Gateway
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
