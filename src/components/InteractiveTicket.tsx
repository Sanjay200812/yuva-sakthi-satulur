import React, { useState } from 'react';
import { Sparkles, ShieldCheck, QrCode, Award, IndianRupee, Flame, Tag } from 'lucide-react';

interface InteractiveTicketProps {
  customNumber?: string;
  customName?: string;
  onSelect?: () => void;
  interactive?: boolean;
}

export const InteractiveTicket: React.FC<InteractiveTicketProps> = ({
  customNumber = '1501',
  customName = 'LUCKY PARTICIPANT',
  onSelect,
  interactive = true,
}) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 16;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -16;
    setMousePos({ x, y });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 });
  };

  return (
    <div
      className="relative w-full max-w-md mx-auto perspective-1000 select-none py-2"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Outer ambient glow */}
      <div className="absolute -inset-2 bg-gradient-to-r from-purple-600/30 via-amber-500/25 to-indigo-600/30 rounded-3xl blur-xl transition-all duration-500 group-hover:blur-2xl opacity-75" />

      {/* Main Ticket Card Wrapper */}
      <div
        style={{
          transform: interactive
            ? `rotateX(${mousePos.y}deg) rotateY(${mousePos.x}deg) translateZ(0)`
            : 'none',
          transition: 'transform 0.15s ease-out, box-shadow 0.3s ease',
        }}
        onClick={() => {
          if (onSelect) onSelect();
        }}
        className="relative bg-gradient-to-br from-[#121A3B] via-[#0E1530] to-[#0A0E24] rounded-2xl border border-purple-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.7)] p-5 sm:p-6 overflow-hidden cursor-pointer group"
      >
        {/* Background decorative watermark pattern */}
        <div className="absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(#F59E0B_1px,transparent_1px)] [background-size:16px_16px]" />
        
        {/* Holographic foil sweep line */}
        <div className="absolute -inset-full bg-gradient-to-r from-transparent via-white/10 to-transparent rotate-45 pointer-events-none group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

        {/* Top Header Row of Ticket */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-3.5 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-400 to-yellow-600 p-[1px] shadow-sm">
              <div className="w-full h-full bg-[#070B19] rounded-[7px] overflow-hidden flex items-center justify-center">
                <img
                  src="/logo.jpeg"
                  alt="Yuva Shakti Satulur"
                  className="w-full h-full object-cover rounded-[7px]"
                />
              </div>
            </div>
            <div>
              <p className="text-[10px] text-purple-300 font-semibold tracking-wider uppercase">
                COMMUNITY EVENT
              </p>
              <h4 className="text-xs sm:text-sm font-extrabold tracking-tight text-white font-display">
                YUVA SHAKTI YOUTH SATULUR
              </h4>
            </div>
          </div>

          <div className="text-right flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-[10px] font-bold tracking-wider uppercase shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              <Sparkles className="w-3 h-3 text-amber-400" />
              OFFICIAL PASS
            </span>
            <span className="text-[9px] text-amber-300/80 font-mono font-bold">
              SERIES: 1501 – 2250
            </span>
          </div>
        </div>

        {/* Middle Content - Big Visuals */}
        <div className="grid grid-cols-12 gap-3 items-center my-3">
          {/* Left Column: Event & Prize */}
          <div className="col-span-8 space-y-1.5">
            <span className="text-[11px] font-semibold text-purple-300 uppercase tracking-widest flex items-center gap-1">
              <span>LUCKY DRAW COUPON</span>
            </span>

            <div className="flex items-baseline gap-1">
              <h2 className="text-3xl sm:text-4xl font-black font-display text-white tracking-tight">
                ₹50
              </h2>
              <span className="text-xs text-slate-400 uppercase font-medium">/ ONLY</span>
            </div>

            <div className="flex items-center gap-1.5 pt-1">
              <div className="px-2 py-0.5 rounded bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>1ST PRIZE: 20 KG LADDU</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-300 line-clamp-1 pt-0.5">
              Holder: <span className="font-semibold text-white">{customName}</span>
            </p>
          </div>

          {/* Right Column: QR Mock & Perforation Stub */}
          <div className="col-span-4 flex flex-col items-center justify-center p-2 rounded-xl bg-slate-900/80 border border-purple-500/20 text-center">
            <div className="relative p-1.5 bg-white rounded-lg shadow-inner mb-1">
              <QrCode className="w-10 h-10 text-slate-950" />
              <div className="absolute inset-0 bg-amber-400/10 pointer-events-none rounded-lg" />
            </div>
            <span className="text-[9px] text-purple-300 font-mono tracking-tight font-medium">
              VERIFIED TICKET
            </span>
          </div>
        </div>

        {/* Perforated Divider Line with Left & Right Cutout Notches */}
        <div className="relative my-4">
          <div className="ticket-notch-left -left-7" />
          <div className="ticket-notch-right -right-7" />
          <div className="border-b-2 border-dashed border-purple-500/30 w-full" />
        </div>

        {/* Bottom Bar: Unique Serial Number & Barcode */}
        <div className="flex items-center justify-between pt-1">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest font-medium">
                COUPON SERIAL NO.
              </span>
              <span className="text-[8px] bg-purple-950 border border-purple-500/30 text-amber-300 px-1.5 py-0.2 rounded font-mono">
                1501-2250
              </span>
            </div>
            <div className="font-mono font-bold text-xs sm:text-sm text-amber-400 tracking-wider">
              {customNumber}
            </div>
          </div>

          {/* Barcode Graphic */}
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-[2px] h-6 px-1 py-0.5 bg-slate-900/60 rounded">
              {[3, 1, 2, 4, 1, 3, 2, 1, 3, 4, 2, 1, 2, 3, 1, 4, 2].map((w, idx) => (
                <div
                  key={idx}
                  className="h-full bg-slate-300"
                  style={{ width: `${w}px` }}
                />
              ))}
            </div>
            <span className="text-[8px] text-slate-400 font-mono">SATULUR-DRAW-2025</span>
          </div>
        </div>

        {/* Bottom subtle tag */}
        <div className="mt-3 pt-2 border-t border-purple-900/30 flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3 h-3" />
            100% Genuine Committee Pass
          </span>
          <span className="text-purple-300/80 font-medium">Tap to Book</span>
        </div>
      </div>
    </div>
  );
};
