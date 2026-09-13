import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Ticket, Sparkles, Plus, Minus, Check, ArrowRight, ShieldCheck, QrCode, Phone, MessageSquare, CreditCard, Lock, Calendar, AlertCircle, Layers, Tag, Loader2 } from 'lucide-react';
import { CouponBooking } from '../types.ts';
import { createBooking, pollPaymentStatus } from '../utils/payment.ts';

interface CouponSectionProps {
  onBookCoupon: (booking: CouponBooking) => void;
  onOpenBookingModal?: (data?: any) => void;
}

export const CouponSection: React.FC<CouponSectionProps> = ({ onBookCoupon, onOpenBookingModal }) => {
  const [quantity, setQuantity] = useState<number>(1);
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [village, setVillage] = useState<string>('Satulur');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'gateway' | 'whatsapp'>('gateway');

  const pricePerCoupon = 50;
  const totalAmount = quantity * pricePerCoupon;

  const presets = [
    { qty: 1, label: '1 Coupon', sub: 'Standard Entry', popular: false },
    { qty: 2, label: '2 Coupons', sub: '2x Lucky Chances', popular: false },
    { qty: 5, label: '5 Coupons', sub: '5x Winning Probability', popular: true },
    { qty: 10, label: '10 Coupons', sub: '10x Mega Probability', popular: false },
  ];

  const handleSelectPreset = (qty: number) => {
    setQuantity(qty);
  };

  const handleQuantityChange = (delta: number) => {
    const next = Math.max(1, Math.min(50, quantity + delta));
    setQuantity(next);
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      alert('Please enter your full name for the coupon ticket.');
      return;
    }
    if (!phone.trim() || phone.length < 10) {
      alert('Please enter a valid 10-digit mobile number for ticket SMS / WhatsApp.');
      return;
    }

    if (paymentMethod === 'whatsapp') {
      handleWhatsAppDirect();
      return;
    }

    if (onOpenBookingModal) {
      onOpenBookingModal({
        name: name.trim(),
        phone: phone.trim(),
        village: village.trim() || 'Satulur',
        quantity,
        autoSubmit: true,
      });
      return;
    }

    setIsProcessing(true);

    try {
      const resp = await createBooking({
        name: name.trim(),
        phone: phone.trim(),
        village: village.trim() || 'Satulur',
        quantity,
      });

      // Poll status until confirmed
      pollPaymentStatus(
        resp.booking.publicId,
        (status, message, confirmedBooking) => {
          if (confirmedBooking) {
            setIsProcessing(false);
            onBookCoupon(confirmedBooking);
          } else if (status === 'verification_failed') {
            setIsProcessing(false);
            setErrorMessage(message || 'Verification failed. Please check your submission.');
          }
        }
      );

      // If mobile, offer intent URL
      const upiUrl = resp.payment.canonicalUri || resp.payment.appIntents?.phonepe;
      if (upiUrl && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        window.location.href = upiUrl;
      }
    } catch (err: any) {
      setIsProcessing(false);
      setErrorMessage(err.message || 'Payment creation failed.');
    }
  };

  const handleWhatsAppDirect = () => {
    const text = encodeURIComponent(
      `🙏 Namaste Yuva Shakti Youth Satulur Committee!\n\nI want to book ${quantity} Lucky Draw Coupon(s) for ₹${totalAmount}.\n\nName: ${name || 'Participant'}\nMobile: ${phone || 'N/A'}\nVillage: ${village || 'Satulur'}\nEvent: Lucky Draw - 1st Prize 20 KG Laddu\nAvailable Coupons: 1501 to 2250\nDraw Date: 19th Sunday Evening\n\nPlease verify payment & confirm my official coupon numbers from the 1501-2250 series.`
    );
    window.open(`https://wa.me/919574876369?text=${text}`, '_blank');
  };

  return (
    <section id="coupon" className="relative py-20 sm:py-28 px-4 sm:px-6 overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-purple-700/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[400px] h-[400px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center space-y-3 mb-10 sm:mb-14">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex flex-wrap items-center justify-center gap-2"
          >
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-purple-500/20 border border-purple-400/40 text-purple-200 text-xs font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              <Ticket className="w-4 h-4 text-amber-400" />
              <span>OFFICIAL COUPON & DIRECT MERCHANT UPI</span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-xs font-bold font-mono shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>SERIES: 1501 TO 2250</span>
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-xs sm:text-sm uppercase tracking-[0.3em] font-extrabold text-amber-400 font-display"
          >
            SINGLE COUPON
          </motion.h2>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-4xl sm:text-6xl md:text-7xl font-black font-display tracking-tight text-white flex items-center justify-center gap-2">
              <span className="gold-gradient-text drop-shadow-[0_0_35px_rgba(245,158,11,0.5)]">
                ₹50
              </span>
            </h3>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap items-center justify-center gap-3 text-sm"
          >
            <span className="px-3.5 py-1 rounded-full bg-slate-900 border border-purple-500/30 text-purple-300 font-semibold">
              One coupon = ₹50
            </span>
            <span className="px-3.5 py-1 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 font-bold flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Draw Opens: 19th Sunday Evening
            </span>
            <span className="px-3.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 font-mono font-bold flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              Available: 1501 to 2250
            </span>
          </motion.div>
        </div>

        {/* Main Coupon Booking Card Container */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Coupon Selection & Interactive Controls */}
          <div className="lg:col-span-7 space-y-6">
            <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-purple-500/30 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
              {/* Step 1: Select Quantity */}
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                    Step 1: Choose Quantity
                  </span>
                  <span className="text-xs text-slate-400">
                    Price: <strong className="text-white">₹50 each</strong> • Pool: <strong className="text-amber-400 font-mono">1501-2250</strong>
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {presets.map((preset) => (
                    <button
                      key={preset.qty}
                      type="button"
                      onClick={() => handleSelectPreset(preset.qty)}
                      className={`relative p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                        quantity === preset.qty
                          ? 'bg-gradient-to-br from-purple-900/80 to-slate-900 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)] ring-1 ring-amber-400'
                          : 'bg-slate-900/60 border-slate-800 hover:border-purple-500/40'
                      }`}
                    >
                      {preset.popular && (
                        <span className="absolute -top-2.5 right-2 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black text-[9px] uppercase tracking-wider shadow">
                          Popular
                        </span>
                      )}
                      <div className="text-base font-extrabold text-white font-display">
                        {preset.label}
                      </div>
                      <div className="text-xs font-bold text-amber-400 mt-0.5">
                        ₹{preset.qty * 50}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                        {preset.sub}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Custom Stepper */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/70 border border-purple-500/20 mt-4">
                  <span className="text-xs sm:text-sm text-slate-300 font-medium">
                    Adjust Number of Coupons:
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(-1)}
                      disabled={quantity <= 1}
                      className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 flex items-center justify-center text-white cursor-pointer transition-colors"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-display font-black text-xl text-amber-300">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(1)}
                      disabled={quantity >= 50}
                      className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 flex items-center justify-center text-white cursor-pointer transition-colors"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 2: Participant Details Form */}
              <form onSubmit={handleSubmitBooking} className="space-y-4 border-t border-slate-800 pt-6">
                <span className="block text-xs font-bold uppercase tracking-wider text-purple-300 mb-1">
                  Step 2: Participant Details
                </span>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Your Full Name <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name (e.g., Ramesh Reddy)"
                    className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none text-white text-sm placeholder:text-slate-500 transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      WhatsApp Mobile Number <span className="text-amber-400">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder="10-digit mobile number"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none text-white text-sm placeholder:text-slate-500 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Village / City
                    </label>
                    <input
                      type="text"
                      value={village}
                      onChange={(e) => setVillage(e.target.value)}
                      placeholder="Satulur / Nearby Village"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none text-white text-sm placeholder:text-slate-500 transition-all"
                    />
                  </div>
                </div>

                {/* Payment Method Selector (Direct UPI vs Direct WhatsApp) */}
                <div className="space-y-2 pt-2">
                  <span className="block text-xs font-bold uppercase tracking-wider text-purple-300">
                    Step 3: Choose Payment Gateway
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('gateway')}
                      className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                        paymentMethod === 'gateway'
                          ? 'bg-purple-950/70 border-amber-400 ring-1 ring-amber-400'
                          : 'bg-slate-950/60 border-slate-800'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shrink-0">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
                          <span>Direct Merchant UPI</span>
                          <span className="text-[9px] px-1.5 py-0.2 bg-amber-400 text-slate-950 font-black rounded uppercase">
                            0% Fee
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          PhonePe, Google Pay, Paytm, FamApp, UPI Apps
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('whatsapp')}
                      className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                        paymentMethod === 'whatsapp'
                          ? 'bg-purple-950/70 border-amber-400 ring-1 ring-amber-400'
                          : 'bg-slate-950/60 border-slate-800'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shrink-0">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-extrabold text-white">
                          WhatsApp Desk
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Helpline: +91 95748 76369 (Instant manual confirmation)
                        </p>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Error Banner if any */}
                {errorMessage && (
                  <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Pricing Summary Box */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/60 to-slate-950 border border-purple-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400">Total Payable:</span>
                    <div className="text-2xl sm:text-3xl font-black font-display text-amber-300">
                      ₹{totalAmount}
                    </div>
                    <span className="text-[11px] text-purple-300">
                      ({quantity} {quantity === 1 ? 'Coupon' : 'Coupons'} × ₹50) • Series #1501-#2250
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-500/30">
                      <Lock className="w-3 h-3" />
                      Direct UPI Automated Verification
                    </span>
                  </div>
                </div>

                {/* Primary Button: GET COUPON */}
                <button
                  id="coupon-purchase-submit-btn"
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-4 rounded-2xl font-display font-extrabold text-base sm:text-lg text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 hover:from-amber-200 hover:to-yellow-400 shadow-[0_0_30px_rgba(245,158,11,0.5)] hover:shadow-[0_0_40px_rgba(245,158,11,0.8)] active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2 group"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                      <span>INITIALIZING SECURE UPI GATEWAY...</span>
                    </div>
                  ) : (
                    <>
                      <Ticket className="w-5 h-5 text-slate-950 group-hover:rotate-12 transition-transform" />
                      <span>
                        {paymentMethod === 'gateway'
                          ? `PAY WITH UPI • ₹${totalAmount}`
                          : `BOOK ON WHATSAPP • ₹${totalAmount}`}
                      </span>
                      <ArrowRight className="w-5 h-5 text-slate-950 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: Live Interactive Digital Pass Preview */}
          <div className="lg:col-span-5 space-y-4">
            <div className="text-center lg:text-left flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider font-mono">
                  LIVE PASS PREVIEW
                </span>
                <p className="text-xs text-slate-400">
                  Allocated from official series: <strong className="text-amber-300 font-mono">1501 to 2250</strong>
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-purple-950 border border-purple-500/30 text-purple-300 text-[10px] font-mono font-bold">
                750 TOTAL
              </span>
            </div>

            {/* Ticket Graphic */}
            <div className="relative bg-gradient-to-br from-[#131B3D] via-[#0E1530] to-[#0A0E24] rounded-3xl border border-purple-500/40 p-6 shadow-2xl overflow-hidden">
              {/* Decorative top pattern */}
              <div className="flex items-center justify-between pb-4 border-b border-purple-500/20">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 font-bold text-xs">
                    YS
                  </div>
                  <div>
                    <span className="text-[10px] text-purple-300 uppercase font-semibold">
                      SATULUR LUCKY DRAW
                    </span>
                    <h5 className="text-xs font-bold text-white">YUVA SHAKTI YOUTH</h5>
                  </div>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-400/30">
                    {quantity} {quantity === 1 ? 'PASS' : 'PASSES'}
                  </span>
                  <div className="text-[9px] text-purple-300 font-mono mt-0.5">
                    SERIES 1501-2250
                  </div>
                </div>
              </div>

              {/* Ticket Body */}
              <div className="py-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      TOTAL AMOUNT
                    </span>
                    <div className="text-3xl font-black font-display text-white">
                      ₹{totalAmount}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      GRAND PRIZE
                    </span>
                    <div className="text-sm font-bold text-amber-300 font-display">
                      20 KG LADDU
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-purple-500/20 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Participant:</span>
                    <span className="font-bold text-white truncate max-w-[160px]">
                      {name || 'YOUR NAME HERE'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Mobile:</span>
                    <span className="font-mono text-purple-300">
                      {phone ? `+91 ${phone}` : '+91 XXXXX XXXXX'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Draw Date:</span>
                    <span className="text-amber-300 font-bold">19th Sunday Evening</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Available Range:</span>
                    <span className="text-amber-300 font-mono font-bold">#1501 to #2250</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Location:</span>
                    <span className="text-slate-300">{village || 'Satulur'}</span>
                  </div>
                </div>

                {/* Coupon Serial Numbers preview */}
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                    Allocated Serial Numbers (1501–2250):
                  </span>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar">
                    {Array.from({ length: quantity }).map((_, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-purple-950/80 border border-purple-500/30 text-amber-300 font-mono text-[11px] font-semibold"
                      >
                        YSYS-2025-{1501 + idx}
                      </span>
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

              {/* QR & Security Footer */}
              <div className="pt-3 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-white rounded-md">
                    <QrCode className="w-7 h-7 text-slate-950" />
                  </div>
                  <div className="text-[10px] leading-tight">
                    <span className="block text-white font-semibold">Automated Proof Verified</span>
                    <span className="text-slate-400">Satulur Series 1501-2250</span>
                  </div>
                </div>

                <span className="text-[10px] text-emerald-400 font-medium">
                  ✓ Instant Receipt
                </span>
              </div>
            </div>

            {/* Trust highlights */}
            <div className="p-4 rounded-2xl bg-purple-950/30 border border-purple-500/20 text-xs text-slate-300 space-y-2">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Draw Opens 19th Sunday Evening</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                The lucky draw will be conducted transparently in front of the public in Satulur on 19th Sunday Evening with coupons strictly numbered between <strong className="text-amber-300 font-mono">1501 and 2250</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
