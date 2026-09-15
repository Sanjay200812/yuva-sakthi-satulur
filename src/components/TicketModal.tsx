import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Download, Share2, CheckCircle2, Ticket, QrCode, Award, ShieldCheck, Flame, Phone, MessageSquare, Calendar, CreditCard, Tag, Loader2 } from 'lucide-react';
import { CouponBooking } from '../types.ts';
import { downloadAuthorizedFile } from '../utils/download.ts';
import confetti from 'canvas-confetti';

interface TicketModalProps {
  booking: CouponBooking | null;
  onClose: () => void;
}

export const TicketModal: React.FC<TicketModalProps> = ({ booking, onClose }) => {
  const ticketRef = useRef<HTMLDivElement>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (!booking) return null;

  // Trigger celebration confetti
  React.useEffect(() => {
    try {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.5 },
        colors: ['#F59E0B', '#8B5CF6', '#FBBF24', '#10B981', '#FFFFFF'],
      });
    } catch {
      // ignore
    }
  }, [booking]);

  const handleWhatsAppShare = () => {
    if (!booking) return;
    const numbersList = booking.ticketNumbers.join(', ');
    const message = encodeURIComponent(
      `🎉 *YUVA SHAKTI YOUTH SATULUR - LUCKY DRAW COUPON CONFIRMATION*\n\n` +
      `👤 *Participant:* ${booking.name}\n` +
      `📞 *Mobile:* ${booking.phone}\n` +
      `📍 *Location:* ${booking.village}\n` +
      `🎟️ *Coupon Numbers:* ${numbersList}\n` +
      `🔢 *Series Range:* 1501 to 2250\n` +
      `💰 *Total Paid:* ₹${booking.totalAmount} (${booking.quantity} Coupon${booking.quantity > 1 ? 's' : ''})\n` +
      `📅 *Lucky Draw Date:* 19th (Sunday Evening 6:30 PM)\n` +
      `🏆 *1st Prize:* 20 KG MAHA LADDU\n` +
      `💳 *Payment Ref:* ${booking.transactionRef || 'Verified'}\n\n` +
      `Keep this digital receipt safe for the official public lucky draw in Satulur! 🌟`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const getDownloadToken = (): string | undefined => {
    if (!booking) return undefined;
    if (booking.downloadToken) return booking.downloadToken;
    try {
      const stored = sessionStorage.getItem('confirmed_booking_download');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.publicId === booking.id) {
          return parsed.downloadToken;
        }
      }
    } catch {}
    return undefined;
  };

  const handleDownloadSingle = async (couponNum: string, format: 'pdf' | 'png' | 'jpeg') => {
    const key = `${couponNum}-${format}`;
    setDownloadingKey(key);
    setDownloadError(null);
    try {
      const token = getDownloadToken();
      const ext = format === 'jpeg' ? 'jpg' : format;
      const res = await downloadAuthorizedFile(
        `/api/coupons/${couponNum}/download?format=${format}`,
        token,
        `${couponNum}.${ext}`
      );
      if (!res.success && res.error) {
        setDownloadError(res.error);
      }
    } finally {
      setDownloadingKey(null);
    }
  };

  const handleDownloadAll = async () => {
    if (!booking) return;
    setDownloadingKey('all');
    setDownloadError(null);
    try {
      const token = getDownloadToken();
      const isMulti = booking.ticketNumbers.length > 1;
      const filename = isMulti ? `YuvaShakti-${booking.id}-Coupons.zip` : `YuvaShakti-${booking.id}-Tickets.pdf`;
      const url = isMulti
        ? `/api/bookings/${booking.id}/download-all`
        : `/api/coupons/${booking.ticketNumbers[0]}/download?format=pdf`;
      const res = await downloadAuthorizedFile(url, token, filename);
      if (!res.success && res.error) {
        setDownloadError(res.error);
      }
    } finally {
      setDownloadingKey(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-lg my-auto bg-[#0A0E24] border border-amber-400/40 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] p-5 sm:p-7 overflow-hidden text-left">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-700 cursor-pointer z-20"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Success Header */}
        <div className="text-center space-y-1.5 mb-5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>PAYMENT & COUPON CONFIRMED!</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black font-display text-white">
            Official <span className="gold-gradient-text">Event Ticket Pass</span>
          </h3>
          <p className="text-xs text-slate-400">
            Save or screenshot this official ticket pass from series <strong className="text-amber-300 font-mono">1501-2250</strong>.
          </p>
        </div>

        {/* The Digital Ticket Card */}
        <div
          ref={ticketRef}
          className="relative bg-gradient-to-br from-[#121A3E] via-[#0E1530] to-[#0A0E24] rounded-2xl border-2 border-amber-400/40 p-5 sm:p-6 shadow-2xl overflow-hidden print:bg-white print:text-black"
        >
          {/* Subtle watermark */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl font-black font-display text-white/[0.03] select-none pointer-events-none">
            SATULUR
          </div>

          {/* Ticket Top Header */}
          <div className="flex items-center justify-between pb-3 border-b border-purple-500/30">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 p-[1px] shadow-sm">
                <div className="w-full h-full bg-[#070B19] rounded-[10px] overflow-hidden flex items-center justify-center">
                  <img
                    src="/logo.jpeg"
                    alt="Yuva Shakti Satulur"
                    className="w-full h-full object-cover rounded-[10px]"
                  />
                </div>
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-extrabold text-white font-display tracking-tight">
                  YUVA SHAKTI YOUTH SATULUR
                </h4>
                <p className="text-[10px] text-amber-300 font-semibold tracking-wider uppercase">
                  LUCKY DRAW 2025 • ₹50
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-400/30 block">
                {booking.id}
              </span>
              <span className="text-[9px] text-purple-300 font-mono">SERIES 1501-2250</span>
            </div>
          </div>

          {/* Ticket Body Info */}
          <div className="py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/70 border border-purple-500/20 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Participant</span>
                <span className="font-bold text-white text-sm truncate block">{booking.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-mono">WhatsApp Phone</span>
                <span className="font-mono text-purple-300 font-semibold">{booking.phone}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Draw Date & Time</span>
                <span className="text-amber-300 font-bold flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-amber-400" />
                  19th Sun Evening 6:30 PM
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-mono">Grand 1st Prize</span>
                <span className="text-amber-400 font-black font-display">20 KG LADDU 🏆</span>
              </div>
            </div>

            {/* Payment & Gateway details */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-purple-950/40 border border-purple-500/20 text-[11px]">
              <span className="text-slate-300 flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                Collection: {booking.paymentGateway || 'Direct UPI (Proof Verified)'}
              </span>
              <span className="font-mono text-emerald-400 font-semibold">
                Ref: {booking.transactionRef || 'PROOF_VERIFIED'}
              </span>
            </div>

            {/* Serial Numbers Box */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase">
                <span>Allocated Coupon Number(s):</span>
                <span className="text-amber-300 font-bold">{booking.quantity} Entry (₹{booking.totalAmount})</span>
              </div>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto custom-scrollbar p-2.5 bg-slate-950/90 rounded-xl border border-amber-400/30">
                {booking.ticketNumbers.map((num) => (
                  <div
                    key={num}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/50 shadow-sm w-full"
                  >
                    <span className="text-amber-300 font-mono text-xs font-black tracking-wider">
                      {num}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!!downloadingKey}
                        onClick={() => handleDownloadSingle(num, 'pdf')}
                        className="px-2 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                        title="Download PDF"
                      >
                        {downloadingKey === `${num}-pdf` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        disabled={!!downloadingKey}
                        onClick={() => handleDownloadSingle(num, 'png')}
                        className="px-2 py-1 rounded bg-sky-400 hover:bg-sky-300 text-slate-950 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                        title="Download PNG"
                      >
                        {downloadingKey === `${num}-png` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        <span>PNG</span>
                      </button>
                      <button
                        type="button"
                        disabled={!!downloadingKey}
                        onClick={() => handleDownloadSingle(num, 'jpeg')}
                        className="px-2 py-1 rounded bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                        title="Download JPEG"
                      >
                        {downloadingKey === `${num}-jpeg` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        <span>JPEG</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Perforation Line */}
          <div className="relative my-2">
            <div className="ticket-notch-left -left-8" />
            <div className="ticket-notch-right -right-8" />
            <div className="border-b-2 border-dashed border-purple-500/30 w-full" />
          </div>

          {/* Ticket Stub Footer with QR */}
          <div className="pt-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-white rounded-lg shadow">
                <QrCode className="w-8 h-8 text-slate-950" />
              </div>
              <div className="text-[9px] text-slate-400 leading-tight">
                <span className="block text-white font-bold font-mono">AUTH: {booking.id}</span>
                <span>Verified Public Draw Pass</span>
              </div>
            </div>

            <div className="flex items-center gap-1 text-emerald-400 text-[11px] font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Automated Proof Verified</span>
            </div>
          </div>
        </div>

        {downloadError && (
          <div className="mt-3 p-2.5 rounded-lg bg-red-950/70 border border-red-500/40 text-red-200 text-xs text-center font-medium">
            {downloadError}
          </div>
        )}

        {/* Action Buttons: WhatsApp Share & Download All Official PDFs */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={handleWhatsAppShare}
            className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-emerald-400 to-green-500 hover:scale-[1.02] transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(160,185,129,0.3)]"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Share on WhatsApp</span>
          </button>

          <button
            type="button"
            disabled={!!downloadingKey}
            onClick={handleDownloadAll}
            className="w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-amber-400 to-yellow-500 hover:scale-[1.02] transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg text-center disabled:opacity-50"
          >
            {downloadingKey === 'all' ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
            ) : (
              <Download className="w-4 h-4 text-slate-950" />
            )}
            <span>
              {downloadingKey === 'all'
                ? 'Downloading...'
                : booking.ticketNumbers.length > 1
                ? 'Download All Passes (ZIP)'
                : 'Download Official PDF'}
            </span>
          </button>
        </div>

        <div className="mt-4 text-center">
          <p className="text-[11px] text-slate-400">
            Draw will take place on <strong>19th Sunday Evening (6:30 PM)</strong> at Satulur Center. For any enquiries or help, call or WhatsApp <strong className="text-amber-300 font-bold">+91 95748 76369</strong>. Best of luck!
          </p>
        </div>
      </div>
    </div>
  );
};
