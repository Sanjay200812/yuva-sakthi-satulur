import { LocalOcrAnalysisResult } from './localOcrAnalyzer.ts';

export interface OcrMatchInput {
  expectedAmountPaise: number;
  expectedPayeeUpiId: string;
  expectedPayeeName: string;
  enteredUtr?: string;
  selectedApp: string;
  bookingCreatedAt?: string;
  paymentExpiresAt?: string;
  analysis?: LocalOcrAnalysisResult;
  extraction?: any;
  isDuplicateUtr: boolean;
  isDuplicateScreenshot: boolean;
  isExpired?: boolean;
}

export interface OcrMatchResult {
  passed: boolean;
  riskScore: number;
  reasonCodes: string[];
  nextStatus: 'payment_confirmed' | 'payment_rejected' | 'ocr_processing_error';
  reviewStatus: 'ocr_verified' | 'ocr_check_failed' | 'ocr_processing_error';
  userMessage: string;
  isOcrProcessingError?: boolean;
  details: {
    utrMatched: boolean | null;
    amountMatched: boolean | null;
    statusMatched: boolean | null;
    payeeMatched: boolean | null;
  };
}

export function normalizeUtr(utr: string): string {
  if (!utr) return '';
  return utr.trim().replace(/[\s\-_]/g, '').toUpperCase();
}

/**
 * Strict 12-digit numeric UPI RRN validation
 */
export function isValidRrn(rrn: string): boolean {
  return /^\d{12}$/.test(normalizeUtr(rrn));
}

/**
 * Deterministic OCR Verification Engine:
 * Strictly validates OCR extraction results against server-authoritative booking parameters.
 * Completely code-only: NO AI or LLM in the loop.
 */
export function performDeterministicOcrComparison(input: OcrMatchInput): OcrMatchResult {
  const rawAnalysis = input.analysis || (input as any).extraction;
  const analysis: LocalOcrAnalysisResult = rawAnalysis ? {
    analysisCompleted: rawAnalysis.analysisCompleted ?? true,
    rawText: rawAnalysis.rawText || '',
    normalizedText: rawAnalysis.normalizedText || '',
    paymentStatus: rawAnalysis.paymentStatus || rawAnalysis.visible_payment_status || 'unknown',
    amount: rawAnalysis.amount !== undefined ? (rawAnalysis.amount === null ? null : Number(rawAnalysis.amount)) : null,
    amountText: rawAnalysis.amountText || (rawAnalysis.amount != null ? String(rawAnalysis.amount) : null),
    utrOrRrn: rawAnalysis.utrOrRrn || rawAnalysis.utr_or_rrn || null,
    transactionId: rawAnalysis.transactionId || rawAnalysis.transaction_id || null,
    transactionDate: rawAnalysis.transactionDate || null,
    transactionTime: rawAnalysis.transactionTime || null,
    transactionTimestamp: rawAnalysis.transactionTimestamp || rawAnalysis.transaction_timestamp || null,
    payeeName: rawAnalysis.payeeName || rawAnalysis.payee_name || null,
    payeeUpiId: rawAnalysis.payeeUpiId || rawAnalysis.payee_upi_id || null,
    payerName: rawAnalysis.payerName || rawAnalysis.payer_name || null,
    detectedApp: rawAnalysis.detectedApp || rawAnalysis.app_name || 'unknown',
    extractedFields: rawAnalysis.extractedFields || {},
    warnings: rawAnalysis.warnings || [],
  } : null as any;

  // 1. OCR Engine Processing Error / Crash: Keep non-final retryable state
  if (!analysis || !analysis.analysisCompleted || analysis.warnings?.includes('OCR_PROCESSING_ERROR')) {
    return {
      passed: false,
      riskScore: 0,
      reasonCodes: ['OCR_PROCESSING_ERROR'],
      nextStatus: 'ocr_processing_error',
      reviewStatus: 'ocr_processing_error',
      userMessage: "We couldn't process this receipt right now. Your payment proof is saved. Please retry verification.",
      isOcrProcessingError: true,
      details: {
        utrMatched: null,
        amountMatched: null,
        statusMatched: null,
        payeeMatched: null,
      },
    };
  }

  const reasonCodes: string[] = [];
  let riskScore = 0;
  const details = {
    utrMatched: null as boolean | null,
    amountMatched: null as boolean | null,
    statusMatched: null as boolean | null,
    payeeMatched: null as boolean | null,
  };

  // 2. Receipt Quality Check: If text is effectively empty or unreadable
  const hasExtractedSignals = Boolean(analysis.utrOrRrn || (analysis.amount !== null && !isNaN(analysis.amount)) || (analysis.paymentStatus && analysis.paymentStatus !== 'unknown'));
  const isUnreadable =
    analysis.warnings?.includes('OCR_UNREADABLE') ||
    (!hasExtractedSignals && (!analysis.normalizedText || analysis.normalizedText.trim().length < 5));

  if (isUnreadable) {
    reasonCodes.push('OCR_UNREADABLE');
    riskScore += 90;
  }

  // 2.5 Tampering or Authenticity Check (if signaled)
  if (analysis.warnings?.includes('TAMPERING_RISK') || (rawAnalysis as any)?.obvious_editing_signals?.length > 0 || (rawAnalysis as any)?.ai_generated_likelihood === 'high') {
    reasonCodes.push('TAMPERING_RISK');
    riskScore += 90;
  }

  // 3. Session Expiry Check
  if (input.isExpired) {
    reasonCodes.push('PAYMENT_SESSION_EXPIRED');
    riskScore += 100;
  }

  // 4. Duplicate checks (Database Uniqueness of extracted reference & image hash)
  if (input.isDuplicateUtr) {
    reasonCodes.push('DUPLICATE_PAYMENT_REFERENCE');
    reasonCodes.push('DUPLICATE_TRANSACTION_REFERENCE');
    riskScore += 100;
  }

  if (input.isDuplicateScreenshot) {
    reasonCodes.push('DUPLICATE_SCREENSHOT');
    riskScore += 90;
  }

  // 4b. AI Generator Watermark Check
  if (analysis.warnings?.includes('AI_GENERATOR_WATERMARK')) {
    reasonCodes.push('AI_GENERATOR_WATERMARK');
    riskScore += 100;
  }

  // 5. Visible Payment Status
  if (analysis.paymentStatus === 'failed') {
    reasonCodes.push('STATUS_NOT_SUCCESS');
    riskScore += 100;
    details.statusMatched = false;
  } else if (analysis.paymentStatus === 'pending') {
    reasonCodes.push('STATUS_NOT_SUCCESS');
    riskScore += 80;
    details.statusMatched = false;
  } else if (analysis.paymentStatus === 'success') {
    details.statusMatched = true;
  } else if (analysis.paymentStatus === 'unknown') {
    if (!isUnreadable) {
      reasonCodes.push('STATUS_NOT_SUCCESS');
      riskScore += 80;
    }
    details.statusMatched = false;
  }

  // 6. Extracted RRN Validation & Entered UTR Cross-Check
  if (!analysis.utrOrRrn) {
    if (!isUnreadable) {
      reasonCodes.push('MISSING_PAYMENT_REFERENCE');
      reasonCodes.push('MISSING_RRN');
      reasonCodes.push('REFERENCE_NOT_READABLE');
      riskScore += 80;
    }
    details.utrMatched = false;
  } else {
    const normalizedExtRrn = normalizeUtr(analysis.utrOrRrn);
    if (!normalizedExtRrn || normalizedExtRrn.length < 6 || !/^[A-Z0-9]+$/i.test(normalizedExtRrn)) {
      reasonCodes.push('INVALID_PAYMENT_REFERENCE');
      riskScore += 80;
      details.utrMatched = false;
    } else {
      details.utrMatched = true;
    }

    // Cross-check with entered UTR if supplied
    if (input.enteredUtr) {
      const normalizedEntered = normalizeUtr(input.enteredUtr);
      if (normalizedEntered && normalizedEntered !== normalizedExtRrn) {
        reasonCodes.push('TRANSACTION_REFERENCE_MISMATCH');
        details.utrMatched = false;
        riskScore += 80;
      }
    }
  }

  // 7. Amount Comparison (Extracted vs Expected Server Total)
  if (analysis.amount === null || isNaN(analysis.amount)) {
    if (!isUnreadable) {
      reasonCodes.push('MISSING_AMOUNT');
      riskScore += 80;
    }
    details.amountMatched = false;
  } else {
    const expectedNum = input.expectedAmountPaise / 100;
    if (Math.abs(analysis.amount - expectedNum) < 0.05) {
      details.amountMatched = true;
    } else {
      details.amountMatched = false;
      reasonCodes.push('AMOUNT_MISMATCH');
      riskScore += 90;
    }
  }

  // 8. Payee Comparison (if visible in OCR)
  if (analysis.payeeUpiId || analysis.payeeName) {
    const extPayee = `${analysis.payeeUpiId || ''} ${analysis.payeeName || ''}`.toLowerCase();
    const configPayeeId = input.expectedPayeeUpiId.toLowerCase();

    const matchesId = configPayeeId && extPayee.includes(configPayeeId);
    const matchesName = extPayee.includes('yuva') || extPayee.includes('shakti') || extPayee.includes('satulur');

    // Also check masked VPA match: 70****52@ybl vs 7075920852@ybl
    let matchesMasked = false;
    if (analysis.payeeUpiId && analysis.payeeUpiId.includes('*')) {
      const [maskUser, maskBank] = analysis.payeeUpiId.split('@');
      const [confUser, confBank] = configPayeeId.split('@');
      if (maskBank === confBank && maskUser.length >= 4) {
        const prefix = maskUser.slice(0, 2);
        const suffix = maskUser.slice(-2);
        if (confUser.startsWith(prefix) && confUser.endsWith(suffix)) {
          matchesMasked = true;
        }
      }
    }

    if (matchesId || matchesName || matchesMasked) {
      details.payeeMatched = true;
    } else {
      // If a full, non-matching UPI ID is clearly visible, fail for wrong payee
      if (analysis.payeeUpiId && !analysis.payeeUpiId.includes('*') && !matchesId) {
        details.payeeMatched = false;
        reasonCodes.push('WRONG_PAYEE');
        riskScore += 70;
      } else {
        details.payeeMatched = true;
      }
    }
  }

  // 9. Transaction Timing Verification (Supporting signal)
  if (analysis.transactionTimestamp && input.bookingCreatedAt) {
    const receiptTime = new Date(analysis.transactionTimestamp).getTime();
    const bookingTime = new Date(input.bookingCreatedAt).getTime();
    // Allow up to 3 minutes display/clock tolerance before booking creation
    if (!isNaN(receiptTime) && !isNaN(bookingTime)) {
      if (receiptTime < bookingTime - 3 * 60 * 1000) {
        reasonCodes.push('TRANSACTION_TIME_MISMATCH');
        riskScore += 60;
      }
    }
  }

  // Fail closed on any critical failure
  const hasFatalFailure =
    reasonCodes.includes('OCR_UNREADABLE') ||
    reasonCodes.includes('MISSING_PAYMENT_REFERENCE') ||
    reasonCodes.includes('DUPLICATE_PAYMENT_REFERENCE') ||
    reasonCodes.includes('INVALID_PAYMENT_REFERENCE') ||
    reasonCodes.includes('STATUS_NOT_SUCCESS') ||
    reasonCodes.includes('AMOUNT_MISMATCH') ||
    reasonCodes.includes('MISSING_AMOUNT') ||
    reasonCodes.includes('DUPLICATE_SCREENSHOT') ||
    reasonCodes.includes('WRONG_PAYEE') ||
    reasonCodes.includes('TRANSACTION_TIME_MISMATCH') ||
    reasonCodes.includes('PAYMENT_SESSION_EXPIRED') ||
    riskScore >= 50;

  if (hasFatalFailure) {
    let failMessage = 'Verification failed. Please review the highlighted issue and resubmit.';

    if (reasonCodes.includes('OCR_UNREADABLE')) {
      failMessage =
        "We couldn't clearly read this screenshot. Please upload the detailed payment receipt showing amount, success status and transaction reference.";
    } else if (reasonCodes.includes('PAYMENT_SESSION_EXPIRED')) {
      failMessage = 'Payment session expired. Start a new booking.';
    } else if (reasonCodes.includes('DUPLICATE_PAYMENT_REFERENCE')) {
      failMessage = 'This payment receipt has already been used for another booking.';
    } else if (reasonCodes.includes('DUPLICATE_SCREENSHOT')) {
      failMessage = 'This payment screenshot has already been submitted for another booking.';
    } else if (reasonCodes.includes('MISSING_PAYMENT_REFERENCE')) {
      failMessage =
        "We couldn't clearly read the transaction reference from this screenshot. Please upload the detailed payment receipt showing the UTR or reference number.";
    } else if (reasonCodes.includes('INVALID_PAYMENT_REFERENCE')) {
      failMessage =
        "We couldn't find a valid 12-digit transaction reference on this screenshot. Please upload the detailed receipt.";
    } else if (reasonCodes.includes('AMOUNT_MISMATCH')) {
      failMessage = 'Payment amount on receipt does not match the booking total.';
    } else if (reasonCodes.includes('MISSING_AMOUNT')) {
      failMessage =
        'Could not detect the payment amount on the screenshot. Please upload a complete receipt.';
    } else if (reasonCodes.includes('STATUS_NOT_SUCCESS')) {
      failMessage = 'Payment is not shown as successful on this receipt.';
    } else if (reasonCodes.includes('WRONG_PAYEE')) {
      failMessage =
        'The recipient UPI ID does not match the official Yuva Shakti account.';
    } else if (reasonCodes.includes('TRANSACTION_TIME_MISMATCH')) {
      failMessage =
        'The transaction date/time on this receipt does not match your booking window.';
    }

    return {
      passed: false,
      riskScore,
      reasonCodes,
      nextStatus: 'payment_rejected',
      reviewStatus: 'ocr_check_failed',
      userMessage: failMessage,
      details,
    };
  }

  return {
    passed: true,
    riskScore: 0,
    reasonCodes: ['OCR_VERIFIED'],
    nextStatus: 'payment_confirmed',
    reviewStatus: 'ocr_verified',
    userMessage: 'Payment proof verified successfully. Coupons generated.',
    details,
  };
}

// Backwards-compatible alias for existing imports
export const performDeterministicComparison = performDeterministicOcrComparison;
export type MatchInput = OcrMatchInput;
export type MatchResult = OcrMatchResult;
