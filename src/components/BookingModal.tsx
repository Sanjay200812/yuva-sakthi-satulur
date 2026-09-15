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
  Clock,
} from 'lucide-react';
import { CouponBooking } from '../types.ts';
import {
  createBooking,
  submitPaymentProof,
  retryPaymentVerification,
  pollPaymentStatus,
  BookingCreationResponse,
} from '../utils/payment.ts';
import { downloadAuthorizedFile } from '../utils/download.ts';

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

type ModalStep = 'details' | 'payment' | 'proof' | 'status';
type UpiAppChoice = 'phonepe' | 'google_pay' | 'paytm' | 'fampay' | 'other_upi';

const UPI_APPS: { id: UpiAppChoice; label: string; appName: string; color: string }[] = [
  { id: 'phonepe', label: 'PhonePe', appName: 'PhonePe', color: 'bg-purple-900/60 border-purple-500' },
  { id: 'google_pay', label: 'Google Pay', appName: 'Google Pay', color: 'bg-blue-900/60 border-blue-500' },
  { id: 'paytm', label: 'Paytm', appName: 'Paytm', color: 'bg-cyan-900/60 border-cyan-500' },
  { id: 'fampay', label: 'FamPay', appName: 'FamPay', color: 'bg-amber-900/60 border-amber-500' },
  { id: 'other_upi', label: 'Other UPI Apps', appName: 'UPI App', color: 'bg-emerald-900/60 border-emerald-500' },
];

const REASON_MESSAGES: Record<string, string> = {
  INVALID_SCREENSHOT_FORMAT: 'Invalid screenshot format. Only PNG, JPEG, or WebP images are accepted.',
  OCR_UNREADABLE: "We couldn't clearly read this payment receipt. Please upload the detailed payment confirmation screen showing amount, payment status and transaction reference.",
  OCR_PROCESSING_ERROR: "We couldn't process your receipt right now. Please retry verification. Do not make another payment.",
  REFERENCE_NOT_READABLE: "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the transaction/reference number.",
  DUPLICATE_TRANSACTION_REFERENCE: 'This transaction reference has already been used.',
  MISSING_AMOUNT: 'Could not detect the payment amount on the screenshot. Please upload a complete receipt.',
  AMOUNT_MISMATCH: 'The receipt amount does not match this booking.',
  STATUS_NOT_SUCCESS: 'The uploaded receipt shows the transaction as pending or failed. Only successful payments can be verified.',
  DUPLICATE_SCREENSHOT: 'This screenshot has already been submitted for another booking.',
  WRONG_PAYEE: 'The payment recipient does not match the configured receiver.',
  TRANSACTION_TIME_MISMATCH: 'Transaction timestamp on the receipt does not match this booking session.',
  AI_GENERATOR_WATERMARK: 'AI generator watermark detected on the uploaded image. Please upload an authentic payment receipt.',
  PAYMENT_SESSION_EXPIRED: 'Payment session expired. Start a new payment session.',
  // Fallbacks
  MISSING_PAYMENT_REFERENCE: "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the transaction/reference number.",
  MISSING_RRN: "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the transaction/reference number.",
  MISSING_TRANSACTION_REFERENCE: "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the transaction/reference number.",
  INVALID_TRANSACTION_REFERENCE: "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the transaction/reference number.",
  DUPLICATE_PAYMENT_REFERENCE: 'This transaction reference has already been used.',
  DUPLICATE_RRN: 'This transaction reference has already been used.',
  DUPLICATE_UTR: 'This transaction reference has already been used.',
};

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

  // Active payment session state (locked once created, server-authoritative 5-minute session)
  const [bookingData, setBookingData] = useState<BookingCreationResponse | null>(null);

  // Session timer state driven strictly by server expiresAt
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isExpired, setIsExpired] = useState<boolean>(false);

  // Proof form state: Screenshot ONLY (No manual UTR / reference input)
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string>('');
  const [originalMimeType, setOriginalMimeType] = useState<string>('');
  const [consentGiven, setConsentGiven] = useState<boolean>(true);
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);

  // Status & Polling state
  const [liveStatus, setLiveStatus] = useState<string>('payment_initiated');
  const [statusMessage, setStatusMessage] = useState<string>('Payment initiated.');
  const [confirmedBookingData, setConfirmedBookingData] = useState<CouponBooking | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  // Restore active booking if valid and unexpired; otherwise clean state when modal opens
  useEffect(() => {
    if (isOpen) {
      try {
        const saved = sessionStorage.getItem('active_upi_session');
        if (saved) {
          const parsed: BookingCreationResponse = JSON.parse(saved);
          if (parsed?.payment?.expiresAt && new Date(parsed.payment.expiresAt).getTime() > Date.now()) {
            setBookingData(parsed);
            const savedStep = (sessionStorage.getItem('active_upi_step') as ModalStep) || 'payment';
            setStep(savedStep);
            setName(parsed.booking.name);
            setPhone(parsed.booking.phone);
            setVillage(parsed.booking.village);
            setQuantity(parsed.booking.quantity);
            setErrorMessage(null);
            setIsExpired(false);
            return;
          } else {
            sessionStorage.removeItem('active_upi_session');
            sessionStorage.removeItem('active_upi_step');
          }
        }
      } catch {}

      setStep('details');
      setErrorMessage(null);
      setBookingData(null);
      setScreenshotBase64(null);
      setScreenshotPreview(null);
      setIsExpired(false);
      setRemainingSeconds(null);
    }
  }, [isOpen]);

  // Server-authoritative 5-minute countdown
  useEffect(() => {
    if (!bookingData?.payment?.expiresAt) {
      setRemainingSeconds(null);
      setIsExpired(false);
      return;
    }

    const updateTimer = () => {
      const expiry = new Date(bookingData.payment.expiresAt).getTime();
      const diff = Math.floor((expiry - Date.now()) / 1000);
      if (diff <= 0) {
        setRemainingSeconds(0);
        setIsExpired(true);
      } else {
        setRemainingSeconds(diff);
        setIsExpired(false);
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [bookingData?.payment?.expiresAt]);

  if (!isOpen) return null;

  const formatCountdown = (secs: number | null) => {
    if (secs === null || secs <= 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleResetSession = () => {
    try {
      sessionStorage.removeItem('active_upi_session');
      sessionStorage.removeItem('active_upi_step');
    } catch {}
    setBookingData(null);
    setStep('details');
    setErrorMessage(null);
    setScreenshotBase64(null);
    setScreenshotPreview(null);
    setOriginalFilename('');
    setOriginalMimeType('');
    setIsExpired(false);
    setRemainingSeconds(null);
  };

  // 1. Submit Booking Details (Server calculates & locks authoritative amount)
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
      setStep('payment');
      try {
        sessionStorage.setItem('active_upi_session', JSON.stringify(resp));
        sessionStorage.setItem('active_upi_step', 'payment');
      } catch {}
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

    setOriginalFilename(file.name);
    setOriginalMimeType(file.type);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setScreenshotBase64(result);
      setScreenshotPreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleBookingConfirmed = (confirmed: any) => {
    const token = bookingData?.payment?.downloadToken
      || confirmed.downloadToken
      || (confirmed as any).data?.downloadToken
      || bookingData?.payment?.statusToken;

    try {
      sessionStorage.removeItem('active_upi_session');
      sessionStorage.removeItem('active_upi_step');
    } catch {}
    const coupons = confirmed.coupons || [];
    const maskedRef = confirmed.referenceMasked
      || confirmed.transactionReferenceMasked
      || (confirmed.extractedRrn?.length >= 4 ? `********${confirmed.extractedRrn.slice(-4)}` : '********9012');

    const confirmedBooking: CouponBooking = {
      id: bookingData?.booking.publicId || confirmed.publicId,
      ticketNumbers: coupons.map((c: any) => c.coupon_number),
      name: coupons[0]?.holder_name || bookingData?.booking.name || 'Participant',
      phone: coupons[0]?.phone || bookingData?.booking.phone || '',
      village: coupons[0]?.village || bookingData?.booking.village || 'Satulur',
      quantity: bookingData?.booking.quantity || coupons.length || 1,
      totalAmount: bookingData?.booking.totalAmount || 50,
      bookedAt: new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
      status: 'confirmed',
      transactionRef: maskedRef,
      downloadToken: token,
    };

    // Store secure temporary download context for this browser session (Requirement 10)
    try {
      sessionStorage.setItem(
        'confirmed_booking_download',
        JSON.stringify({
          publicId: confirmedBooking.id,
          downloadToken: token,
          couponNumbers: confirmedBooking.ticketNumbers,
        })
      );
    } catch {}

    setConfirmedBookingData(confirmedBooking);
    setLiveStatus('payment_confirmed');
    setStatusMessage(`Payment proof verified! ${confirmedBooking.quantity} coupons generated.`);
  };

  const getEffectiveDownloadToken = (): string | undefined => {
    if (confirmedBookingData?.downloadToken) return confirmedBookingData.downloadToken;
    if (bookingData?.payment?.downloadToken) return bookingData.payment.downloadToken;
    try {
      const stored = sessionStorage.getItem('confirmed_booking_download');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.publicId === (confirmedBookingData?.id || bookingData?.booking.publicId)) {
          return parsed.downloadToken;
        }
      }
    } catch {}
    return bookingData?.payment?.statusToken;
  };

  const handleCouponDownload = async (couponNum: string, format: 'pdf' | 'png' | 'jpeg') => {
    const token = getEffectiveDownloadToken();
    setDownloadingFormat(format);
    setDownloadError(null);
    try {
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
      setDownloadingFormat(null);
    }
  };

  const handleDownloadAll = async () => {
    const publicId = bookingData?.booking.publicId || confirmedBookingData?.id;
    if (!publicId) return;
    const token = getEffectiveDownloadToken();
    setDownloadingFormat('all');
    setDownloadError(null);
    try {
      const isMulti = (confirmedBookingData?.ticketNumbers?.length || 0) > 1;
      const filename = isMulti ? `YuvaShakti-${publicId}-Coupons.zip` : `YuvaShakti-${publicId}-Tickets.pdf`;
      const res = await downloadAuthorizedFile(
        `/api/bookings/${publicId}/download-all`,
        token,
        filename
      );
      if (!res.success && res.error) {
        setDownloadError(res.error);
      }
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleManualRetry = async () => {
    if (!bookingData) return;
    setIsProcessing(true);
    setLiveStatus('analyzing');
    setStatusMessage('Reading receipt...');

    try {
      const res = await retryPaymentVerification({
        publicId: bookingData.booking.publicId,
        statusToken: bookingData.payment.statusToken,
      });

      if ((res.status === 'payment_confirmed' || res.status === 'proof_verified') && res.coupons?.length) {
        handleBookingConfirmed(res);
        return;
      }

      if (res.status === 'ocr_processing_error') {
        setLiveStatus('ocr_processing_error');
        setStatusMessage(res.message || "We couldn't process your receipt right now. Please retry verification. Do not make another payment.");
      } else {
        setLiveStatus('verification_failed');
        const reason = (res as any).reasonCode || (res as any).reasons?.[0];
        const friendly = reason && REASON_MESSAGES[reason] ? REASON_MESSAGES[reason] : (res.message || 'Payment proof verification failed.');
        setStatusMessage(friendly);
      }
    } catch (err: any) {
      setLiveStatus('ocr_processing_error');
      setStatusMessage(err.message || "We couldn't process your receipt right now. Please retry verification. Do not make another payment.");
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Submit Payment Proof (Screenshot-Only + User Consent)
  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingData) return;

    if (isExpired) {
      setErrorMessage('Payment session expired. Start a new payment session.');
      return;
    }

    if (!screenshotBase64) {
      alert('Please upload your payment screenshot.');
      return;
    }

    if (!consentGiven) {
      alert('Please check the consent box to proceed with verification.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setStep('status');
    setLiveStatus('analyzing');
    setStatusMessage('Reading receipt...');

    // Lightweight UI animation stages
    const verificationStages = [
      'Reading receipt...',
      'Checking amount...',
      'Checking transaction...',
      'Checking recipient...',
      'Final verification...',
    ];
    let stageIdx = 0;
    const progressTimer = setInterval(() => {
      stageIdx++;
      if (stageIdx < verificationStages.length) {
        setStatusMessage(verificationStages[stageIdx]);
      }
    }, 400);

    try {
      const res = await submitPaymentProof({
        publicId: bookingData.booking.publicId,
        screenshotBase64,
        selectedApp,
        consentGiven,
        statusToken: bookingData.payment.statusToken,
        isRecovery: isExpired || false,
        originalFilename,
        originalMimeType,
      });

      clearInterval(progressTimer);

      if ((res.status === 'payment_confirmed' || res.status === 'proof_verified') && res.coupons?.length) {
        handleBookingConfirmed(res);
        return;
      }

      if (res.status === 'ocr_processing_error') {
        setLiveStatus('ocr_processing_error');
        setStatusMessage(res.message || "We couldn't process your receipt right now. Please retry verification. Do not make another payment.");
        return;
      }

      setLiveStatus(res.status);
      const reason = (res as any).reasonCode || (res as any).reasons?.[0];
      const friendlyMessage = reason && REASON_MESSAGES[reason]
        ? REASON_MESSAGES[reason]
        : (res.message || 'Payment proof verification failed.');
      setStatusMessage(friendlyMessage);

      // Only poll if background processing is pending
      if (res.status === 'pending_verification') {
        const stopPolling = pollPaymentStatus(
          bookingData.booking.publicId,
          (status, message, confirmed) => {
            setLiveStatus(status);
            setStatusMessage(message);

            if ((status === 'payment_confirmed' || status === 'proof_verified') && confirmed) {
              setConfirmedBookingData(confirmed);
              stopPolling();
            }
          },
          2000,
          bookingData.payment.statusToken
        );
      }
    } catch (err: any) {
      clearInterval(progressTimer);
      setLiveStatus('verification_failed');
      const errText = err.message || 'Payment proof verification failed.';
      setErrorMessage(errText);
      setStatusMessage(errText);
    } finally {
      setIsProcessing(false);
    }
  };

  // Copy UPI ID to clipboard
  const handleCopyUpiId = () => {
    if (!bookingData) return;
    navigator.clipboard.writeText(bookingData.payment.rawPayeeUpiId || bookingData.payment.payeeUpiId || '');
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  // Launch UPI App
  const handleLaunchApp = () => {
    if (!bookingData || isExpired) return;
    const intents = bookingData.payment.appIntents;
    let url = intents[selectedApp as keyof typeof intents];
    if (!url || selectedApp === 'other_upi') {
      url = intents.other_upi || intents.standard || bookingData.payment.canonicalUri;
    }
    try {
      window.location.href = url;
    } catch {
      window.location.href = intents.other_upi || intents.standard || bookingData.payment.canonicalUri;
    }
  };

  const selectedAppObj = UPI_APPS.find((a) => a.id === selectedApp) || UPI_APPS[0];

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
        <div className="text-center space-y-2 mb-4">
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

        {/* 4 Phases Progress Indicator */}
        <div className="grid grid-cols-4 gap-1.5 mb-4 text-[10px] font-semibold text-center">
          {[
            { id: 'details', label: '1. Details' },
            { id: 'payment', label: '2. Payment' },
            { id: 'proof', label: '3. Proof' },
            { id: 'status', label: '4. Verify' },
          ].map((phase, idx) => {
            const phaseOrder: ModalStep[] = ['details', 'payment', 'proof', 'status'];
            const currentIdx = phaseOrder.indexOf(step);
            const isActive = step === phase.id;
            const isCompleted = currentIdx > idx;

            return (
              <div
                key={phase.id}
                className={`py-1 px-1 rounded-md transition border ${
                  isActive
                    ? 'bg-amber-400/20 text-amber-300 border-amber-400/60 font-bold'
                    : isCompleted
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-900/60 text-slate-500 border-slate-800'
                }`}
              >
                {phase.label}
              </div>
            );
          })}
        </div>

        {/* Session Timer & Expiry Alert */}
        {bookingData && (
          <div
            className={`p-2.5 mb-4 rounded-xl border flex items-center justify-between text-xs transition ${
              isExpired
                ? 'bg-red-950/70 border-red-500/50 text-red-200'
                : remainingSeconds !== null && remainingSeconds < 60
                ? 'bg-amber-950/70 border-amber-500/50 text-amber-200 animate-pulse'
                : 'bg-purple-950/50 border-purple-500/30 text-purple-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock className={`w-4 h-4 ${isExpired ? 'text-red-400' : 'text-amber-400'}`} />
              <span className="font-semibold">
                {isExpired ? 'Session Expired' : 'Payment Session Expiry:'}
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono font-bold">
              <span>{formatCountdown(remainingSeconds)}</span>
              {isExpired && (
                <button
                  type="button"
                  onClick={handleResetSession}
                  className="px-2 py-0.5 rounded bg-red-800 hover:bg-red-700 text-white text-[10px] uppercase cursor-pointer"
                >
                  Restart
                </button>
              )}
            </div>
          </div>
        )}

        {/* Expired Message Banner */}
        {isExpired && step !== 'proof' && (
          <div className="p-3 mb-4 rounded-xl bg-red-950/80 border border-red-500 text-red-200 text-xs font-semibold text-center space-y-2">
            <p>Payment session expired. Start a new booking.</p>
            <button
              type="button"
              onClick={handleResetSession}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold uppercase tracking-wider text-xs cursor-pointer shadow"
            >
              Start New Booking
            </button>
          </div>
        )}
        {isExpired && step === 'proof' && (
          <div className="p-3 mb-4 rounded-xl bg-amber-950/60 border border-amber-500/50 text-amber-200 text-xs text-center space-y-1">
            <p className="font-semibold">Timer ended, but proof submission is available.</p>
            <p className="text-[11px] text-slate-300">If you completed your UPI transfer, attach your screenshot below to complete verification.</p>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && !isExpired && (
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
                  placeholder="Enter your full name"
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
                  <span>Creating 5-Min Session...</span>
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
        {step === 'payment' && bookingData && (
          <div className="space-y-4">
            {/* Locked Amount & Session Banner */}
            <div className="p-3 rounded-2xl bg-[#0D132D] border border-amber-400/40 text-center space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-400 px-2 pb-1 border-b border-slate-800">
                <span>Quantity: <strong className="text-white">{bookingData.booking.quantity}</strong></span>
                <span>Rate: <strong className="text-amber-400 font-mono">₹50 × {bookingData.booking.quantity}</strong></span>
                <span>Ref: <strong className="font-mono text-white">{bookingData.payment.clientTxnId}</strong></span>
              </div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block pt-1">Authoritative Total</span>
              <span className="text-3xl font-black font-display text-amber-300">
                ₹{bookingData.payment.amountInr}
              </span>
              <div className="text-[10px] text-slate-400">
                Amount locked for session ({formatCountdown(remainingSeconds)} remaining)
              </div>
            </div>

            {/* UPI App Selection Buttons: Exactly PhonePe, Google Pay, Paytm, Other UPI Apps */}
            <div>
              <span className="text-xs font-semibold text-slate-300 block mb-2">Select Your UPI App:</span>
              <div className="grid grid-cols-4 gap-2">
                {UPI_APPS.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    disabled={isExpired}
                    onClick={() => setSelectedApp(app.id)}
                    className={`p-2 rounded-xl text-xs font-bold border transition cursor-pointer flex flex-col items-center gap-1 ${
                      selectedApp === app.id
                        ? `${app.color} text-white ring-2 ring-amber-400 shadow-md`
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                    } disabled:opacity-50`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span className="text-[10px] leading-tight text-center">{app.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile Prominent Pay Now Button */}
            <div className="block sm:hidden">
              <button
                type="button"
                disabled={isExpired}
                onClick={handleLaunchApp}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-display font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg transition disabled:opacity-50"
              >
                <Smartphone className="w-5 h-5" />
                <span>Pay ₹{bookingData.payment.amountInr} with {selectedAppObj.appName}</span>
              </button>
            </div>

            {/* Prominent QR Code (prominent on desktop, also visible on mobile) */}
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

            {/* Desktop Pay Now Button */}
            <div className="hidden sm:block">
              <button
                type="button"
                disabled={isExpired}
                onClick={handleLaunchApp}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md transition disabled:opacity-50"
              >
                <Smartphone className="w-4 h-4" />
                <span>Pay ₹{bookingData.payment.amountInr} with {selectedAppObj.appName}</span>
              </button>
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

            {/* Important Instructions */}
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-[11px] space-y-1 text-center">
              <span className="font-bold block">After Paying in Your UPI App:</span>
              <span>
                Return to this screen, click <strong>"I have completed payment"</strong> below, and upload your <strong>payment confirmation receipt screenshot</strong>.
              </span>
            </div>

            {/* Advance to Proof Button */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetSession}
                className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isExpired}
                onClick={() => {
                  setStep('proof');
                  try {
                    sessionStorage.setItem('active_upi_step', 'proof');
                  } catch {}
                }}
                className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-display font-black text-sm uppercase tracking-wider shadow-lg transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>I have completed payment</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Customer Verification Page (Screenshot-Only Automatic Extraction) */}
        {step === 'proof' && bookingData && (
          <form onSubmit={handleSubmitProof} className="space-y-4">
            <div className="text-center pb-2 border-b border-purple-500/20">
              <h3 className="text-base font-black font-display text-white tracking-wider uppercase">
                PAYMENT VERIFICATION
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3.5 rounded-2xl bg-[#0D132D] border border-purple-500/30 text-center">
              <div>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Booking:</span>
                <span className="font-mono font-bold text-white text-xs sm:text-sm truncate block">
                  {bookingData.booking.publicId}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Amount:</span>
                <span className="font-mono font-black text-amber-300 text-sm sm:text-base block">
                  ₹{Number(bookingData.payment.amountInr).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Time Remaining:</span>
                <span className={`font-mono font-bold text-xs sm:text-sm block ${remainingSeconds !== null && remainingSeconds < 60 ? 'text-red-400 animate-pulse' : 'text-purple-300'}`}>
                  {formatCountdown(remainingSeconds)}
                </span>
              </div>
            </div>

            {isExpired && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/50 text-red-200 text-xs text-center font-medium">
                Payment session expired. Start a new payment session.
              </div>
            )}

            {/* UPLOAD PAYMENT SCREENSHOT */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider block">
                UPLOAD PAYMENT SCREENSHOT
              </span>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/jpg,image/webp"
                disabled={isProcessing || isExpired}
                onChange={handleFileChange}
                className="hidden"
              />

              {!screenshotPreview ? (
                <div
                  onClick={() => !isProcessing && !isExpired && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                    isExpired
                      ? 'border-slate-800 bg-slate-950/40 opacity-50 cursor-not-allowed'
                      : 'border-amber-400/50 hover:border-amber-400 cursor-pointer bg-slate-950/80 hover:bg-slate-900/80 group shadow-[0_0_20px_rgba(245,158,11,0.08)]'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mx-auto mb-2.5 group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6 text-amber-400" />
                  </div>
                  <button
                    type="button"
                    disabled={isProcessing || isExpired}
                    className="px-4 py-2 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 font-bold text-xs uppercase tracking-wider mb-2 transition"
                  >
                    Select Screenshot
                  </button>
                  <div className="text-[11px] text-slate-400 space-y-0.5">
                    <p>Supported: PNG / JPG / JPEG / WebP</p>
                    <p className="text-slate-500">Maximum 5MB</p>
                  </div>
                </div>
              ) : (
                <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500/60 bg-black/60 p-3.5 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-3">
                    <img src={screenshotPreview} alt="Payment Screenshot" className="w-14 h-14 object-cover rounded-xl border border-emerald-500/30" />
                    <div>
                      <span className="text-xs font-bold text-white block truncate max-w-[200px]">{originalFilename || 'Payment Screenshot'}</span>
                      <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Attached &amp; ready
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isProcessing || isExpired}
                    onClick={() => {
                      setScreenshotBase64(null);
                      setScreenshotPreview(null);
                      setOriginalFilename('');
                      setOriginalMimeType('');
                    }}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800/80 rounded-xl transition cursor-pointer"
                    title="Remove screenshot"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Consent Checkbox */}
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-purple-500/20 flex items-start gap-2">
              <input
                type="checkbox"
                id="consent"
                checked={consentGiven}
                disabled={isProcessing || isExpired}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-purple-500 text-amber-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="consent" className="text-[11px] text-slate-300 leading-snug cursor-pointer">
                I confirm payment has been made and consent to automated receipt verification.
              </label>
            </div>

            {/* Submit Proof Buttons */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setStep('payment')}
                className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isProcessing || isExpired || !screenshotBase64 || !consentGiven}
                className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-display font-black text-xs uppercase tracking-wider shadow-lg transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>VERIFY PAYMENT</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* STEP 4: Live Verification & Customer Success / Failure Status */}
        {step === 'status' && (
          <div className="space-y-4 text-center py-3">
            {liveStatus === 'payment_confirmed' || liveStatus === 'proof_verified' ? (
              <div className="space-y-3.5">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 animate-bounce shadow-[0_0_25px_rgba(16,185,129,0.4)]">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <div>
                  <h4 className="text-xl font-black text-white font-display tracking-tight">
                    PAYMENT PROOF VERIFIED
                  </h4>
                  <p className="text-base text-emerald-400 font-bold font-mono mt-0.5">
                    ₹{bookingData?.payment.amountInr} Verified
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/20 space-y-1 text-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Transaction Reference:</span>
                    <span className="font-mono text-white font-bold">
                      {confirmedBookingData?.transactionRef || '********9012'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Generated Coupons:</span>
                    <span className="font-bold text-amber-300">
                      {confirmedBookingData?.quantity || bookingData?.booking.quantity || 1} Coupons Generated Successfully
                    </span>
                  </div>
                </div>

                {/* Download and View Buttons */}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmedBookingData) {
                        onBookSuccess(confirmedBookingData);
                        onClose();
                      }
                    }}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 font-display font-black text-xs uppercase tracking-wider shadow-lg cursor-pointer flex items-center justify-center gap-2 transition"
                  >
                    <Ticket className="w-4 h-4" />
                    <span>VIEW COUPONS</span>
                  </button>

                  {downloadError && (
                    <div className="p-2.5 rounded-lg bg-red-950/70 border border-red-500/40 text-red-200 text-xs text-center font-medium">
                      {downloadError}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={!!downloadingFormat}
                      onClick={() => {
                        const firstCoupon = confirmedBookingData?.ticketNumbers?.[0];
                        if (firstCoupon) handleCouponDownload(firstCoupon, 'pdf');
                        else handleDownloadAll();
                      }}
                      className="py-2.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 border border-slate-700 cursor-pointer disabled:opacity-50 transition"
                    >
                      {downloadingFormat === 'pdf' ? (
                        <span className="animate-pulse text-amber-300">DOWNLOADING...</span>
                      ) : (
                        <span>PDF</span>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!!downloadingFormat}
                      onClick={() => {
                        const firstCoupon = confirmedBookingData?.ticketNumbers?.[0];
                        if (firstCoupon) handleCouponDownload(firstCoupon, 'png');
                        else handleDownloadAll();
                      }}
                      className="py-2.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 border border-slate-700 cursor-pointer disabled:opacity-50 transition"
                    >
                      {downloadingFormat === 'png' ? (
                        <span className="animate-pulse text-amber-300">DOWNLOADING...</span>
                      ) : (
                        <span>PNG</span>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!!downloadingFormat}
                      onClick={() => {
                        const firstCoupon = confirmedBookingData?.ticketNumbers?.[0];
                        if (firstCoupon) handleCouponDownload(firstCoupon, 'jpeg');
                        else handleDownloadAll();
                      }}
                      className="py-2.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 border border-slate-700 cursor-pointer disabled:opacity-50 transition"
                    >
                      {downloadingFormat === 'jpeg' ? (
                        <span className="animate-pulse text-amber-300">DOWNLOADING...</span>
                      ) : (
                        <span>JPEG</span>
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={handleDownloadAll}
                    className="w-full py-2.5 rounded-xl bg-purple-950/70 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 text-[11px] font-bold uppercase tracking-wider block text-center cursor-pointer disabled:opacity-50 transition"
                  >
                    {downloadingFormat === 'all' ? (
                      <span className="animate-pulse text-amber-300">DOWNLOADING ALL...</span>
                    ) : (
                      <span>DOWNLOAD ALL / ZIP</span>
                    )}
                  </button>
                </div>
              </div>
            ) : liveStatus === 'ocr_processing_error' ? (
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center text-amber-400">
                  <AlertCircle className="w-9 h-9" />
                </div>
                <h4 className="text-xl font-black text-white font-display">Receipt Processing Notice</h4>
                <p className="text-xs text-amber-300 font-medium max-w-sm mx-auto">
                  {statusMessage || "Your payment proof has been saved, but verification could not be completed right now. Please retry verification. Do not make another payment."}
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleManualRetry}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 text-xs font-bold font-display uppercase tracking-wider shadow cursor-pointer flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                  >
                    {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    <span>RETRY VERIFICATION</span>
                  </button>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/20 text-[11px] text-slate-400 font-mono">
                  Order Reference: <strong className="text-white">{bookingData?.booking.publicId}</strong>
                </div>
              </div>
            ) : liveStatus === 'verification_failed' || liveStatus === 'rejected' || liveStatus === 'ocr_check_failed' ? (
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 border-2 border-red-400 flex items-center justify-center text-red-400">
                  <AlertCircle className="w-9 h-9" />
                </div>
                <h4 className="text-xl font-black text-white font-display">Verification Notice</h4>
                <p className="text-xs text-red-300 font-medium max-w-sm mx-auto">{statusMessage}</p>
                {!isExpired ? (
                  <button
                    type="button"
                    onClick={() => setStep('proof')}
                    className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold font-display uppercase tracking-wider shadow cursor-pointer hover:bg-amber-300"
                  >
                    Resubmit Proof
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleResetSession}
                    className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-bold font-display uppercase tracking-wider shadow cursor-pointer hover:bg-amber-300"
                  >
                    Start New Booking
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/20 border-2 border-amber-400 flex items-center justify-center text-amber-400">
                  <Loader2 className="w-9 h-9 animate-spin" />
                </div>
                <h4 className="text-xl font-black text-white font-display">Verifying Payment Proof</h4>
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
