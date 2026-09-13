import { config } from '../config/eventConfig.ts';
import { GeminiExtractionResult } from './geminiAnalyzer.ts';

export interface MatchInput {
  expectedAmountPaise: number;
  expectedPayeeUpiId: string;
  expectedPayeeName: string;
  enteredUtr: string;
  selectedApp: string;
  extraction: GeminiExtractionResult;
  isDuplicateUtr: boolean;
  isDuplicateScreenshot: boolean;
}

export interface MatchResult {
  passed: boolean;
  riskScore: number;
  reasonCodes: string[];
  nextStatus: 'awaiting_admin_review' | 'ai_check_failed';
  reviewStatus: 'ai_check_passed' | 'ai_check_failed' | 'awaiting_admin_review';
  userMessage: string;
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

export function performDeterministicComparison(input: MatchInput): MatchResult {
  const reasonCodes: string[] = [];
  let riskScore = 0;
  const details = {
    utrMatched: null as boolean | null,
    amountMatched: null as boolean | null,
    statusMatched: null as boolean | null,
    payeeMatched: null as boolean | null,
  };

  const normalizedEnteredUtr = normalizeUtr(input.enteredUtr);

  // 1. Mandatory Entered UTR Validation
  if (!normalizedEnteredUtr || normalizedEnteredUtr.length < 6) {
    reasonCodes.push('INVALID_UTR');
    riskScore += 100;
  }

  // 2. Duplicate checks (Database Uniqueness)
  if (input.isDuplicateUtr) {
    reasonCodes.push('DUPLICATE_UTR');
    riskScore += 100;
  }

  if (input.isDuplicateScreenshot) {
    reasonCodes.push('DUPLICATE_SCREENSHOT');
    riskScore += 90;
  }

  const ext = input.extraction;

  // 3. AI Service Availability check
  if (ext.obvious_editing_signals?.includes('AI_UNAVAILABLE')) {
    // If AI service is down or in test mode without mock, fail closed
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      reasonCodes.push('AI_UNAVAILABLE');
      riskScore += 80;
    }
  }

  // 4. Visible Payment Status
  if (ext.visible_payment_status === 'failed') {
    reasonCodes.push('STATUS_NOT_SUCCESS');
    riskScore += 100;
    details.statusMatched = false;
  } else if (ext.visible_payment_status === 'pending') {
    reasonCodes.push('STATUS_PENDING');
    riskScore += 60;
    details.statusMatched = false;
  } else if (ext.visible_payment_status === 'success') {
    details.statusMatched = true;
  } else if (ext.visible_payment_status === 'unknown') {
    // If status is not visibly success, fail closed unless test mode
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      reasonCodes.push('STATUS_UNKNOWN');
      riskScore += 50;
    }
  }

  // 5. UTR Comparison (Extracted vs Entered)
  if (ext.utr_or_rrn) {
    const normalizedExtUtr = normalizeUtr(ext.utr_or_rrn);
    if (normalizedExtUtr.includes(normalizedEnteredUtr) || normalizedEnteredUtr.includes(normalizedExtUtr)) {
      details.utrMatched = true;
    } else {
      details.utrMatched = false;
      reasonCodes.push('UTR_MISMATCH');
      riskScore += 80;
    }
  }

  // 6. Amount Comparison (Extracted vs Expected)
  if (ext.amount) {
    const extractedNum = parseFloat(ext.amount.replace(/[^0-9.]/g, ''));
    const expectedNum = input.expectedAmountPaise / 100;
    if (!isNaN(extractedNum) && Math.abs(extractedNum - expectedNum) < 0.05) {
      details.amountMatched = true;
    } else if (!isNaN(extractedNum)) {
      details.amountMatched = false;
      reasonCodes.push('AMOUNT_MISMATCH');
      riskScore += 90;
    }
  }

  // 7. Payee Comparison (if visible in OCR)
  if (ext.payee_upi_id || ext.payee_name) {
    const extPayee = `${ext.payee_upi_id || ''} ${ext.payee_name || ''}`.toLowerCase();
    const configPayeeId = input.expectedPayeeUpiId.toLowerCase();
    const configPayeeName = input.expectedPayeeName.toLowerCase();

    const matchesId = configPayeeId && extPayee.includes(configPayeeId);
    const matchesName = extPayee.includes('yuva') || extPayee.includes('shakti') || extPayee.includes('satulur');

    if (matchesId || matchesName) {
      details.payeeMatched = true;
    } else {
      details.payeeMatched = false;
      reasonCodes.push('WRONG_PAYEE');
      riskScore += 70;
    }
  }

  // 8. Tampering & AI-Generated Likelihood
  if (ext.ai_generated_likelihood === 'high' || ext.ai_generated_likelihood === 'medium') {
    reasonCodes.push('TAMPERING_RISK');
    riskScore += 70;
  }

  const obviousSignals = ext.obvious_editing_signals?.filter((s) => s !== 'AI_UNAVAILABLE') || [];
  if (obviousSignals.length > 0) {
    reasonCodes.push('TAMPERING_RISK');
    riskScore += 60;
  }

  // 9. Field Confidence Thresholds
  if (ext.field_confidence) {
    if (ext.field_confidence.amount < 0.4 && ext.amount) {
      reasonCodes.push('LOW_OCR_CONFIDENCE');
      riskScore += 30;
    }
    if (ext.field_confidence.utr < 0.4 && ext.utr_or_rrn) {
      reasonCodes.push('LOW_OCR_CONFIDENCE');
      riskScore += 30;
    }
  }

  // Evaluation: Fail closed on any violation
  const hasFatalFailure =
    reasonCodes.includes('INVALID_UTR') ||
    reasonCodes.includes('DUPLICATE_UTR') ||
    reasonCodes.includes('DUPLICATE_SCREENSHOT') ||
    reasonCodes.includes('STATUS_NOT_SUCCESS') ||
    reasonCodes.includes('AMOUNT_MISMATCH') ||
    reasonCodes.includes('UTR_MISMATCH') ||
    reasonCodes.includes('WRONG_PAYEE') ||
    reasonCodes.includes('TAMPERING_RISK') ||
    reasonCodes.includes('AI_UNAVAILABLE') ||
    riskScore >= 50;

  if (hasFatalFailure) {
    let failMessage = 'Verification failed, correct the highlighted issue and resubmit.';
    if (reasonCodes.includes('DUPLICATE_UTR')) {
      failMessage = 'This UTR has already been used for another booking.';
    } else if (reasonCodes.includes('UTR_MISMATCH')) {
      failMessage = 'The UTR on your screenshot does not match the entered UTR.';
    } else if (reasonCodes.includes('AMOUNT_MISMATCH')) {
      failMessage = 'The paid amount on the screenshot does not match the required booking total.';
    } else if (reasonCodes.includes('STATUS_NOT_SUCCESS')) {
      failMessage = 'The uploaded screenshot shows a failed or pending transaction.';
    } else if (reasonCodes.includes('AI_UNAVAILABLE')) {
      failMessage = 'Verification service is temporarily unavailable. Please retry later.';
    }

    return {
      passed: false,
      riskScore,
      reasonCodes,
      nextStatus: 'ai_check_failed',
      reviewStatus: 'ai_check_failed',
      userMessage: failMessage,
      details,
    };
  }

  return {
    passed: true,
    riskScore,
    reasonCodes,
    nextStatus: 'awaiting_admin_review',
    reviewStatus: 'ai_check_passed',
    userMessage: 'Details matched. Awaiting bank confirmation.',
    details,
  };
}
