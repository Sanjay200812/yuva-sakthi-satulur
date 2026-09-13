import React from 'react';
import { motion } from 'motion/react';
import { Users, MapPin, Phone, ShieldCheck, Heart, Sparkles, MessageSquare, Headset, CheckCircle2 } from 'lucide-react';

export const AboutSection: React.FC = () => {
  const officialPhone = '+91 95748 76369';
  const rawPhone = '919574876369';

  return (
    <section id="about" className="relative py-20 px-4 sm:px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Organization Story */}
          <div className="lg:col-span-6 space-y-5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-950/80 border border-purple-500/30 text-purple-300 text-xs font-semibold uppercase">
              <Users className="w-4 h-4 text-amber-400" />
              <span>COMMUNITY INITIATIVE</span>
            </div>

            <h3 className="text-3xl sm:text-4xl font-black font-display text-white tracking-tight">
              YUVA SHAKTI <span className="gold-gradient-text">YOUTH SATULUR</span>
            </h3>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              <strong className="text-white">Yuva Shakti Youth Satulur</strong> is an energetic youth welfare and cultural association based in Satulur, Andhra Pradesh. We come together during festive occasions to celebrate community harmony, organize grand events, and spread joy across our village and neighboring regions.
            </p>

            <div className="space-y-3 pt-2">
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/80 border border-purple-500/20">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-xs sm:text-sm font-bold text-white">100% Transparent Public Drawing</h5>
                  <p className="text-xs text-slate-400">
                    The lucky coupon draw is performed publicly in front of all villagers on 19th Sunday Evening (6:30 PM) for total integrity.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-900/80 border border-purple-500/20">
                <Heart className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-xs sm:text-sm font-bold text-white">Community Celebration & Maha Prasadam</h5>
                  <p className="text-xs text-slate-400">
                    The 20 KG Laddu symbolizes divine blessings, prosperity, and festive sweetness for the entire community.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Contact & Official Help Desk */}
          <div className="lg:col-span-6 space-y-4">
            <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-[#141C44] via-[#0E1530] to-[#0A0E24] border-2 border-amber-400/50 shadow-[0_20px_50px_rgba(0,0,0,0.7)] space-y-6 relative overflow-hidden">
              {/* Top ambient glow */}
              <div className="absolute top-0 right-0 w-40 h-40 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-center justify-between border-b border-purple-500/20 pb-4">
                <div>
                  <span className="text-[11px] text-amber-300 font-mono font-bold uppercase tracking-wider bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-400/40">
                    OFFICIAL ENQUIRY & HELP DESK
                  </span>
                  <h4 className="text-xl font-black text-white font-display mt-2">
                    Satulur Coordinator Helpline
                  </h4>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-500 p-[1.5px] shadow-[0_0_20px_rgba(245,158,11,0.5)] shrink-0">
                  <div className="w-full h-full bg-[#070B19] rounded-[14px] flex items-center justify-center">
                    <Headset className="w-6 h-6 text-amber-400 animate-pulse" />
                  </div>
                </div>
              </div>

              {/* Main Highlighted Phone Number Card */}
              <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-slate-950 via-purple-950/70 to-slate-950 border-2 border-amber-400/60 shadow-[0_0_30px_rgba(245,158,11,0.25)] text-center sm:text-left space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs text-slate-400 uppercase font-mono tracking-wider block">
                      For any Enquiries, Bookings & Support:
                    </span>
                    <a
                      href={`tel:${rawPhone}`}
                      className="text-2xl sm:text-3xl font-black font-display text-white hover:text-amber-300 transition-colors block mt-1 tracking-tight"
                    >
                      <span className="gold-gradient-text drop-shadow-[0_0_25px_rgba(245,158,11,0.6)]">
                        {officialPhone}
                      </span>
                    </a>
                  </div>

                  <span className="inline-flex items-center justify-center gap-1 text-xs text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-500/40 font-semibold w-fit mx-auto sm:mx-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    Available 24/7
                  </span>
                </div>

                <div className="text-xs text-slate-300 flex items-center justify-center sm:justify-start gap-1.5 pt-1">
                  <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Yuva Shakti Youth Committee, Satulur Center, Guntur Dist.</span>
                </div>

                {/* Quick Call & WhatsApp Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <a
                    href={`tel:${rawPhone}`}
                    className="py-3 px-4 rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 hover:from-amber-200 hover:to-yellow-300 shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center justify-center gap-2 transition-all cursor-pointer font-display"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Call Helpline Now</span>
                  </a>

                  <a
                    href={`https://wa.me/${rawPhone}?text=${encodeURIComponent('🙏 Namaste Yuva Shakti Youth Satulur! I have an enquiry regarding the ₹50 Lucky Draw Coupon for the 20 KG Laddu.')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="py-3 px-4 rounded-xl font-bold text-xs sm:text-sm text-white bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Chat on WhatsApp</span>
                  </a>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/30 text-xs text-amber-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Call or message <strong className="text-white font-bold">{officialPhone}</strong> for physical coupons, online booking help, or venue guidance.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
