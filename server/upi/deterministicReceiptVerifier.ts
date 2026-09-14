import { LocalOcrAnalysisResult } from './localOcrAnalyzer.ts';

export interface ReceiptVerificationInput {
  expectedAmountPaise: number;
  expectedPayeeUpiId: string;
  expectedPayeeName: string;
  enteredReference?: string;
  selectedApp?: string;
  bookingCreatedAt?: string;
  paymentExpiresAt?: string;
  ocrAnalysis?: LocalOcrAnalysisResult | null;
  isDuplicateReference: boolean;
  isDuplicateScreenshot: boolean;
  isExpired?: boolean;
  originalFilename?: string;
  isSuspiciousFilename?: boolean;
  isValidScreenshotFormat?: boolean;
}

export interface ReceiptVerificationResult {
  verified: boolean;
  riskScore: number;
  reasonCodes: string[];
  nextStatus: 'payment_confirmed' | 'payment_rejected' | 'ocr_processing_error';
  reviewStatus: 'ocr_verified' | 'ocr_check_failed' | 'ocr_processing_error';
  userMessage: string;
  isOcrProcessingError?: boolean;
  details: {
    referenceMatched: boolean | null;
    amountMatched: boolean | null;
    statusMatched: boolean | null;
    payeeMatched: boolean | null;
    timestampMatched: boolean | null;
  };
}

/**
 * Normalizes a user-entered or OCR-extracted payment reference (UTR/RRN/Txn ID).
 * Trims whitespace, removes hyphens, spaces, and colons, and converts to uppercase.
 */
export function normalizeTransactionReference(ref?: string | null): string {
  if (!ref) return '';
  return ref.trim().replace(/[\s\-_:]/g, '').toUpperCase();
}

/**
 * Checks if a reference matches the standard 12-digit numeric Indian UPI RRN format.
 */
export function is12DigitRrn(ref: string): boolean {
  return /^\d{12}$/.test(normalizeTransactionReference(ref));
}

/**
 * Safely compares masked UPI ID (e.g. 70****52@ybl) against an authoritative UPI ID (7075920852@ybl).
 */
export function isMaskedUpiMatch(maskedUpi: string, expectedUpi: string): boolean {
  if (!maskedUpi || !expectedUpi) return false;
  const mLower = maskedUpi.toLowerCase().trim();
  const eLower = expectedUpi.toLowerCase().trim();

  if (mLower === eLower) return true;

  const [mUser, mBank] = mLower.split('@');
  const [eUser, eBank] = eLower.split('@');

  if (!mBank || !eBank || mBank !== eBank) return false;
  if (!mUser.includes('*')) return mUser === eUser;

  const prefixMatch = mUser.match(/^([^*]+)/);
  const suffixMatch = mUser.match(/([^*]+)$/);

  const prefix = prefixMatch ? prefixMatch[1] : '';
  const suffix = suffixMatch ? suffixMatch[1] : '';

  if (prefix && !eUser.startsWith(prefix)) return false;
  if (suffix && !eUser.endsWith(suffix)) return false;

  return true;
}

/**
 * Master Deterministic Receipt Verifier.
 * Performs code-only, zero-AI, fail-closed validation of payment screenshots
 * and cross-checks with user-entered UTR and server-authoritative booking parameters.
 */
export function verifyPaymentReceipt(input: ReceiptVerificationInput): ReceiptVerificationResult {
  // 1. Format Check
  if (input.isValidScreenshotFormat === false) {
    return {
      verified: false,
      riskScore: 100,
      reasonCodes: ['INVALID_SCREENSHOT_FORMAT'],
      nextStatus: 'payment_rejected',
      reviewStatus: 'ocr_check_failed',
      userMessage: 'Invalid screenshot file format. Please upload a clear PNG, JPEG, or WebP payment receipt.',
      details: {
        referenceMatched: false,
        amountMatched: null,
        statusMatched: null,
        payeeMatched: null,
        timestampMatched: null,
      },
    };
  }

  // 2. Session Expiry Check
  if (input.isExpired) {
    return {
      verified: false,
      riskScore: 90,
      reasonCodes: ['PAYMENT_SESSION_EXPIRED'],
      nextStatus: 'payment_rejected',
      reviewStatus: 'ocr_check_failed',
      userMessage: 'Payment session has expired. Please start a new booking.',
      details: {
        referenceMatched: null,
        amountMatched: null,
        statusMatched: null,
        payeeMatched: null,
        timestampMatched: null,
      },
    };
  }

  const analysis = input.ocrAnalysis;

  // 3. OCR Processing Error / Worker Crash Check
  if (!analysis || !analysis.analysisCompleted || analysis.warnings?.includes('OCR_PROCESSING_ERROR')) {
    return {
      verified: false,
      riskScore: 0,
      reasonCodes: ['OCR_PROCESSING_ERROR'],
      nextStatus: 'ocr_processing_error',
      reviewStatus: 'ocr_processing_error',
      userMessage: "Your payment proof has been saved, but verification could not be completed right now. Please retry verification. Do not make another payment.",
      isOcrProcessingError: true,
      details: {
        referenceMatched: null,
        amountMatched: null,
        statusMatched: null,
        payeeMatched: null,
        timestampMatched: null,
      },
    };
  }

  const reasonCodes: string[] = [];
  let riskScore = 0;
  const details = {
    referenceMatched: null as boolean | null,
    amountMatched: null as boolean | null,
    statusMatched: null as boolean | null,
    payeeMatched: null as boolean | null,
    timestampMatched: null as boolean | null,
  };

  const normalizedEnteredRef = normalizeTransactionReference(input.enteredReference);
  const ocrExtractedRef = analysis.utrOrRrn || analysis.transactionId;
  const normalizedOcrRef = normalizeTransactionReference(ocrExtractedRef);

  // 4. OCR Legibility Check
  if (analysis.warnings?.includes('OCR_UNREADABLE') || !analysis.normalizedText || analysis.normalizedText.trim().length < 15) {
    reasonCodes.push('OCR_UNREADABLE');
    riskScore += 40;
  }

  // 5. Explicit AI-Generator Watermark Detection
  if (analysis.warnings?.includes('AI_GENERATOR_WATERMARK')) {
    reasonCodes.push('AI_GENERATOR_WATERMARK');
    riskScore += 100;
  }

  // 6. Suspicious Filename Pattern Check (only when accompanied by watermark or anomaly)
  if (input.isSuspiciousFilename && (reasonCodes.includes('AI_GENERATOR_WATERMARK') || riskScore > 30)) {
    reasonCodes.push('SUSPICIOUS_FILENAME');
    riskScore += 30;
  }

  // 7. Payment Status Extraction Check
  if (analysis.paymentStatus === 'success') {
    details.statusMatched = true;
  } else {
    details.statusMatched = false;
    reasonCodes.push('STATUS_NOT_SUCCESS');
    riskScore += 50;
  }

  // 8. User Entered Reference Validation
  if (!normalizedEnteredRef) {
    reasonCodes.push('MISSING_TRANSACTION_REFERENCE');
    riskScore += 40;
  } else if (normalizedEnteredRef.length < 6 || normalizedEnteredRef.length > 36) {
    reasonCodes.push('INVALID_TRANSACTION_REFERENCE');
    riskScore += 40;
  }

  // 9. OCR Reference Extraction & Cross-Match Check
  if (!normalizedOcrRef) {
    reasonCodes.push('REFERENCE_NOT_READABLE');
    riskScore += 40;
    details.referenceMatched = false;
  } else if (normalizedEnteredRef && normalizedEnteredRef !== normalizedOcrRef) {
    // Cross-match mismatch between what user typed and what OCR sees
    details.referenceMatched = false;
    reasonCodes.push('TRANSACTION_REFERENCE_MISMATCH');
    riskScore += 60;
  } else {
    details.referenceMatched = true;
  }

  // 10. Amount Validation
  if (analysis.amount == null) {
    details.amountMatched = false;
    reasonCodes.push('MISSING_AMOUNT');
    riskScore += 40;
  } else {
    const extractedPaise = Math.round(Number(analysis.amount) * 100);
    if (extractedPaise === input.expectedAmountPaise) {
      details.amountMatched = true;
    } else {
      details.amountMatched = false;
      reasonCodes.push('AMOUNT_MISMATCH');
      riskScore += 60;
    }
  }

  // 11. Duplicate Reference Check
  if (input.isDuplicateReference) {
    reasonCodes.push('DUPLICATE_TRANSACTION_REFERENCE');
    riskScore += 90;
    details.referenceMatched = false;
  }

  // 12. Duplicate Screenshot Check
  if (input.isDuplicateScreenshot) {
    reasonCodes.push('DUPLICATE_SCREENSHOT');
    riskScore += 90;
  }

  // 13. Payee UPI ID Verification (if visible in screenshot)
  if (analysis.payeeUpiId) {
    const rawPayee = analysis.payeeUpiId.toLowerCase().trim();
    const expPayee = input.expectedPayeeUpiId.toLowerCase().trim();

    if (rawPayee === expPayee || isMaskedUpiMatch(rawPayee, expPayee)) {
      details.payeeMatched = true;
    } else {
      details.payeeMatched = false;
      reasonCodes.push('WRONG_PAYEE');
      riskScore += 60;
    }
  } else {
    // Payee not visible or hidden by UPI app: acceptable if reference, amount & status match
    details.payeeMatched = true;
  }

  // 14. Transaction Timestamp Verification (Supporting signal, tolerance ±2 minutes)
  if (analysis.transactionTimestamp && input.bookingCreatedAt) {
    const txnMs = new Date(analysis.transactionTimestamp).getTime();
    const createdMs = new Date(input.bookingCreatedAt).getTime();
    const expiresMs = input.paymentExpiresAt ? new Date(input.paymentExpiresAt).getTime() : createdMs + 5 * 60 * 1000;

    const twoMinutesMs = 2 * 60 * 1000;
    const isWithinWindow = txnMs >= (createdMs - twoMinutesMs) && txnMs <= (expiresMs + twoMinutesMs);

    if (isWithinWindow) {
      details.timestampMatched = true;
    } else {
      details.timestampMatched = false;
      reasonCodes.push('TRANSACTION_TIME_MISMATCH');
      riskScore += 30;
    }
  } else {
    // Timestamp not extractable: supporting signal only, do NOT reject solely for missing timestamp
    details.timestampMatched = null;
  }

  // Final Decision: Strict Fail-Closed Verification
  const verified =
    reasonCodes.length === 0 &&
    details.statusMatched === true &&
    details.amountMatched === true &&
    details.referenceMatched === true &&
    details.payeeMatched === true &&
    !input.isDuplicateReference &&
    !input.isDuplicateScreenshot;

  const nextStatus = verified ? 'payment_confirmed' : 'payment_rejected';
  const reviewStatus = verified ? 'ocr_verified' : 'ocr_check_failed';

  // Construct clear, user-facing descriptive messages
  let userMessage = 'Payment proof verified successfully.';
  if (!verified) {
    if (reasonCodes.includes('DUPLICATE_TRANSACTION_REFERENCE')) {
      userMessage = 'This transaction reference has already been used for another booking.';
    } else if (reasonCodes.includes('DUPLICATE_SCREENSHOT')) {
      userMessage = 'This screenshot has already been submitted for another booking.';
    } else if (reasonCodes.includes('TRANSACTION_REFERENCE_MISMATCH')) {
      userMessage = 'The entered UTR does not match the transaction reference shown in the receipt.';
    } else if (reasonCodes.includes('AMOUNT_MISMATCH')) {
      const expInr = (input.expectedAmountPaise / 100).toFixed(2);
      const gotInr = analysis.amount != null ? Number(analysis.amount).toFixed(2) : '0';
      userMessage = `The payment amount is ₹${gotInr} but this booking requires ₹${expInr}.`;
    } else if (reasonCodes.includes('OCR_UNREADABLE')) {
      userMessage = "We couldn't clearly read this payment receipt. Please upload the detailed payment confirmation screen showing amount, payment status and transaction reference.";
    } else if (reasonCodes.includes('STATUS_NOT_SUCCESS')) {
      userMessage = `The uploaded receipt shows the transaction as ${analysis.paymentStatus || 'not successful'}. Please upload a successful receipt.`;
    } else if (reasonCodes.includes('WRONG_PAYEE')) {
      userMessage = 'The payment recipient does not match the configured receiver (Yuva Shakti Youth Satulur).';
    } else if (reasonCodes.includes('AI_GENERATOR_WATERMARK')) {
      userMessage = 'This image appears to be an AI-generated mock receipt and cannot be verified.';
    } else if (reasonCodes.includes('REFERENCE_NOT_READABLE')) {
      userMessage = "We couldn't clearly read the transaction reference from this receipt. Please upload the detailed payment receipt.";
    } else if (reasonCodes.includes('TRANSACTION_TIME_MISMATCH')) {
      userMessage = 'The transaction time on the receipt does not match your active payment session.';
    } else if (reasonCodes.includes('MISSING_TRANSACTION_REFERENCE')) {
      userMessage = 'Please enter the 12-digit UPI UTR / Transaction ID from your payment app.';
    } else {
      userMessage = 'Payment verification could not be completed with the provided screenshot. Please upload a clear, unedited payment confirmation screen.';
    }
  }

  return {
    verified,
    riskScore,
    reasonCodes,
    nextStatus,
    reviewStatus,
    userMessage,
    details,
  };
}
