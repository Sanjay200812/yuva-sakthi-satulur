import React from 'react';
import { Phone, MessageSquare, Headset } from 'lucide-react';

export const FloatingContact: React.FC = () => {
  const officialPhone = '+91 95748 76369';
  const rawPhone = '919574876369';

  return (
    <div className="fixed bottom-5 right-4 sm:right-6 z-40 flex flex-col items-end gap-2.5">
      {/* Quick Enquiries Badge on Desktop */}
      <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0E1530]/95 border-2 border-amber-400/60 shadow-[0_0_20px_rgba(245,158,11,0.3)] backdrop-blur-md">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        <span className="text-[11px] text-slate-300 font-medium">Enquiries & Help:</span>
        <a
          href={`tel:${rawPhone}`}
          className="text-xs font-black font-display text-amber-300 hover:text-white transition-colors"
        >
          {officialPhone}
        </a>
      </div>

      {/* Floating Buttons Group */}
      <div className="flex items-center gap-2">
        {/* WhatsApp Direct */}
        <a
          href={`https://wa.me/${rawPhone}?text=${encodeURIComponent('🙏 Namaste Yuva Shakti Youth Satulur! I need help / have an enquiry regarding the ₹50 Lucky Draw Coupon.')}`}
          target="_blank"
          rel="noreferrer"
          className="w-12 h-12 sm:w-13 sm:h-13 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:scale-110 active:scale-95 transition-all flex items-center justify-center cursor-pointer group"
          aria-label="Chat on WhatsApp"
          title="WhatsApp Help (+91 95748 76369)"
        >
          <MessageSquare className="w-6 h-6 fill-white text-emerald-500 group-hover:rotate-12 transition-transform" />
        </a>

        {/* Call Helpline Direct */}
        <a
          href={`tel:${rawPhone}`}
          className="w-12 h-12 sm:w-13 sm:h-13 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 shadow-[0_0_25px_rgba(245,158,11,0.6)] hover:scale-110 active:scale-95 transition-all flex items-center justify-center cursor-pointer group"
          aria-label="Call Helpline"
          title="Call Helpline (+91 95748 76369)"
        >
          <Phone className="w-6 h-6 text-slate-950 group-hover:scale-110 transition-transform" />
        </a>
      </div>
    </div>
  );
};
