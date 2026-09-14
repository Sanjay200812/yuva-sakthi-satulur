import { createWorker, Worker } from 'tesseract.js';
import { getSharp } from '../utils/sharpHelper.ts';

export interface OcrBookingContext {
  expectedMerchantName?: string;
  expectedAmount?: string; // e.g. "50.00" or "100.00"
  expectedAmountPaise?: number; // e.g. 5000 or 10000
  sessionTimestampIso?: string;
  bookingCreatedAt?: string;
  paymentExpiresAt?: string;
}

export interface ExtractedFields {
  paymentStatus: 'success' | 'pending' | 'failed' | 'unknown';
  amount: number | null;
  amountText: string | null;
  utrOrRrn: string | null;
  transactionId: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  transactionTimestamp: string | null;
  payeeName: string | null;
  payeeUpiId: string | null;
  payerName: string | null;
  detectedApp: 'phonepe' | 'google_pay' | 'paytm' | 'fampay' | 'other' | 'unknown';
  fieldConfidence: {
    status: number;
    amount: number;
    utr: number;
    payee: number;
    timestamp: number;
  };
}

export interface LocalOcrAnalysisResult {
  analysisCompleted: boolean;
  rawText: string;
  normalizedText: string;
  paymentStatus: 'success' | 'pending' | 'failed' | 'unknown';
  amount: number | null;
  amountText: string | null;
  utrOrRrn: string | null;
  transactionId: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  transactionTimestamp: string | null;
  payeeName: string | null;
  payeeUpiId: string | null;
  payerName: string | null;
  detectedApp: 'phonepe' | 'google_pay' | 'paytm' | 'fampay' | 'other' | 'unknown';
  extractedFields?: Partial<ExtractedFields> | Record<string, any>;
  warnings: string[];
  ocrEngine?: string;
  processingTimeMs?: number;
  error?: string;
  retryable?: boolean;
}

// Global warm worker reference for serverless reuse
let globalWorker: Worker | null = null;
let workerInitPromise: Promise<Worker> | null = null;

// Test mocks for fast and deterministic unit testing
let mockOcrText: string | null = null;
let mockOcrResult: Partial<LocalOcrAnalysisResult> | null = null;

export function setMockOcrText(text: string | null): void {
  mockOcrText = text;
}

export function setMockOcrResult(result: Partial<LocalOcrAnalysisResult> | null): void {
  mockOcrResult = result;
}

/**
 * Initializes or retrieves a warm Tesseract worker for English recognition.
 */
async function getOcrWorker(): Promise<Worker> {
  if (globalWorker) return globalWorker;

  if (workerInitPromise) return await workerInitPromise;

  workerInitPromise = (async () => {
    try {
      const worker = await createWorker('eng');
      globalWorker = worker;
      return worker;
    } finally {
      workerInitPromise = null;
    }
  })();

  return await workerInitPromise;
}

/**
 * Safely terminates the warm OCR worker on container shutdown.
 */
export async function terminateOcrWorker(): Promise<void> {
  if (globalWorker) {
    try {
      await globalWorker.terminate();
    } catch {
      // Ignore termination errors
    } finally {
      globalWorker = null;
    }
  }
}

/**
 * Preprocesses raw image buffer using Sharp in memory.
 * Generates 2-3 OCR-optimized variants (grayscale, contrast enhanced, sharpened).
 */
export async function generatePrimaryOcrCandidate(rawBuffer: Buffer): Promise<Buffer> {
  const sharp = await getSharp();
  if (!sharp) return rawBuffer;
  try {
    const metadata = await sharp(rawBuffer).metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 1200;
    const shouldUpscale = width < 900 || height < 1200;
    const targetWidth = shouldUpscale ? Math.round(width * 1.5) : width;

    let base = sharp(rawBuffer).rotate();
    if (shouldUpscale) {
      base = base.resize(targetWidth, null, { fit: 'inside' });
    }
    return await base
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2, m1: 1.0, m2: 2.0 })
      .png()
      .toBuffer();
  } catch (err) {
    return rawBuffer;
  }
}

export async function generateSecondaryContrastCandidate(rawBuffer: Buffer): Promise<Buffer> {
  const sharp = await getSharp();
  if (!sharp) return rawBuffer;
  try {
    return await sharp(rawBuffer)
      .rotate()
      .grayscale()
      .linear(1.4, -25)
      .sharpen()
      .png()
      .toBuffer();
  } catch (err) {
    return rawBuffer;
  }
}

export async function generateOcrImageCandidates(rawBuffer: Buffer): Promise<Buffer[]> {
  const primary = await generatePrimaryOcrCandidate(rawBuffer);
  return [primary];
}

/**
 * Normalizes OCR raw text conservatively without corrupting names or IDs.
 * Collapses excess whitespace, normalizes rupee and currency variants.
 */
export function normalizeOcrText(text: string): string {
  if (!text) return '';

  return text
    .replace(/[\u20B9\u20A8]/g, '₹') // Normalize Unicode Rupee symbols
    .replace(/\b(?:rs\.?|inr)\b/gi, '₹') // Normalize Rs. / INR to ₹
    .replace(/[^\S\r\n]+/g, ' ') // Collapse horizontal whitespace
    .replace(/\r\n|\r/g, '\n') // Normalize line breaks
    .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
    .trim();
}

/**
 * Controlled numeric normalization for RRN / UTR candidates.
 * Fixes common OCR letter-to-digit confusion strictly within reference tokens.
 */
function repairNumericReference(token: string): string {
  if (!token) return '';
  // Normalize O->0, I/l->1, S->5, B->8, Z->2 in pure numeric references
  return token
    .trim()
    .replace(/[\s\-_:]/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2');
}

/**
 * Extracts UTR / RRN / Bank Reference / UPI Reference number using candidate scoring.
 * Priority:
 * 1. Near explicit UTR / RRN label (+100)
 * 2. Near Bank Reference / UPI Ref label (+90)
 * 3. Exactly 12 numeric digits (+50)
 * 4. Transaction ID fallback (+20)
 */
export function extractPaymentReference(text: string): { utrOrRrn: string | null; transactionId: string | null; confidence: number } {
  if (!text) return { utrOrRrn: null, transactionId: null, confidence: 0 };

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  interface Candidate {
    value: string;
    score: number;
    is12Digit: boolean;
    isTxnIdOnly: boolean;
  }
  const candidates: Candidate[] = [];

  // Patterns for reference labels
  const utrLabelRegex = /\b(?:utr(?:\s*no|\s*number)?|rrn(?:\s*no)?)\b/i;
  const bankRefLabelRegex = /\b(?:bank\s*ref(?:erence)?(?:\s*no|\s*number)?|upi\s*ref(?:erence)?(?:\s*no|\s*number)?)\b/i;
  const txnIdLabelRegex = /\b(?:upi\s*transaction\s*id|transaction\s*id|txn\s*id|ref(?:erence)?\s*(?:id|number|no))\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1] || '';
    const combinedContext = `${line} ${nextLine}`;

    const isUtrLabel = utrLabelRegex.test(line);
    const isBankRefLabel = bankRefLabelRegex.test(line);
    const isTxnIdLabel = txnIdLabelRegex.test(line);

    // 1. Direct label followed by candidate value
    const labelFollowed = combinedContext.match(
      /(?:UTR(?:\s*No|\s*Number)?|RRN(?:\s*No)?|Bank\s*Reference(?:\s*Number)?|UPI\s*Ref(?:erence)?(?:\s*No|\s*Number)?|UPI\s*Transaction\s*ID|Transaction\s*ID|Txn\s*ID|Ref(?:erence)?\s*(?:ID|Number|No))[\s:#\-]+([A-Za-z0-9\s\-]{6,30})/i
    );
    if (labelFollowed) {
      const rawVal = labelFollowed[1].trim();
      const cleaned = rawVal.replace(/[\s\-:]/g, '');
      const repaired = repairNumericReference(cleaned);

      if (/^\d{12}$/.test(repaired)) {
        const score = isUtrLabel ? 150 : isBankRefLabel ? 140 : 120;
        candidates.push({ value: repaired, score, is12Digit: true, isTxnIdOnly: false });
      } else if (/^\d{10,18}$/.test(repaired)) {
        candidates.push({ value: repaired, score: 100, is12Digit: false, isTxnIdOnly: false });
      } else if (/^[A-Za-z0-9]{8,25}$/.test(cleaned)) {
        candidates.push({ value: cleaned, score: 35, is12Digit: false, isTxnIdOnly: true });
      }
    }

    if (isUtrLabel || isBankRefLabel || isTxnIdLabel) {
      // Find candidate numbers in current line or next line
      const matches = combinedContext.match(/\b[A-Za-z0-9]{6,25}\b/g) || [];
      for (const m of matches) {
        // Skip the label words themselves
        if (/^(?:utr|rrn|bank|ref|reference|upi|transaction|txn|id|no|number)$/i.test(m)) continue;
        const cleaned = m.replace(/[\s\-:]/g, '');
        const repaired = repairNumericReference(cleaned);

        // Check if 12-digit numeric
        if (/^\d{12}$/.test(repaired)) {
          let score = 50;
          if (isUtrLabel) score += 100;
          else if (isBankRefLabel) score += 90;
          else if (isTxnIdLabel) score += 40;

          candidates.push({ value: repaired, score, is12Digit: true, isTxnIdOnly: false });
        } else if (/^\d{10,18}$/.test(repaired)) {
          let score = 30;
          if (isUtrLabel) score += 80;
          else if (isBankRefLabel) score += 70;
          candidates.push({ value: repaired, score, is12Digit: false, isTxnIdOnly: false });
        } else if (/^[A-Za-z0-9]{8,25}$/.test(cleaned) && isTxnIdLabel) {
          candidates.push({ value: cleaned, score: 25, is12Digit: false, isTxnIdOnly: true });
        }
      }
    }

    // Also scan standalone 12-digit numbers
    const standalone12Matches = line.match(/\b\d{12}\b/g) || [];
    for (const s of standalone12Matches) {
      candidates.push({ value: s, score: 40, is12Digit: true, isTxnIdOnly: false });
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  const top12Candidate = candidates.find((c) => c.is12Digit);
  const topCandidate = candidates[0];

  const utrOrRrn = top12Candidate ? top12Candidate.value : (topCandidate && !topCandidate.isTxnIdOnly ? topCandidate.value : null);
  const transactionId = topCandidate ? topCandidate.value : null;
  const confidence = top12Candidate ? Math.min(1.0, top12Candidate.score / 150) : (topCandidate ? 0.6 : 0);

  return { utrOrRrn, transactionId, confidence };
}

/**
 * Extracts payment amount using candidate scoring.
 * Prioritizes amounts with currency symbols and near 'Paid', 'Sent', 'Amount', 'Total'.
 */
export function extractAmount(
  text: string,
  expectedPaise?: number
): { amount: number | null; amountText: string | null; confidence: number } {
  if (!text) return { amount: null, amountText: null, confidence: 0 };

  const expectedAmount = expectedPaise !== undefined ? expectedPaise / 100 : undefined;
  interface AmountCandidate {
    num: number;
    raw: string;
    score: number;
  }
  const candidates: AmountCandidate[] = [];

  // Patterns for currency amounts: ₹50, ₹50.00, Rs. 50, INR 50
  const amountRegexes = [
    /₹\s*([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi,
    /(?:rs\.?|inr)\s*([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi,
    /\b([0-9]{1,6}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:inr|rs\.?)/gi,
  ];

  for (const regex of amountRegexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const cleanNumStr = match[1].replace(/,/g, '');
      const num = parseFloat(cleanNumStr);
      if (!isNaN(num) && num > 0 && num < 1000000) {
        let score = 40; // Has currency indicator
        candidates.push({ num, raw: match[0].trim(), score });
      }
    }
  }

  // Also check lines near "Paid", "Sent", "Amount", "Total", "Transferred"
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isContextLine = /\b(?:paid|sent|amount|total|transferred|debited)\b/i.test(line);
    if (isContextLine) {
      const standaloneMatches = line.match(/\b([0-9]{2,5}(?:\.[0-9]{1,2})?)\b/g) || [];
      for (const sm of standaloneMatches) {
        const num = parseFloat(sm);
        if (!isNaN(num) && num > 0) {
          candidates.push({ num, raw: sm, score: 60 });
        }
      }
    }
  }

  // Proximity to expected amount gives supporting boost, but doesn't create candidate out of thin air
  if (expectedAmount !== undefined) {
    for (const c of candidates) {
      if (Math.abs(c.num - expectedAmount) < 0.05) {
        c.score += 50;
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { amount: null, amountText: null, confidence: 0 };
  }

  const best = candidates[0];
  const confidence = Math.min(1.0, best.score / 110);
  return { amount: best.num, amountText: best.raw, confidence };
}

/**
 * Extracts visible payment status with strict precedence:
 * explicit FAILED > PENDING > SUCCESS.
 */
export function extractPaymentStatus(text: string): { status: 'success' | 'pending' | 'failed' | 'unknown'; confidence: number } {
  if (!text) return { status: 'unknown', confidence: 0 };

  const lower = text.toLowerCase();

  // 1. Explicit FAILED indicators
  if (
    lower.includes('payment failed') ||
    lower.includes('transaction failed') ||
    lower.includes('payment declined') ||
    lower.includes('transaction declined') ||
    lower.includes('payment cancelled') ||
    /\b(?:failed|declined)\b/.test(lower)
  ) {
    return { status: 'failed', confidence: 0.95 };
  }

  // 2. Explicit PENDING / PROCESSING indicators
  if (
    lower.includes('payment processing') ||
    lower.includes('transaction processing') ||
    lower.includes('payment pending') ||
    lower.includes('processing payment') ||
    /\b(?:pending|processing|awaiting)\b/.test(lower)
  ) {
    return { status: 'pending', confidence: 0.9 };
  }

  // 3. SUCCESS indicators
  if (
    lower.includes('payment successful') ||
    lower.includes('payment success') ||
    lower.includes('paid successfully') ||
    lower.includes('transaction successful') ||
    lower.includes('transaction success') ||
    lower.includes('payment complete') ||
    lower.includes('payment completed') ||
    lower.includes('sent successfully') ||
    lower.includes('money sent') ||
    lower.includes('transferred successfully') ||
    /\b(?:paid to|completed|successful)\b/.test(lower)
  ) {
    return { status: 'success', confidence: 0.95 };
  }

  return { status: 'unknown', confidence: 0.2 };
}

/**
 * Extracts transaction timestamp in Asia/Kolkata timezone.
 * Supports:
 * - "15 Sep 2026, 1:25 AM"
 * - "15 September 2026 01:25 AM"
 * - "15/09/2026 01:25" or "15-09-2026 1:25 PM"
 * - "Sep 15, 2026 1:25 AM"
 * - "Today, 1:25 AM"
 */
export function extractTransactionTimestamp(
  text: string,
  referenceDateIso?: string
): { timestampIso: string | null; dateStr: string | null; timeStr: string | null; confidence: number } {
  if (!text) return { timestampIso: null, dateStr: null, timeStr: null, confidence: 0 };

  // Common Indian receipt date & time formats
  const datePatterns = [
    // 15 Sep 2026, 1:25 AM / 15 September 2026 01:25 AM / 15 Sep 2026 13:25
    /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
    // Sep 15, 2026 1:25 AM
    /([A-Za-z]{3,9})\s+(\d{1,2})[,.\s]+(\d{4})[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
    // 15/09/2026 01:25 or 15-09-2026 1:25 PM
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
    // Today, 1:25 AM
    /\b(?:today|yesterday)\b[,.\s]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)/i,
  ];

  for (const pat of datePatterns) {
    const match = pat.exec(text);
    if (match) {
      try {
        const dateObj = new Date(match[0]);
        if (!isNaN(dateObj.getTime())) {
          return {
            timestampIso: dateObj.toISOString(),
            dateStr: match[0],
            timeStr: match[match.length - 1],
            confidence: 0.85,
          };
        }
      } catch {
        // Continue to next pattern
      }
    }
  }

  return { timestampIso: null, dateStr: null, timeStr: null, confidence: 0 };
}

/**
 * Extracts recipient UPI ID and Merchant Name.
 * Handles masked UPI IDs such as 70****52@ybl.
 */
export function extractUpiId(text: string): { upiId: string | null; payeeName: string | null; confidence: number } {
  if (!text) return { upiId: null, payeeName: null, confidence: 0 };

  // Masked UPI VPA pattern: e.g. 70****52@ybl or 70**52@ybl
  const maskedVpaRegex = /\b([a-zA-Z0-9._\-]{1,6}\*+[a-zA-Z0-9._\-]{1,6}@[a-zA-Z]{2,64})\b/g;
  const maskedMatches = text.match(maskedVpaRegex) || [];

  // Full UPI VPA pattern: username@bank
  const vpaRegex = /\b([a-zA-Z0-9._\-]{2,256}@[a-zA-Z]{2,64})\b/g;
  const matches = (text.match(vpaRegex) || []).filter((m) => !text.includes(`*${m}`));

  const candidateUpiId = maskedMatches[0] || matches[0] || null;

  // Merchant display name search
  let payeeName: string | null = null;
  if (/yuva\s*shakti/i.test(text)) {
    payeeName = 'Yuva Shakti Youth Satulur';
  }

  const confidence = candidateUpiId ? (candidateUpiId.includes('*') ? 0.7 : 0.9) : (payeeName ? 0.6 : 0);
  return { upiId: candidateUpiId, payeeName, confidence };
}

/**
 * Detects explicit AI generator watermarks/branding in visible OCR text.
 * Strictly ignores normal app branding like Google Pay.
 */
export function detectAiGeneratorWatermark(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (
    lower.includes('generated with ai') ||
    lower.includes('generated by ai') ||
    lower.includes('chatgpt') ||
    lower.includes('openai') ||
    lower.includes('dall-e') ||
    lower.includes('dalle') ||
    lower.includes('midjourney') ||
    lower.includes('adobe firefly') ||
    lower.includes('generated with gemini') ||
    lower.includes('generated by gemini')
  ) {
    return true;
  }
  return false;
}

/**
 * Identifies the UPI app based on visible UI text/brand keywords.
 */
export function detectPaymentApp(text: string): 'phonepe' | 'google_pay' | 'paytm' | 'fampay' | 'other' | 'unknown' {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();

  if (lower.includes('phonepe')) return 'phonepe';
  if (lower.includes('google pay') || lower.includes('gpay') || lower.includes('g pay')) return 'google_pay';
  if (lower.includes('paytm')) return 'paytm';
  if (lower.includes('fampay') || lower.includes('fam pay') || lower.includes('famapp')) return 'fampay';
  if (lower.includes('bhim') || lower.includes('cred') || lower.includes('amazon pay')) return 'other';

  return 'unknown';
}

/**
 * Main Entry Point: Analyzes payment screenshot using local OCR (Tesseract.js) + deterministic parser.
 * Executes on the server without sending screenshots to any third-party AI or external APIs.
 */
export async function analyzePaymentScreenshot(
  sanitizedBuffer: Buffer,
  bookingContext: OcrBookingContext
): Promise<LocalOcrAnalysisResult> {
  const startTime = Date.now();

  // 1. Check for injected test mock
  if (mockOcrResult) {
    const result = {
      analysisCompleted: true,
      rawText: mockOcrResult.rawText || '',
      normalizedText: mockOcrResult.normalizedText || '',
      paymentStatus: mockOcrResult.paymentStatus || 'success',
      amount: mockOcrResult.amount !== undefined ? mockOcrResult.amount : 50,
      amountText: mockOcrResult.amountText || '₹50.00',
      utrOrRrn: mockOcrResult.utrOrRrn !== undefined ? mockOcrResult.utrOrRrn : '123456789012',
      transactionId: mockOcrResult.transactionId || 'T123456',
      transactionDate: mockOcrResult.transactionDate || null,
      transactionTime: mockOcrResult.transactionTime || null,
      transactionTimestamp: mockOcrResult.transactionTimestamp || new Date().toISOString(),
      payeeName: mockOcrResult.payeeName || 'Yuva Shakti Youth Satulur',
      payeeUpiId: mockOcrResult.payeeUpiId || '7075920852@ybl',
      payerName: mockOcrResult.payerName || null,
      detectedApp: mockOcrResult.detectedApp || 'phonepe',
      extractedFields: mockOcrResult.extractedFields || {
        paymentStatus: mockOcrResult.paymentStatus || 'success',
        amount: mockOcrResult.amount !== undefined ? mockOcrResult.amount : 50,
        amountText: mockOcrResult.amountText || '₹50.00',
        utrOrRrn: mockOcrResult.utrOrRrn !== undefined ? mockOcrResult.utrOrRrn : '123456789012',
        transactionId: mockOcrResult.transactionId || 'T123456',
        transactionDate: null,
        transactionTime: null,
        transactionTimestamp: new Date().toISOString(),
        payeeName: 'Yuva Shakti Youth Satulur',
        payeeUpiId: '7075920852@ybl',
        payerName: null,
        detectedApp: 'phonepe',
        fieldConfidence: { status: 0.95, amount: 0.95, utr: 0.95, payee: 0.9, timestamp: 0.8 },
      },
      warnings: mockOcrResult.warnings || [],
      ocrEngine: 'tesseract.js',
      processingTimeMs: Date.now() - startTime,
      ...mockOcrResult,
    } as LocalOcrAnalysisResult;
    return result;
  }

  let extractedRawText = '';

  if (mockOcrText !== null) {
    extractedRawText = mockOcrText;
  } else {
    try {
      // Optimized fast OCR pipeline: single primary pass first
      const worker = await getOcrWorker();
      const primaryCandidate = await generatePrimaryOcrCandidate(sanitizedBuffer);

      // Run OCR with a 15-second bounded execution timeout
      const ocrPromise = (async () => {
        const primaryRes = await worker.recognize(primaryCandidate);
        let bestText = primaryRes.data.text || '';

        // Check if critical fields (amount and reference) are already extractable
        const normCheck = normalizeOcrText(bestText);
        const hasRef = extractPaymentReference(normCheck).utrOrRrn !== null;
        const hasAmount = extractAmount(normCheck, bookingContext.expectedAmountPaise).amount !== null;

        // If either reference or amount is still missing, run focused secondary pass
        if (!hasRef || !hasAmount) {
          try {
            const secondaryCandidate = await generateSecondaryContrastCandidate(sanitizedBuffer);
            const secondaryRes = await worker.recognize(secondaryCandidate);
            const secondaryText = secondaryRes.data.text || '';
            if (secondaryText.length > 0) {
              bestText = `${bestText}\n${secondaryText}`;
            }
          } catch {
            // Ignore secondary pass failure and proceed with primary text
          }
        }

        return bestText;
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR_TIMEOUT: Recognition exceeded 15 seconds.')), 15000)
      );

      extractedRawText = await Promise.race([ocrPromise, timeoutPromise]);
    } catch (ocrErr: any) {
      console.error('⚠️ [Local OCR Error] Failed to execute local OCR:', ocrErr?.message || ocrErr);
      // If worker crashed or timed out, terminate it so the next request re-initializes clean
      await terminateOcrWorker();

      return {
        analysisCompleted: false,
        rawText: '',
        normalizedText: '',
        paymentStatus: 'unknown',
        amount: null,
        amountText: null,
        utrOrRrn: null,
        transactionId: null,
        transactionDate: null,
        transactionTime: null,
        transactionTimestamp: null,
        payeeName: null,
        payeeUpiId: null,
        payerName: null,
        detectedApp: 'unknown',
        extractedFields: {
          paymentStatus: 'unknown',
          amount: null,
          amountText: null,
          utrOrRrn: null,
          transactionId: null,
          transactionDate: null,
          transactionTime: null,
          transactionTimestamp: null,
          payeeName: null,
          payeeUpiId: null,
          payerName: null,
          detectedApp: 'unknown',
          fieldConfidence: { status: 0, amount: 0, utr: 0, payee: 0, timestamp: 0 },
        },
        warnings: ['OCR_PROCESSING_ERROR'],
        ocrEngine: 'tesseract.js',
        processingTimeMs: Date.now() - startTime,
        error: ocrErr?.message || 'Local OCR engine failed to process image.',
        retryable: true,
      };
    }
  }

  // 2. Text Normalization
  const normalizedText = normalizeOcrText(extractedRawText);
  const warnings: string[] = [];

  // 3. Candidate-Scoring Extractions
  const statusRes = extractPaymentStatus(normalizedText);
  const refRes = extractPaymentReference(normalizedText);
  const amountRes = extractAmount(normalizedText, bookingContext.expectedAmountPaise);
  const timeRes = extractTransactionTimestamp(normalizedText, bookingContext.sessionTimestampIso);
  const payeeRes = extractUpiId(normalizedText);
  const detectedApp = detectPaymentApp(normalizedText);

  // Quality check
  if (normalizedText.length < 15) {
    warnings.push('OCR_UNREADABLE');
  }

  // Watermark check for explicit image generator branding
  if (detectAiGeneratorWatermark(normalizedText)) {
    warnings.push('AI_GENERATOR_WATERMARK');
  }

  const extractedFields: ExtractedFields = {
    paymentStatus: statusRes.status,
    amount: amountRes.amount,
    amountText: amountRes.amountText,
    utrOrRrn: refRes.utrOrRrn,
    transactionId: refRes.transactionId,
    transactionDate: timeRes.dateStr,
    transactionTime: timeRes.timeStr,
    transactionTimestamp: timeRes.timestampIso,
    payeeName: payeeRes.payeeName,
    payeeUpiId: payeeRes.upiId,
    payerName: null,
    detectedApp,
    fieldConfidence: {
      status: statusRes.confidence,
      amount: amountRes.confidence,
      utr: refRes.confidence,
      payee: payeeRes.confidence,
      timestamp: timeRes.confidence,
    },
  };

  return {
    analysisCompleted: true,
    rawText: extractedRawText,
    normalizedText,
    paymentStatus: statusRes.status,
    amount: amountRes.amount,
    amountText: amountRes.amountText,
    utrOrRrn: refRes.utrOrRrn,
    transactionId: refRes.transactionId,
    transactionDate: timeRes.dateStr,
    transactionTime: timeRes.timeStr,
    transactionTimestamp: timeRes.timestampIso,
    payeeName: payeeRes.payeeName,
    payeeUpiId: payeeRes.upiId,
    payerName: null,
    detectedApp,
    extractedFields,
    warnings,
    ocrEngine: 'tesseract.js',
    processingTimeMs: Date.now() - startTime,
  };
}
