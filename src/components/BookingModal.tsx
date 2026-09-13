import React, { useState, useEffect } from 'react';
import {
  X,
  Ticket,
  Sparkles,
  Plus,
  Minus,
  ArrowRight,
  ShieldCheck,
  Lock,
  QrCode,
  Calendar,
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import QRCode from 'qrcode';
import { CouponBooking } from '../types.ts';
import { createBooking, pollVyaparPaymentStatus, simulateTestPayment } from '../utils/payment.ts';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookSuccess: (booking: CouponBooking) => void;
  initialData?: {
    name?: string;
    phone?: string;
    village?: string;
    quantity?: number;
    autoSubmit?: boolean;
  } | null;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  onBookSuccess,
  initialData,
}) => {
  const [quantity, setQuantity] = useState<number>(initialData?.quantity || 1);
  const [name, setName] = useState<string>(initialData?.name || '');
  const [phone, setPhone] = useState<string>(initialData?.phone || '');
  const [village, setVillage] = useState<string>(initialData?.village || 'Satulur');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active payment state
  const [paymentSession, setPaymentSession] = useState<{
    publicId: string;
    clientTxnId: string;
    orderId: string;
    totalAmount: number;
    qrData?: string;
    upiIntentUri?: string;
    checkoutUrl?: string;
    statusToken: string;
    isTestMode: boolean;
  } | null>(null);

  const [qrImage, setQrImage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [isSuccessState, setIsSuccessState] = useState<boolean>(false);
  const [isFailedState, setIsFailedState] = useState<boolean>(false);
  const [confirmedBookingData, setConfirmedBookingData] = useState<CouponBooking | null>(null);

  const pricePerCoupon = 50;
  const totalAmount = quantity * pricePerCoupon;
  const presets = [1, 2, 5, 10];

  useEffect(() => {
    if (initialData && isOpen) {
      if (initialData.name) setName(initialData.name);
      if (initialData.phone) setPhone(initialData.phone);
      if (initialData.village) setVillage(initialData.village);
      if (initialData.quantity) setQuantity(initialData.quantity);
    }
  }, [initialData, isOpen]);

  // Generate dynamic QR image when qrData arrives
  useEffect(() => {
    if (paymentSession?.qrData) {
      QRCode.toDataURL(paymentSession.qrData, {
        width: 220,
        margin: 1,
        color: { dark: '#070B19', light: '#FFFFFF' },
      })
        .then((url) => setQrImage(url))
        .catch((err) => console.error('Failed to generate QR data URL', err));
    }
  }, [paymentSession?.qrData]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsFailedState(false);
    setIsSuccessState(false);

    if (!name.trim()) {
      alert('Please enter your full name');
      return;
    }
    if (!phone.trim() || phone.length < 10) {
      alert('Please enter a valid 10-digit mobile number');
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

      const orderId = resp.payment.orderId || resp.payment.clientTxnId || resp.booking.publicId;

      setPaymentSession({
        publicId: resp.booking.publicId,
        clientTxnId: resp.payment.clientTxnId,
        orderId,
        totalAmount: resp.booking.totalAmount,
        qrData: resp.payment.qrData,
        upiIntentUri: resp.payment.upiIntentUri,
        checkoutUrl: resp.payment.checkoutUrl,
        statusToken: resp.payment.statusToken,
        isTestMode: resp.payment.isTestMode,
      });

      setVerifying(true);

      // Instant Real-Time Polling every 2-3 seconds targeting /api/payment/status?order_id=...
      pollVyaparPaymentStatus(
        orderId,
        (confirmedBooking) => {
          setIsProcessing(false);
          setVerifying(false);
          setIsSuccessState(true);
          setConfirmedBookingData(confirmedBooking);

          // Update URL without page refresh as required:
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', `/orders/${confirmedBooking.id}`);
          }

          // Smoothly advance to ticket passes after 1.5 seconds
          setTimeout(() => {
            onBookSuccess(confirmedBooking);
            onClose();
          }, 1500);
        },
        (err) => {
          setIsProcessing(false);
          setVerifying(false);
          setIsFailedState(true);
          setErrorMessage(err);
        },
        2500 // 2.5s polling interval
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initiate booking.');
      setIsProcessing(false);
    }
  };

  const handleSimulatePayment = async () => {
    if (!paymentSession) return;
    setIsProcessing(true);
    const ok = await simulateTestPayment(paymentSession.clientTxnId);
    if (!ok) {
      setErrorMessage('Failed to simulate test payment.');
      setIsProcessing(false);
    }
  };

  const handleRetryPayment = () => {
    setIsFailedState(false);
    setErrorMessage(null);
    setPaymentSession(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-md my-auto bg-[#0C122C] border border-amber-400/40 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] p-6 sm:p-7 overflow-hidden text-left">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/80 hover:bg-slate-700 cursor-pointer z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="text-center space-y-1.5 mb-5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-950 border border-purple-500/30 text-purple-300 text-[11px] font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>YUVA SHAKTI YOUTH SATULUR</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black font-display text-white">
            Get Lucky Draw <span className="gold-gradient-text">Coupon</span>
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-300">
            <span>₹50 / Coupon</span>
            <span>•</span>
            <span className="text-amber-300 font-semibold flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              19th Sun Eve
            </span>
            <span>•</span>
            <span className="text-emerald-300 font-mono font-bold">1st Prize 20 KG Laddu</span>
          </div>
        </div>

        {/* Instant Success State */}
        {isSuccessState && confirmedBookingData ? (
          <div className="space-y-4 text-center py-4 animate-in zoom-in-95 duration-300">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xl font-black text-white font-display">Payment Confirmed!</h4>
              <p className="text-xs text-emerald-300 font-medium">Real-time verification confirmed via VyaparGateway.</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#070B19] border border-emerald-500/30 text-xs text-slate-300 space-y-1.5 font-mono text-left">
              <div className="flex justify-between">
                <span className="text-slate-400">Order Ref:</span>
                <span className="text-white font-bold">{confirmedBookingData.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount Paid:</span>
                <span className="text-amber-300 font-bold">₹{confirmedBookingData.totalAmount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Coupons:</span>
                <span className="text-amber-400 font-bold">{confirmedBookingData.ticketNumbers.join(', ')}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 animate-pulse">
              Redirecting to official verified passes...
            </p>
            <button
              type="button"
              onClick={() => {
                onBookSuccess(confirmedBookingData);
                onClose();
              }}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-400 to-green-500 text-slate-950 font-display font-extrabold text-sm shadow-[0_0_25px_rgba(16,185,129,0.4)] cursor-pointer hover:scale-[1.02] transition-all"
            >
              View Official Passes Now →
            </button>
          </div>
        ) : isFailedState ? (
          /* Payment Failed Alert & Retry View */
          <div className="space-y-4 text-center py-4 animate-in fade-in duration-200">
            <div className="w-14 h-14 mx-auto rounded-full bg-rose-500/20 border-2 border-rose-500 flex items-center justify-center text-rose-400">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="text-lg font-black text-white font-display">Payment Failed or Cancelled</h4>
              <p className="text-xs text-rose-300">{errorMessage || 'Your transaction was not completed. Please try again.'}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
              No money was deducted. You can retry with Google Pay, PhonePe, Paytm, or another UPI app.
            </div>
            <button
              type="button"
              onClick={handleRetryPayment}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-display font-black text-sm cursor-pointer hover:scale-[1.02] transition-all shadow-md flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry Payment</span>
            </button>
          </div>
        ) : paymentSession ? (
          /* Active Payment View with Dynamic QR */
          <div className="space-y-4 text-center">
            {paymentSession.isTestMode && (
              <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-bold uppercase tracking-wider">
                ⚠️ TEST MODE ACTIVE (VyaparGateway Sandbox)
              </div>
            )}

            <div className="p-4 rounded-2xl bg-[#070B19] border border-amber-400/30 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Order ID: <strong className="text-white font-mono">{paymentSession.orderId || paymentSession.publicId}</strong></span>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-bold text-[10px]">DYNAMIC UPI QR</span>
              </div>
              <div className="text-3xl font-black text-amber-400 font-display">
                ₹{paymentSession.totalAmount}
              </div>

              {/* Dynamic QR */}
              {qrImage ? (
                <div className="w-44 h-44 mx-auto p-2 bg-white rounded-2xl shadow-lg relative group">
                  <img src={qrImage} alt="VyaparGateway UPI QR" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-44 h-44 mx-auto bg-slate-900 rounded-2xl flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
                </div>
              )}

              <p className="text-[11px] text-slate-300 font-semibold">
                Scan with any UPI App: PhonePe, Google Pay, Paytm, BHIM
              </p>

              {/* Mobile UPI Intent Link */}
              {paymentSession.upiIntentUri && (
                <a
                  href={paymentSession.upiIntentUri}
                  className="block sm:hidden w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 to-green-500 text-slate-950 font-bold text-xs shadow-md active:scale-95 transition-all"
                >
                  Pay ₹{paymentSession.totalAmount} via UPI App
                </a>
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-purple-300 font-mono">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>Real-time polling active (every 2.5s)...</span>
            </div>

            {/* Test mode button */}
            {paymentSession.isTestMode && (
              <button
                type="button"
                onClick={handleSimulatePayment}
                className="w-full py-2.5 rounded-xl border border-dashed border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-bold text-xs transition cursor-pointer"
              >
                ⚡ [Test Mode: Simulate Instant UPI Confirmation]
              </button>
            )}

            <button
              type="button"
              onClick={handleRetryPayment}
              className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer pt-1"
            >
              Cancel and change details
            </button>
          </div>
        ) : (
          /* Form View */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error display */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}
            {/* Quantity Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Select Number of Coupons:
                </label>
                <span className="text-[10px] text-amber-300 font-mono">₹50 each</span>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setQuantity(preset)}
                    className={`py-2 px-1 rounded-xl text-center border font-bold text-xs transition-all cursor-pointer ${
                      quantity === preset
                        ? 'bg-amber-400 text-slate-950 border-amber-400 shadow-md font-display'
                        : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-purple-500'
                    }`}
                  >
                    {preset} {preset === 1 ? 'Coupon' : 'Coupons'}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-xs text-slate-400">Custom Count:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-8 text-center font-display font-black text-amber-300 text-sm">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.min(20, quantity + 1))}
                    className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-white cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Your Full Name <span className="text-amber-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ramesh Reddy"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-400 outline-none text-white text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  WhatsApp Mobile <span className="text-amber-400">*</span>
                </label>
                <input
                  type="tel"
                  required
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="10-digit number"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-400 outline-none text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Village / Region <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={village}
                  onChange={(e) => setVillage(e.target.value)}
                  placeholder="Satulur"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-amber-400 outline-none text-white text-sm"
                />
              </div>
            </div>

            {/* Total Calculation */}
            <div className="p-3.5 rounded-xl bg-purple-950/50 border border-purple-500/30 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">Total Amount</span>
                <span className="text-2xl font-black font-display text-amber-300">
                  ₹{totalAmount}
                </span>
              </div>
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" />
                VyaparGateway UPI
              </span>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-3.5 rounded-xl font-display font-extrabold text-sm text-slate-950 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 hover:from-amber-200 hover:to-yellow-400 shadow-[0_0_20px_rgba(245,158,11,0.5)] active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>CREATING UPI PAYMENT SESSION...</span>
                </div>
              ) : (
                <>
                  <CreditCard className="w-4 h-4 text-slate-950" />
                  <span>PROCEED TO PAY ₹{totalAmount}</span>
                  <ArrowRight className="w-4 h-4 text-slate-950" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
