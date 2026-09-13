import React from 'react';
import { Sparkles, Heart, Award, ShieldCheck, MapPin, Phone, MessageSquare, Headset } from 'lucide-react';

export const Footer: React.FC = () => {
  const officialPhone = '+91 95748 76369';
  const rawPhone = '919574876369';

  return (
    <footer className="relative bg-[#050814] border-t border-purple-900/40 pt-16 pb-12 px-4 sm:px-6 overflow-hidden">
      {/* Background glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-purple-900/15 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10 space-y-10">
        {/* Main Footer Brand & Enquiries Highlight Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-8 border-b border-slate-800/80 items-center">
          {/* Brand Info */}
          <div className="md:col-span-6 space-y-2 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              <h4 className="text-xl font-black font-display text-white tracking-tight">
                YUVA SHAKTI YOUTH SATULUR
              </h4>
            </div>
            <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-amber-400 font-display">
              LUCKY DRAW • 1ST PRIZE 20 KG LADDU • ₹50 COUPON
            </p>
            <p className="text-xs text-slate-400 pt-1">
              Draw opens on <strong>19th Sunday Evening (6:30 PM)</strong> at Satulur Center.
            </p>
          </div>

          {/* Highlighted Official Helpline Box */}
          <div className="md:col-span-6 flex flex-col items-center md:items-end">
            <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/70 to-slate-900 border-2 border-amber-400/50 shadow-[0_0_25px_rgba(245,158,11,0.2)] text-center md:text-right w-full sm:w-auto">
              <span className="text-[10px] text-amber-300 font-mono font-bold uppercase tracking-wider block">
                Official Enquiry & Help Desk:
              </span>
              <a
                href={`tel:${rawPhone}`}
                className="text-2xl font-black font-display text-white hover:text-amber-300 transition-colors block my-0.5"
              >
                <span className="gold-gradient-text">{officialPhone}</span>
              </a>
              <div className="flex items-center justify-center md:justify-end gap-3 pt-1 text-xs">
                <a
                  href={`tel:${rawPhone}`}
                  className="px-3 py-1 rounded-lg bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition-colors flex items-center gap-1 text-[11px]"
                >
                  <Phone className="w-3 h-3" />
                  <span>Call Us</span>
                </a>
                <a
                  href={`https://wa.me/${rawPhone}?text=${encodeURIComponent('🙏 Namaste Yuva Shakti Youth Satulur! I have an enquiry regarding the ₹50 Lucky Draw.')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors flex items-center gap-1 text-[11px]"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>WhatsApp</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Minimal Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <p>© 2026 Yuva Shakti Youth Satulur. All rights reserved.</p>
            <span>•</span>
            <a
              href="/admin"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/admin');
                window.dispatchEvent(new Event('popstate'));
              }}
              className="text-slate-500 hover:text-amber-400 transition cursor-pointer"
            >
              Admin Portal
            </a>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <span>Organized with</span>
            <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
            <span>by Satulur Youth Committee</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
