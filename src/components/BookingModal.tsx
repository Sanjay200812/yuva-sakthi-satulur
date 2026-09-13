import React, { useState, useEffect, useRef } from 'react';
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
  Copy,
  Check,
  Upload,
  Image as ImageIcon,
  Smartphone,
} from 'lucide-react';
import { CouponBooking } from '../types.ts';
import {
  createBooking,
  submitPaymentProof,
  pollPaymentStatus,
  BookingCreationResponse,
} from '../utils/payment.ts';

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

type ModalStep = 'details' | 'upi_pay' | 'proof' | 'status';
type UpiAppChoice = 'phonepe' | 'google_pay' | 'paytm' | 'fam' | 'standard';

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  onBookSuccess,
  initialData,
}) => {
  const [step, setStep] = useState<ModalStep>('details');
  const [quantity, setQuantity] = useState<number>(initialData?.quantity || 1);
  const [name, setName] = useState<string>(initialData?.name || '');
  const [phone, setPhone] = useState<string>(initialData?.phone || '');
  const [village, setVillage] = useState<string>(initialData?.village || 'Satulur');
  const [selectedApp, setSelectedApp] = useState<UpiAppChoice>('phonepe');

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active payment session state
  const [bookingData, setBookingData] = useState<BookingCreationResponse | null>(null);

  // Proof form state
  const [utr, setUtr] = useState<string>('');
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [consentGiven, setConsentGiven] = useState<boolean>(true);
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);

  // Status & Polling state
  const [liveStatus, setLiveStatus] = useState<string>('payment_initiated');
  const [statusMessage, setStatusMessage] = useState<string>('Payment initiated.');
  const [confirmedBookingData, setConfirmedBookingData] = useState<CouponBooking | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Clean state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('details');
      setErrorMessage(null);
      setBookingData(null);
      setUtr('');
      setScreenshotBase64(null);
      setScreenshotPreview(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 1. Submit Booking Details
  const handleProceedToPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

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
        selectedApp,
      });

      setBookingData(resp);
      setStep('upi_pay');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initiate booking.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Handle File Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/i)) {
      alert('Only PNG, JPEG, or WebP screenshot images are allowed.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Screenshot exceeds 5MB size limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setScreenshotBase64(result);
      setScreenshotPreview(result);
    };
    reader.readAsDataURL(file);
  };

  // 3. Submit Payment Proof (UTR + Screenshot)
  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingData) return;

    if (!consentGiven) {
      alert('Please check the consent box to proceed with verification.');
      return;
    }

    if (!utr.trim() || utr.trim().length < 6) {
      alert('Please enter a valid 12-digit UTR/RRN number from your payment receipt.');
      return;
    }

    if (!screenshotBase64) {
      alert('Please upload your payment screenshot.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await submitPaymentProof({
        publicId: bookingData.booking.publicId,
        utr: utr.trim(),
        screenshotBase64,
        selectedApp,
        consentGiven,
      });

      if (res.status === 'proof_verified' && res.coupons?.length) {
        const confirmedBooking: CouponBooking = {
          id: bookingData.booking.publicId,
          ticketNumbers: res.coupons.map((c: any) => c.coupon_number),
          name: res.coupons[0]?.holder_name || bookingData.booking.name,
          phone: res.coupons[0]?.phone || bookingData.booking.phone,
          village: res.coupons[0]?.village || bookingData.booking.village,
          quantity: bookingData.booking.quantity,
          totalAmount: bookingData.booking.totalAmount,
          bookedAt: new Date().toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }),
          status: 'confirmed',
          transactionRef: 'AUTOMATED_PROOF_VERIFIED',
        };

        setConfirmedBookingData(confirmedBooking);
        setStep('status');
        setLiveStatus('proof_verified');
        setStatusMessage('Payment proof verified! Your lucky coupons are ready.');

        setTimeout(() => {
          onBookSuccess(confirmedBooking);
          onClose();
        }, 1200);
        return;
      }

      setStep('status');
      setLiveStatus(res.status);
      setStatusMessage(res.message);

      // Start polling for automated verification completion
      const stopPolling = pollPaymentStatus(
        bookingData.booking.publicId,
        (status, message, confirmed) => {
          setLiveStatus(status);
          setStatusMessage(message);

          if ((status === 'proof_verified' || status === 'payment_confirmed') && confirmed) {
            setConfirmedBookingData(confirmed);
            stopPolling();

            // Transition to ticket modal after 1.2 seconds
            setTimeout(() => {
              onBookSuccess(confirmed);
              onClose();
            }, 1200);
          }
        },
        2500
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit proof. Please retry.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Copy UPI ID to clipboard
  const handleCopyUpiId = () => {
    if (!bookingData) return;
    navigator.clipboard.writeText(bookingData.payment.rawPayeeUpiId || '9574876369@ybl');
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  // Launch UPI App
  const handleLaunchApp = () => {
    if (!bookingData) return;
    const intents = bookingData.payment.appIntents;
    const url = intents[selectedApp] || intents.standard;
    window.location.href = url;
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

        {/* Header */}
        <div className="text-center space-y-2 mb-5">
          <div className="flex items-center justify-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-400 to-yellow-500 p-[1.5px] shadow-[0_0_12px_rgba(245,158,11,0.4)]">
              <div className="w-full h-full bg-[#070B19] rounded-[9px] overflow-hidden flex items-center justify-center">
                <img src="/logo.jpeg" alt="Yuva Shakti Logo" className="w-full h-full object-cover" />
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-950 border border-purple-500/30 text-purple-300 text-[11px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>YUVA SHAKTI YOUTH SATULUR</span>
            </div>
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

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 mb-4 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: Details Form */}
        {step === 'details' && (
          <form onSubmit={handleProceedToPayment} className="space-y-4">
            {/* Quantity Selector */}
            <div className="p-4 rounded-2xl bg-[#0D132D] border border-purple-500/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Select Coupons:</span>
                <span className="text-xs font-mono text-amber-400 font-bold">₹50 each</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center cursor-pointer transition font-bold"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <span className="text-2xl font-black font-display text-white">{quantity}</span>
                  <span className="text-[10px] text-slate-400 block uppercase">
                    {quantity === 1 ? 'Coupon' : 'Coupons'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(20, quantity + 1))}
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center cursor-pointer transition font-bold"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {/* Presets */}
              <div className="flex items-center justify-center gap-2 pt-1">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setQuantity(p)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition cursor-pointer ${
                      quantity === p
                        ? 'bg-amber-400 text-slate-950 shadow-md'
                        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Inputs */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Participant Full Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Boddukuri Sanjay"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-purple-500/30 focus:border-amber-400 outline-none text-white text-sm placeholder:text-slate-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Mobile Number (WhatsApp preferred) <span className="text-amber-400">*</span>
                </label>
                <input
                  type="tel"
                  required
                  maxLength={10}
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-purple-500/30 focus:border-amber-400 outline-none text-white text-sm placeholder:text-slate-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Village / Town <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Satulur or surrounding village"
                  value={village}
                  onChange={(e) => setVillage(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-purple-500/30 focus:border-amber-400 outline-none text-white text-sm placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Price Summary Bar */}
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 via-purple-900/20 to-slate-900 border border-amber-400/40 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-medium block">Total Payable:</span>
                <span className="text-2xl font-black font-display text-white">₹{totalAmount}</span>
              </div>
              <span className="text-xs font-semibold text-amber-300">₹50 × {quantity}</span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-display font-black text-sm uppercase tracking-wider shadow-lg hover:shadow-amber-500/25 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Preparing UPI Payment...</span>
                </>
              ) : (
                <>
                  <span>Proceed to UPI Payment</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: Direct UPI Payment & QR Screen */}
        {step === 'upi_pay' && bookingData && (
          <div className="space-y-4">
            {/* Amount Banner */}
            <div className="p-3 rounded-2xl bg-[#0D132D] border border-amber-400/40 text-center space-y-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Payable Amount</span>
              <span className="text-3xl font-black font-display text-amber-300">
                ₹{bookingData.payment.amountInr}
              </span>
              <div className="flex items-center justify-center gap-1 text-[11px] text-slate-300">
                <span>Ref:</span>
                <strong className="font-mono text-white">{bookingData.payment.clientTxnId}</strong>
              </div>
            </div>

            {/* UPI App Selection Buttons */}
            <div>
              <span className="text-xs font-semibold text-slate-300 block mb-2">Select Your UPI App:</span>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'phonepe', label: 'PhonePe', color: 'bg-purple-900/60 border-purple-500' },
                  { id: 'google_pay', label: 'GPay', color: 'bg-blue-900/60 border-blue-500' },
                  { id: 'paytm', label: 'Paytm', color: 'bg-cyan-900/60 border-cyan-500' },
                  { id: 'fam', label: 'FamPay', color: 'bg-orange-900/60 border-orange-500' },
                ].map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => setSelectedApp(app.id as UpiAppChoice)}
                    className={`p-2 rounded-xl text-xs font-bold border transition cursor-pointer flex flex-col items-center gap-1 ${
                      selectedApp === app.id
                        ? `${app.color} text-white ring-2 ring-amber-400 shadow-md`
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span className="text-[11px]">{app.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic QR Code */}
            <div className="flex flex-col items-center justify-center p-3.5 bg-white rounded-2xl shadow-inner max-w-[220px] mx-auto border-2 border-amber-400">
              <img
                src={bookingData.payment.qrDataUrl}
                alt="UPI Payment QR"
                className="w-40 h-40 object-contain rounded-lg"
              />
              <span className="text-[10px] text-slate-800 font-bold uppercase tracking-wider mt-1 text-center">
                Scan to pay ₹{bookingData.payment.amountInr}
              </span>
            </div>

            {/* Payee Info & Copy UPI ID */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/20 flex items-center justify-between text-xs">
              <div className="text-left">
                <span className="text-[10px] text-slate-400 uppercase block">Recipient:</span>
                <span className="font-semibold text-white">{bookingData.payment.payeeDisplayName}</span>
                <span className="text-[11px] text-purple-300 font-mono block">
                  {bookingData.payment.payeeUpiId}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyUpiId}
                className="px-3 py-1.5 rounded-lg bg-purple-900/50 hover:bg-purple-800/60 text-purple-200 text-xs font-semibold flex items-center gap-1 cursor-pointer transition"
              >
                {copiedUpi ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUpi ? 'Copied' : 'Copy UPI'}</span>
              </button>
            </div>

            {/* Mobile Pay Now Button */}
            <button
              type="button"
              onClick={handleLaunchApp}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md transition"
            >
              <Smartphone className="w-4 h-4" />
              <span>Pay ₹{bookingData.payment.amountInr} in UPI App</span>
            </button>

            {/* Important Notice */}
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-[11px] space-y-1 text-center">
              <span className="font-bold block">Important Notice:</span>
              <span>
                Returning from your UPI app does not finalize your ticket. After completing payment, tap below to submit your <strong>12-digit UTR</strong> and <strong>screenshot</strong>.
              </span>
            </div>

            {/* Advance to Proof Button */}
            <button
              type="button"
              onClick={() => setStep('proof')}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-display font-black text-sm uppercase tracking-wider shadow-lg transition cursor-pointer flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>I have completed the payment</span>
            </button>
          </div>
        )}

        {/* STEP 3: Mandatory Proof Form (UTR + Screenshot) */}
        {step === 'proof' && bookingData && (
          <form onSubmit={handleSubmitProof} className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/90 border border-purple-500/30 flex items-center justify-between text-xs">
              <span>Order: <strong className="font-mono text-white">{bookingData.booking.publicId}</strong></span>
              <span>Amount: <strong className="text-amber-300 font-mono">₹{bookingData.payment.amountInr}</strong></span>
            </div>

            {/* UTR Input */}
            <div>
              <label className="text-xs font-semibold text-slate-200 block mb-1">
                Enter 12-Digit UTR / RRN / UPI Reference No. <span className="text-amber-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 523489123456"
                value={utr}
                onChange={(e) => setUtr(e.target.value.toUpperCase())}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-purple-500/30 focus:border-amber-400 outline-none text-white text-sm font-mono placeholder:text-slate-500 uppercase"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Found in your payment receipt on PhonePe, GPay, Paytm, or FamPay.
              </span>
            </div>

            {/* Screenshot Upload */}
            <div>
              <label className="text-xs font-semibold text-slate-200 block mb-1">
                Upload Payment Success Screenshot <span className="text-amber-400">*</span>
              </label>

              <input
                type="file"
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />

              {!screenshotPreview ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-purple-500/40 hover:border-amber-400 rounded-2xl p-5 text-center cursor-pointer bg-slate-950/60 transition group"
                >
                  <Upload className="w-8 h-8 text-amber-400 mx-auto mb-2 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-semibold text-white block">Click to upload screenshot</span>
                  <span className="text-[10px] text-slate-400">PNG, JPEG, or WebP up to 5MB</span>
                </div>
              ) : (
                <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500/50 bg-black/50 p-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={screenshotPreview} alt="Receipt preview" className="w-14 h-14 object-cover rounded-lg border" />
                    <div>
                      <span className="text-xs font-bold text-white block">Screenshot Ready</span>
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Valid Raster Image
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setScreenshotBase64(null);
                      setScreenshotPreview(null);
                    }}
                    className="p-2 text-slate-400 hover:text-red-400 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Consent Checkbox */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/20 flex items-start gap-2.5">
              <input
                type="checkbox"
                id="consent"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-purple-500 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="consent" className="text-[11px] text-slate-300 leading-snug cursor-pointer">
                I consent to automated AI text verification of this receipt and authorized admin confirmation against organizer bank records.
              </label>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('upi_pay')}
                className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isProcessing || !utr || !screenshotBase64 || !consentGiven}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-display font-black text-xs uppercase tracking-wider shadow-lg transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analyzing & Submitting...</span>
                  </>
                ) : (
                  <>
                    <span>Submit Proof for Verification</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* STEP 4: Live Verification Status */}
        {step === 'status' && (
          <div className="space-y-4 text-center py-4">
            {liveStatus === 'payment_confirmed' ? (
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 animate-bounce">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <h4 className="text-xl font-black text-white font-display">Payment Confirmed!</h4>
                <p className="text-xs text-emerald-300 font-medium">
                  Verified against official bank record. Your tickets are ready!
                </p>
              </div>
            ) : liveStatus === 'ai_check_failed' ? (
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 border-2 border-red-400 flex items-center justify-center text-red-400">
                  <AlertCircle className="w-9 h-9" />
                </div>
                <h4 className="text-xl font-black text-white font-display">Verification Notice</h4>
                <p className="text-xs text-red-300 font-medium">{statusMessage}</p>
                <button
                  type="button"
                  onClick={() => setStep('proof')}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold font-display uppercase tracking-wider shadow cursor-pointer hover:bg-amber-300"
                >
                  Resubmit Proof
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/20 border-2 border-amber-400 flex items-center justify-center text-amber-400">
                  <Loader2 className="w-9 h-9 animate-spin" />
                </div>
                <h4 className="text-xl font-black text-white font-display">
                  {liveStatus === 'ai_check_passed' || liveStatus === 'awaiting_admin_review'
                    ? 'Details Matched'
                    : 'Verifying Payment Proof'}
                </h4>
                <p className="text-xs text-slate-300 font-medium max-w-sm mx-auto">
                  {statusMessage}
                </p>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/20 text-[11px] text-slate-400 font-mono">
                  Order Reference: <strong className="text-white">{bookingData?.booking.publicId}</strong>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
