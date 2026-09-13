import React from 'react';
import { motion } from 'motion/react';
import { Award, Sparkles, Check, Flame, Ticket, Heart, Shield, Star } from 'lucide-react';

interface PrizeSectionProps {
  onOpenBooking: () => void;
}

export const PrizeSection: React.FC<PrizeSectionProps> = ({ onOpenBooking }) => {
  return (
    <section id="prize" className="relative py-20 sm:py-28 px-4 sm:px-6 overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 left-10 w-[350px] h-[350px] bg-purple-600/15 rounded-full blur-[110px] pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center space-y-3 mb-12 sm:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(245,158,11,0.2)]"
          >
            <Award className="w-4 h-4 text-amber-400" />
            <span>GRAND FESTIVAL ATTRACTION</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xs sm:text-sm uppercase tracking-[0.3em] font-extrabold text-purple-300 font-display"
          >
            1ST PRIZE
          </motion.h2>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-4xl sm:text-6xl md:text-7xl font-black font-display tracking-tight text-white">
              <span className="gold-gradient-text drop-shadow-[0_0_40px_rgba(245,158,11,0.5)]">
                20 KG LADDU
              </span>
            </h3>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto font-medium"
          >
            Your chance to win a delicious 20 KG Laddu!
          </motion.p>
        </div>

        {/* Prize Showcase Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left: Interactive Floating Laddu Masterpiece */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="lg:col-span-6 flex flex-col items-center justify-center relative"
          >
            {/* Ambient halo ring around the Laddu */}
            <div className="relative w-72 h-72 sm:w-96 sm:h-96 flex items-center justify-center">
              {/* Spinning decorative ring */}
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/30 animate-spin" style={{ animationDuration: '35s' }} />
              <div className="absolute inset-4 rounded-full border border-purple-500/25 animate-spin" style={{ animationDuration: '25s', animationDirection: 'reverse' }} />
              
              {/* Radial glow background */}
              <div className="absolute inset-8 rounded-full bg-gradient-to-tr from-amber-600/30 via-yellow-500/20 to-purple-600/20 blur-xl animate-pulse-glow" />

              {/* High-Craft Custom Laddu Visual with Floating Animation */}
              <div className="relative z-10 w-56 h-56 sm:w-72 sm:h-72 animate-float-slow flex items-center justify-center">
                <svg viewBox="0 0 300 300" className="w-full h-full drop-shadow-[0_20px_40px_rgba(245,158,11,0.6)]">
                  <defs>
                    <radialGradient id="ladduGradient" cx="38%" cy="32%" r="65%">
                      <stop offset="0%" stopColor="#FEF3C7" />
                      <stop offset="25%" stopColor="#FBBF24" />
                      <stop offset="60%" stopColor="#F59E0B" />
                      <stop offset="85%" stopColor="#D97706" />
                      <stop offset="100%" stopColor="#92400E" />
                    </radialGradient>
                    <radialGradient id="ladduShadow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="rgba(0,0,0,0.6)" />
                      <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                    <linearGradient id="silverFoil" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFFFFF" />
                      <stop offset="40%" stopColor="#E2E8F0" />
                      <stop offset="70%" stopColor="#94A3B8" />
                      <stop offset="100%" stopColor="#FFFFFF" />
                    </linearGradient>
                    <linearGradient id="goldThali" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FDE68A" />
                      <stop offset="50%" stopColor="#F59E0B" />
                      <stop offset="100%" stopColor="#78350F" />
                    </linearGradient>
                  </defs>

                  {/* Golden Base Thali / Plate */}
                  <ellipse cx="150" cy="255" rx="135" ry="32" fill="url(#ladduShadow)" />
                  <ellipse cx="150" cy="245" rx="125" ry="24" fill="url(#goldThali)" stroke="#FDE68A" strokeWidth="2.5" />
                  <ellipse cx="150" cy="243" rx="110" ry="18" fill="#1E1B4B" opacity="0.6" />

                  {/* Main Maha Laddu Body */}
                  <circle cx="150" cy="142" r="102" fill="url(#ladduGradient)" />

                  {/* Texture speckles: Cardamom, Boondi bumps */}
                  {/* Subtle textured dots */}
                  {[
                    [110, 95, 3.5], [130, 80, 4], [165, 75, 4.5], [195, 90, 3],
                    [95, 125, 4.5], [125, 115, 5], [155, 110, 6], [185, 120, 5], [215, 135, 4],
                    [85, 160, 4], [115, 150, 5], [145, 145, 6], [175, 155, 5.5], [205, 165, 4.5],
                    [105, 195, 4], [135, 185, 5], [165, 185, 5], [195, 195, 3.5],
                    [140, 215, 4], [160, 215, 3.5]
                  ].map(([x, y, r], idx) => (
                    <circle key={idx} cx={x} cy={y} r={r} fill="#78350F" opacity="0.4" />
                  ))}

                  {/* Golden Boondi Highlights */}
                  {[
                    [120, 90, 5], [145, 85, 6], [170, 95, 5.5], [105, 115, 6],
                    [135, 125, 7], [160, 120, 8], [190, 110, 6], [120, 155, 7],
                    [150, 155, 7.5], [175, 145, 6], [130, 185, 6], [155, 180, 6.5]
                  ].map(([x, y, r], idx) => (
                    <circle key={`hl-${idx}`} cx={x} cy={y} r={r} fill="#FEF3C7" opacity="0.55" />
                  ))}

                  {/* Roasted Cashew Nuts (Kaju) */}
                  <path d="M 125 105 C 135 95, 155 100, 150 115 C 145 125, 130 120, 125 105 Z" fill="#FFFBEB" stroke="#FBBF24" strokeWidth="1.5" />
                  <path d="M 175 130 C 190 125, 200 140, 190 150 C 180 158, 170 145, 175 130 Z" fill="#FFFBEB" stroke="#FBBF24" strokeWidth="1.5" />
                  <path d="M 115 165 C 128 155, 142 168, 132 178 C 122 185, 110 175, 115 165 Z" fill="#FFFBEB" stroke="#FBBF24" strokeWidth="1.5" />

                  {/* Silver Varak (Edible Silver Foil) patches */}
                  <polygon points="135,70 150,65 158,80 140,82" fill="url(#silverFoil)" opacity="0.9" filter="drop-shadow(0 0 2px white)" />
                  <polygon points="165,100 185,95 190,112 170,118" fill="url(#silverFoil)" opacity="0.85" filter="drop-shadow(0 0 2px white)" />
                  <polygon points="98,135 115,130 118,148 100,150" fill="url(#silverFoil)" opacity="0.85" filter="drop-shadow(0 0 2px white)" />
                  <polygon points="145,135 165,130 168,145 150,150" fill="url(#silverFoil)" opacity="0.95" filter="drop-shadow(0 0 3px white)" />

                  {/* Pistachios (Pista slices) */}
                  <ellipse cx="140" cy="100" rx="4" ry="7" fill="#84CC16" stroke="#4D7C0F" strokeWidth="0.8" transform="rotate(30 140 100)" />
                  <ellipse cx="185" cy="140" rx="3.5" ry="6" fill="#84CC16" stroke="#4D7C0F" strokeWidth="0.8" transform="rotate(-25 185 140)" />
                  <ellipse cx="120" cy="140" rx="3.5" ry="6.5" fill="#84CC16" stroke="#4D7C0F" strokeWidth="0.8" transform="rotate(45 120 140)" />
                  <ellipse cx="160" cy="170" rx="4" ry="7" fill="#84CC16" stroke="#4D7C0F" strokeWidth="0.8" transform="rotate(-40 160 170)" />

                  {/* Top Sparkles */}
                  <circle cx="115" cy="70" r="2.5" fill="#FFFFFF" opacity="0.9" />
                  <circle cx="180" cy="80" r="2" fill="#FFFFFF" opacity="0.9" />
                  <circle cx="148" cy="55" r="3" fill="#FFFFFF" opacity="0.95" />
                </svg>
              </div>

              {/* Floating Badge Tag: 20 KG */}
              <div className="absolute -bottom-2 sm:bottom-2 bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-display font-black text-xs sm:text-sm px-4 py-1.5 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.6)] flex items-center gap-1.5 z-20 border border-white/50">
                <Flame className="w-4 h-4 text-slate-950 fill-slate-950" />
                <span>20 KG GRAND MAHA LADDU</span>
              </div>
            </div>
          </motion.div>

          {/* Right: Prize Details & Features */}
          <div className="lg:col-span-6 space-y-6">
            <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-purple-500/30 backdrop-blur-xl shadow-[0_15px_35px_rgba(0,0,0,0.5)] space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider font-mono">
                    OFFICIAL 1ST PRIZE
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold">
                    Guaranteed Winner
                  </span>
                </div>
                <h4 className="text-2xl sm:text-3xl font-extrabold text-white font-display">
                  Massive 20 Kilogram Laddu
                </h4>
                <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                  Specially crafted for this festive season by skilled traditional sweet masters in Andhra Pradesh. Pure, auspicious, and made to bring prosperity to the lucky winner’s home.
                </p>
              </div>

              {/* Feature Points */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-950/40 border border-purple-500/20">
                  <div className="w-6 h-6 rounded-lg bg-amber-400/20 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs font-bold text-white">Pure Ghee & Dry Fruits</span>
                    <span className="text-[11px] text-slate-400">Rich with cashews, badam & pista</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-950/40 border border-purple-500/20">
                  <div className="w-6 h-6 rounded-lg bg-amber-400/20 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs font-bold text-white">Fresh Live Handover</span>
                    <span className="text-[11px] text-slate-400">Presented on stage in Satulur</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-950/40 border border-purple-500/20">
                  <div className="w-6 h-6 rounded-lg bg-amber-400/20 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs font-bold text-white">Just ₹50 Per Coupon</span>
                    <span className="text-[11px] text-slate-400">Affordable for everyone</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-950/40 border border-purple-500/20">
                  <div className="w-6 h-6 rounded-lg bg-amber-400/20 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs font-bold text-white">Public Fair Draw</span>
                    <span className="text-[11px] text-slate-400">100% transparent in Satulur</span>
                  </div>
                </div>
              </div>

              {/* Action Prompt */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-4 justify-between border-t border-slate-800/80">
                <div>
                  <span className="text-xs text-slate-400">Entry fee:</span>
                  <div className="text-xl font-bold text-amber-300 font-display">₹50 only</div>
                </div>

                <button
                  id="prize-get-coupon-btn"
                  onClick={onOpenBooking}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 hover:scale-105 transition-all shadow-[0_0_20px_rgba(245,158,11,0.4)] cursor-pointer flex items-center justify-center gap-2"
                >
                  <Ticket className="w-4 h-4" />
                  <span>GET COUPON FOR ₹50</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
