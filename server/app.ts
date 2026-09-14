import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { config, getPublicConfig, canAcceptPayments } from './config/eventConfig.ts';
import { db, isDatabaseConnected } from './db/client.ts';
import { generateUpiPaymentSession } from './upi/upiUri.ts';
import { processPaymentScreenshot, hammingDistance, checkStorageHealth, downloadPaymentScreenshot } from './upi/imageProcessor.ts';
import { analyzePaymentScreenshot } from './upi/localOcrAnalyzer.ts';
import { performDeterministicComparison, normalizeUtr } from './upi/deterministicMatcher.ts';
import { verifyPaymentReceipt, normalizeTransactionReference } from './upi/deterministicReceiptVerifier.ts';
import { finalizeVerifiedSubmission } from './upi/automatedFinalizer.ts';
import { encryptSensitiveField } from './utils/crypto.ts';
import { getAdminSession } from './admin/auth.ts';
import { confirmPaymentFromBankRecord } from './upi/adminReconciliation.ts';
import { allocateCouponsForBooking } from './services/couponAllocator.ts';
import {
  renderTicketPdf,
  renderMultiTicketPdf,
  renderTicketRaster,
  createTicketsZipArchive,
  maskPhoneNumber,
  formatKolkataTime,
} from './services/ticketRenderer.ts';
import adminRoutes from './admin/routes.ts';

const app = express();

// 1. Security Headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Defensive proxy rewrite normalization (if /api prefix was stripped by hosting provider for API endpoints)
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.url && !req.url.startsWith('/api') && !req.url.startsWith('/assets') && !req.url.includes('.')) {
    // Check if path matches backend-only endpoints that inadvertently lost their /api prefix
    if (
      req.url.startsWith('/bookings') ||
      req.url.startsWith('/coupons') ||
      req.url.startsWith('/health') ||
      req.url.startsWith('/config') ||
      req.url.startsWith('/events')
    ) {
      req.url = '/api' + req.url;
    }
  }
  next();
});

// Helper to normalize 10-digit Indian Mobile
function normalizeIndianPhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return null;
}

// Helpers for collision-safe ID generation
function generateCollisionSafePublicId(): string {
  // BK- followed by 6 cryptographically random uppercase hex characters (16.7M combinations per instant)
  return `BK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function generateCollisionSafePaymentReference(): string {
  // YSYS- followed by 8 cryptographically secure uppercase hex characters (4.29B combinations)
  return `YSYS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// 2. Health & Diagnostic Check (Requirement 12: Safe Storage & DB Health Diagnostic)
app.get(['/api/health', '/health'], async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const [dbStatus, storageStatus] = await Promise.all([
      isDatabaseConnected(),
      checkStorageHealth(),
    ]);

    const isHealthy = dbStatus.connected && storageStatus.ready;

    return res.status(200).json({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'yuva-shakti-portal',
      timestamp: new Date().toISOString(),
      database: dbStatus.provider,
      databaseConnected: dbStatus.connected,
      databaseHost: dbStatus.hostMasked,
      paymentProofStorageConfigured: storageStatus.configured && storageStatus.ready,
      storage: {
        provider: storageStatus.provider,
        configured: storageStatus.configured,
        bucket: storageStatus.bucket,
        ready: storageStatus.ready,
        ...(storageStatus.error ? { warning: storageStatus.error } : {}),
      },
      ocr: {
        engine: 'tesseract.js',
        status: 'ready',
      },
      ...(dbStatus.error ? { warning: 'Database connection check reported an issue' } : {}),
    });
  } catch (err: any) {
    console.error('[Health Diagnostic Check Error]:', {
      name: err?.name,
      message: err?.message,
    });
    return res.status(200).json({
      status: 'degraded',
      service: 'yuva-shakti-portal',
      timestamp: new Date().toISOString(),
      database: 'postgresql',
      databaseConnected: false,
      storage: {
        provider: 'supabase',
        configured: false,
        bucket: config.PAYMENT_PROOF_BUCKET,
        ready: false,
      },
      ocr: {
        engine: 'tesseract.js',
        status: 'ready',
      },
    });
  }
});

// Root API handler
app.get(['/api', '/api/'], (_req: Request, res: Response) => {
  res.redirect('/api/health');
});

app.get('/api/config', (_req: Request, res: Response) => {
  const pub = getPublicConfig();
  res.json({
    success: true,
    data: pub,
    ...pub,
  });
});

// 3. Mount Admin Routes
app.use('/api/admin', adminRoutes);

// 4. Create Public Booking & Direct UPI Session
app.post('/api/bookings', async (req: Request, res: Response) => {
  try {
    const gate = canAcceptPayments();
    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        error: { code: 'BOOKING_UNAVAILABLE', message: gate.reason },
      });
    }

    const { name, phone, village, quantity, selectedApp } = req.body;

    // Validate inputs
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_NAME', message: 'Please enter a valid participant name (2-80 characters).' },
      });
    }

    const normalizedPhone = normalizeIndianPhone(String(phone || ''));
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PHONE', message: 'Please enter a valid 10-digit Indian mobile number.' },
      });
    }

    const qty = parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0 || qty > config.EVENT_MAX_COUPONS_PER_BOOKING) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUANTITY',
          message: `Quantity must be between 1 and ${config.EVENT_MAX_COUPONS_PER_BOOKING} coupons per order.`,
        },
      });
    }

    const cleanVillage = (village && typeof village === 'string' ? village.trim() : 'Satulur') || 'Satulur';

    // Authoritative Server-side Price Calculation (₹50 / coupon)
    const unitPricePaise = config.EVENT_COUPON_PRICE_PAISE; // 5000 paise = ₹50.00
    const totalAmountPaise = unitPricePaise * qty;

    let publicId = generateCollisionSafePublicId();
    let paymentReference = generateCollisionSafePaymentReference();
    const bookingId = crypto.randomUUID();

    // Secure tokens
    const statusToken = crypto.randomBytes(24).toString('hex');
    const statusTokenHash = crypto.createHash('sha256').update(statusToken).digest('hex');

    const downloadToken = crypto.randomBytes(24).toString('hex');
    const downloadTokenHash = crypto.createHash('sha256').update(downloadToken).digest('hex');

    // Generate canonical NPCI UPI Session & QR
    let upiSession = await generateUpiPaymentSession({
      publicBookingId: publicId,
      transactionReference: paymentReference,
      totalAmountPaise,
      participantName: name.trim(),
    });

    // Persist booking in PostgreSQL with collision retry safety
    let inserted = false;
    let attempts = 0;
    while (!inserted && attempts < 3) {
      attempts++;
      try {
        await db.query(
          `INSERT INTO bookings (
            id, public_id, participant_name, phone, village, quantity,
            unit_price_paise, total_amount_paise, status, provider_name,
            download_token_hash, status_token_hash, selected_upi_app, payment_reference, payment_expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            bookingId,
            publicId,
            name.trim(),
            normalizedPhone,
            cleanVillage,
            qty,
            unitPricePaise,
            totalAmountPaise,
            'payment_initiated',
            'direct_upi',
            downloadTokenHash,
            statusTokenHash,
            selectedApp || 'other_upi',
            paymentReference,
            upiSession.expiresAt,
          ]
        );
        inserted = true;
      } catch (insertError: any) {
        if (insertError?.code === '23505' && attempts < 3) {
          console.warn(`[POST /api/bookings] Unique key collision on public_id/reference (attempt ${attempts}), regenerating IDs...`);
          publicId = generateCollisionSafePublicId();
          paymentReference = generateCollisionSafePaymentReference();
          upiSession = await generateUpiPaymentSession({
            publicBookingId: publicId,
            transactionReference: paymentReference,
            totalAmountPaise,
            participantName: name.trim(),
          });
        } else {
          throw insertError;
        }
      }
    }

    return res.json({
      success: true,
      data: {
        booking: {
          id: bookingId,
          publicId,
          name: name.trim(),
          phone: normalizedPhone,
          village: cleanVillage,
          quantity: qty,
          totalAmount: totalAmountPaise / 100,
          status: 'payment_initiated',
          expiresAt: upiSession.expiresAt,
        },
        payment: {
          clientTxnId: paymentReference,
          orderId: paymentReference,
          qrDataUrl: upiSession.qrDataUrl,
          canonicalUri: upiSession.canonicalUri,
          payeeUpiId: upiSession.maskedPayeeUpiId,
          rawPayeeUpiId: upiSession.payeeUpiId,
          payeeDisplayName: upiSession.payeeDisplayName,
          amountInr: upiSession.amountInr,
          totalAmount: totalAmountPaise / 100,
          expiresAt: upiSession.expiresAt,
          statusToken,
          downloadToken,
          appIntents: upiSession.appIntents,
        },
      },
    });
  } catch (error: any) {
    const errorDetails = {
      route: 'POST /api/bookings',
      name: error?.name || 'Error',
      code: error?.code || 'UNKNOWN',
      pgCode: error?.code || error?.routine || 'NONE',
      constraint: error?.constraint || error?.detail || 'NONE',
      safeMessage: error?.message ? String(error.message).replace(/postgres:[^@]+@/g, 'postgres:***@') : 'Booking creation error',
    };
    console.error('[POST /api/bookings] Booking creation failure:', errorDetails);

    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_CREATION_FAILED',
        message: 'Booking service is temporarily unavailable. Please try again.',
      },
    });
  }
});

// 5. Submit Mandatory Payment Proof (Screenshot + Consent, Automated OCR Reference Extraction)
app.post('/api/bookings/:publicId/payment-proof', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const { screenshotBase64, utr, transactionReference, selectedApp, consentGiven, originalFilename, originalMimeType } = req.body;

    // 0. Secure Token Authentication
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ((req.headers['x-booking-token'] as string) || (req.body.statusToken as string) || (req.query.token as string));

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Valid booking access token is required.' },
      });
    }

    // 1. Find Booking
    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }

    const booking = bookingRes.rows[0];

    // Validate access token hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (booking.status_token_hash && booking.status_token_hash !== tokenHash) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid booking access token.' },
      });
    }

    // 1b. Idempotency: Return immediately if already confirmed
    if (booking.status === 'payment_confirmed' || booking.status === 'proof_verified') {
      const existingCoupons = await db.query(
        'SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      return res.json({
        success: true,
        data: {
          status: 'payment_confirmed',
          message: 'Payment proof accepted',
          coupons: existingCoupons.rows,
          couponsIssuedCount: existingCoupons.rows.length,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
        },
      });
    }

    // 2. Server-Enforced Expiry Check with Safe Recovery Rule (Requirement 10)
    const expiresAtMs = booking.payment_expires_at ? new Date(booking.payment_expires_at).getTime() : 0;
    const isPastExpiry = booking.status === 'expired' || (expiresAtMs > 0 && Date.now() > expiresAtMs);

    if (isPastExpiry) {
      // Check if coupons have already been issued for this booking
      const couponCheck = await db.query('SELECT COUNT(*) as count FROM coupons WHERE booking_id = $1', [booking.id]);
      const hasCoupons = parseInt(couponCheck.rows[0]?.count || '0', 10) > 0;

      // Check if any verified payment proof already exists
      const proofCheck = await db.query(
        "SELECT id FROM payment_submissions WHERE booking_id = $1 AND (status = 'payment_confirmed' OR status = 'proof_verified') LIMIT 1",
        [booking.id]
      );
      const hasVerifiedProof = proofCheck.rows.length > 0;

      // Check for prior submission attempt around/before expiry
      const priorAttemptCheck = await db.query(
        'SELECT id FROM payment_submissions WHERE booking_id = $1 LIMIT 1',
        [booking.id]
      );
      const hasPriorSubmissionAttempt = priorAttemptCheck.rows.length > 0;
      const isRecoveryFlag = req.body.isRecovery === true || req.headers['x-payment-recovery'] === 'true';

      const createdAtMs = new Date(booking.created_at || Date.now()).getTime();
      const paymentInitiatedBeforeExpiry = booking.payment_expires_at ? (createdAtMs <= expiresAtMs) : true;
      const isWithinRecoveryWindow = (Date.now() - createdAtMs) < 24 * 60 * 60 * 1000;

      // Safe recovery rule (Requirement 10):
      // - booking exists
      // - payment was initiated before expiry
      // - proof submission attempt occurred before/around expiry (prior submission OR explicit recovery flag)
      // - no coupon has been issued
      // - no successful payment proof exists
      const isEligibleForRecovery =
        paymentInitiatedBeforeExpiry &&
        (hasPriorSubmissionAttempt || isRecoveryFlag || booking.status === 'ai_check_failed' || booking.status === 'proof_required') &&
        !hasCoupons &&
        !hasVerifiedProof &&
        booking.status !== 'cancelled' &&
        isWithinRecoveryWindow;

      if (isEligibleForRecovery) {
        console.warn(`[POST /api/bookings/:publicId/payment-proof] Processing safe proof recovery for booking ${booking.public_id} (session expired, but unfinalized and within recovery window).`);
      } else {
        if (booking.status !== 'expired') {
          await db.query('UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3', ['expired', new Date().toISOString(), booking.id]);
        }
        return res.status(400).json({
          success: false,
          error: { code: 'PAYMENT_SESSION_EXPIRED', message: 'Payment session expired. Start a new booking.' },
        });
      }
    }

    // 3. Validate Consent
    if (!consentGiven) {
      return res.status(400).json({
        success: false,
        error: { code: 'CONSENT_REQUIRED', message: 'You must consent to automated image analysis.' },
      });
    }

    // 4. Validate Screenshot Presence
    if (!screenshotBase64 || typeof screenshotBase64 !== 'string' || !screenshotBase64.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_SCREENSHOT', message: 'Payment confirmation screenshot is mandatory.' },
      });
    }

    // 6. Clean & Decode Screenshot Buffer
    const cleanBase64 = screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(cleanBase64, 'base64');

    // 7. Process Image: magic bytes, EXIF strip, dimension check, SHA-256, phash, save to private bucket/disk
    const processed = await processPaymentScreenshot(imageBuffer, booking.id, originalFilename, originalMimeType);

    // 8. Run Local Server-Side OCR & Candidate Extraction
    const analysis = await analyzePaymentScreenshot(
      processed.sanitizedBuffer,
      {
        expectedMerchantName: config.PAYEE_DISPLAY_NAME,
        expectedAmount: (booking.total_amount_paise / 100).toFixed(2),
        expectedAmountPaise: booking.total_amount_paise,
        sessionTimestampIso: booking.created_at || new Date().toISOString(),
        bookingCreatedAt: booking.created_at,
        paymentExpiresAt: booking.payment_expires_at,
      }
    );

    const submissionId = crypto.randomUUID();
    const paymentRef = booking.payment_reference || `YSYS-${Date.now().toString(36).toUpperCase()}`;

    // 8b. Handle Local OCR Processing Error / Crash: Keep non-final retryable state
    if (!analysis.analysisCompleted || analysis.warnings?.includes('OCR_PROCESSING_ERROR')) {
      const fallbackRef = `PENDING_OCR_${submissionId}`;
      const utrHash = crypto.createHash('sha256').update(fallbackRef).digest('hex');
      const encryptedUtr = encryptSensitiveField(fallbackRef);

      await db.query(
        `INSERT INTO payment_submissions (
          id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
          expected_payee_name, expected_amount_paise, payer_utr_hash, encrypted_utr,
          screenshot_storage_path, screenshot_sha256, screenshot_phash, mime_type,
          byte_size, width, height, status, ocr_extraction, deterministic_comparison,
          risk_score, reason_codes, ocr_engine
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
        [
          submissionId,
          booking.id,
          paymentRef,
          selectedApp || booking.selected_upi_app || 'other_upi',
          config.PAYEE_UPI_ID,
          config.PAYEE_DISPLAY_NAME,
          booking.total_amount_paise,
          utrHash,
          encryptedUtr,
          processed.storagePath,
          processed.sha256,
          processed.phash,
          processed.mimeType,
          processed.byteSize,
          processed.width,
          processed.height,
          'ocr_processing_error',
          JSON.stringify(analysis),
          null,
          0,
          ['OCR_PROCESSING_ERROR'],
          'tesseract.js',
        ]
      );

      const runId = crypto.randomUUID();
      await db.query(
        `INSERT INTO payment_verification_runs (
          id, submission_id, stage, status, confidence, reason_codes, result_json, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          runId,
          submissionId,
          'local_ocr',
          'pending_retry',
          0,
          ['OCR_PROCESSING_ERROR'],
          JSON.stringify({ analysis }),
          new Date().toISOString(),
        ]
      );

      // Keep booking in proof_submitted (non-final state)
      await db.query(
        'UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3',
        ['proof_submitted', new Date().toISOString(), booking.id]
      );

      return res.status(200).json({
        success: true,
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'ocr_processing_error',
          reviewStatus: 'ocr_processing_error',
          retryable: true,
          message: "We couldn't process this receipt right now. Your payment proof is saved. Please retry verification.",
          details: {
            referenceMatched: null,
            amountMatched: null,
            statusMatched: null,
            payeeMatched: null,
          },
        },
      });
    }

    // 9. Extract and normalize references
    const enteredUtrField = req.body.utr ?? req.body.transactionReference ?? req.body.enteredUtr;
    const rawEnteredRef = (enteredUtrField !== undefined ? enteredUtrField : (analysis.utrOrRrn || analysis.transactionId || '')).trim();
    const normalizedEnteredRef = normalizeTransactionReference(rawEnteredRef);
    const extractedRrn = analysis.utrOrRrn ? normalizeTransactionReference(analysis.utrOrRrn) : (analysis.transactionId ? normalizeTransactionReference(analysis.transactionId) : '');

    const enteredRefHash = normalizedEnteredRef ? crypto.createHash('sha256').update(normalizedEnteredRef).digest('hex') : null;
    const encryptedEnteredRef = normalizedEnteredRef ? encryptSensitiveField(normalizedEnteredRef) : null;

    const extractedRefHash = extractedRrn ? crypto.createHash('sha256').update(extractedRrn).digest('hex') : null;
    const encryptedExtractedRef = extractedRrn ? encryptSensitiveField(extractedRrn) : null;

    const fallbackUtr = `UNEXTRACTED_${submissionId}`;
    const payerUtrHash = extractedRefHash || enteredRefHash || crypto.createHash('sha256').update(fallbackUtr).digest('hex');
    const encryptedUtr = encryptedExtractedRef || encryptedEnteredRef || encryptSensitiveField(fallbackUtr);

    let isDuplicateUtr = false;
    if (enteredRefHash) {
      const dupEntered = await db.query(
        `SELECT id, booking_id FROM payment_submissions WHERE (entered_reference_hash = $1 OR extracted_reference_hash = $1 OR payer_utr_hash = $1) AND booking_id != $2 AND status != $3 AND status != $4`,
        [enteredRefHash, booking.id, 'admin_rejected', 'payment_rejected']
      );
      if (dupEntered.rows.length > 0) isDuplicateUtr = true;
    }
    if (!isDuplicateUtr && extractedRefHash) {
      const dupExtracted = await db.query(
        `SELECT id, booking_id FROM payment_submissions WHERE (extracted_reference_hash = $1 OR entered_reference_hash = $1 OR payer_utr_hash = $1) AND booking_id != $2 AND status != $3 AND status != $4`,
        [extractedRefHash, booking.id, 'admin_rejected', 'payment_rejected']
      );
      if (dupExtracted.rows.length > 0) isDuplicateUtr = true;
    }

    // 10. Check Duplicate Screenshot Hash
    const dupScreenRes = await db.query(
      'SELECT id, booking_id FROM payment_submissions WHERE screenshot_sha256 = $1 AND booking_id != $2 AND status != $3 AND status != $4',
      [processed.sha256, booking.id, 'admin_rejected', 'payment_rejected']
    );
    let isDuplicateScreenshot = dupScreenRes.rows.length > 0;

    // 10b. Perceptual dHash Duplicate Detection
    if (!isDuplicateScreenshot && processed.phash) {
      const pastSubs = await db.query(
        'SELECT id, booking_id, screenshot_phash, expected_amount_paise FROM payment_submissions WHERE booking_id != $1 AND screenshot_phash IS NOT NULL AND status != $2 AND status != $3',
        [booking.id, 'admin_rejected', 'payment_rejected']
      );
      for (const past of pastSubs.rows) {
        if (past.screenshot_phash) {
          const dist = hammingDistance(processed.phash, past.screenshot_phash);
          if (dist <= 2 && past.expected_amount_paise === booking.total_amount_paise) {
            isDuplicateScreenshot = true;
            break;
          }
        }
      }
    }

    // 11. Run Deterministic Receipt Verifier (Fail-Closed, Code-Only)
    const verification = verifyPaymentReceipt({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredReference: normalizedEnteredRef || undefined,
      selectedApp: selectedApp || booking.selected_upi_app || 'other_upi',
      bookingCreatedAt: booking.created_at,
      paymentExpiresAt: booking.payment_expires_at,
      ocrAnalysis: analysis,
      isDuplicateReference: isDuplicateUtr,
      isDuplicateScreenshot,
      isExpired: false,
      originalFilename: processed.originalFilename,
      isSuspiciousFilename: processed.isSuspiciousFilename,
      isValidScreenshotFormat: true,
    });

    // Also run legacy matcher for backwards compatibility
    const match = performDeterministicComparison({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredUtr: normalizedEnteredRef || extractedRrn,
      selectedApp: selectedApp || booking.selected_upi_app || 'other_upi',
      bookingCreatedAt: booking.created_at,
      paymentExpiresAt: booking.payment_expires_at,
      analysis,
      isDuplicateUtr,
      isDuplicateScreenshot,
      isExpired: false,
    });

    const isPassed = verification.verified && match.passed;
    const finalReasonCodes = Array.from(new Set([...verification.reasonCodes, ...match.reasonCodes]));
    const extractedPaise = analysis.amount != null ? Math.round(Number(analysis.amount) * 100) : null;

    // 12. Persist payment submission record with extended columns
    await db.query(
      `INSERT INTO payment_submissions (
        id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
        expected_payee_name, expected_amount_paise, payer_utr_hash, encrypted_utr,
        entered_reference_hash, encrypted_entered_reference,
        extracted_reference_hash, encrypted_extracted_reference,
        original_filename, screenshot_storage_path, screenshot_sha256, screenshot_phash,
        mime_type, byte_size, width, height, status, ocr_extraction, deterministic_comparison,
        verification_result, verification_reason_codes, extracted_amount_paise,
        extracted_status, extracted_payee_upi_id, extracted_transaction_timestamp,
        risk_score, reason_codes, ocr_engine, verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)`,
      [
        submissionId,
        booking.id,
        paymentRef,
        selectedApp || booking.selected_upi_app || 'other_upi',
        config.PAYEE_UPI_ID,
        config.PAYEE_DISPLAY_NAME,
        booking.total_amount_paise,
        payerUtrHash,
        encryptedUtr,
        enteredRefHash,
        encryptedEnteredRef,
        extractedRefHash,
        encryptedExtractedRef,
        processed.originalFilename || null,
        processed.storagePath,
        processed.sha256,
        processed.phash,
        processed.mimeType,
        processed.byteSize,
        processed.width,
        processed.height,
        isPassed ? 'payment_confirmed' : 'payment_rejected',
        JSON.stringify(analysis),
        JSON.stringify(match),
        JSON.stringify(verification),
        finalReasonCodes,
        extractedPaise,
        analysis.paymentStatus,
        analysis.payeeUpiId || null,
        analysis.transactionTimestamp || null,
        Math.max(verification.riskScore, match.riskScore),
        finalReasonCodes,
        'tesseract.js',
        isPassed ? new Date().toISOString() : null,
      ]
    );

    // 13. Record verification run
    const runId = crypto.randomUUID();
    await db.query(
      `INSERT INTO payment_verification_runs (
        id, submission_id, stage, status, confidence, reason_codes, result_json, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        submissionId,
        'local_ocr_and_deterministic',
        match.passed ? 'passed' : 'flagged',
        analysis.extractedFields?.fieldConfidence?.amount || 0.8,
        match.reasonCodes,
        JSON.stringify({ match, extractionSummary: { utr: analysis.utrOrRrn, amount: analysis.amount } }),
        new Date().toISOString(),
      ]
    );

    if (isPassed) {
      // 14. AUTOMATED FINALIZATION: Atomic transaction locks booking, allocates sequential coupons, and transitions to payment_confirmed
      const finalResult = await finalizeVerifiedSubmission({
        submissionId,
        bookingId: booking.id,
        decisionVersion: 'v3-local-ocr-deterministic',
      });

      return res.json({
        success: true,
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'payment_confirmed',
          reviewStatus: 'ocr_verified',
          message: verification.userMessage || 'Payment proof verified successfully. Coupons issued.',
          coupons: finalResult.coupons,
          couponsIssuedCount: finalResult.couponsIssuedCount,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
          details: {
            ...match.details,
            ...verification.details,
          },
        },
      });
    } else {
      // Step Fail-Closed: mark booking payment_rejected
      await db.query(
        'UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3',
        ['payment_rejected', new Date().toISOString(), booking.id]
      );

      const primaryCode = finalReasonCodes[0] || 'PROOF_VERIFICATION_FAILED';
      return res.status(400).json({
        success: false,
        error: {
          code: primaryCode,
          message: verification.userMessage || match.userMessage,
          reasonCodes: finalReasonCodes,
        },
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'payment_rejected',
          message: verification.userMessage || match.userMessage,
          details: {
            ...match.details,
            ...verification.details,
          },
        },
      });
    }
  } catch (error: any) {
    console.error('Payment proof submission error:', error);
    const isStorageErr = error?.message?.includes('STORAGE_NOT_CONFIGURED') || error?.message?.includes('PAYMENT_PROOF_STORAGE_FAILED');
    const errCode = error?.message?.includes('STORAGE_NOT_CONFIGURED')
      ? 'STORAGE_NOT_CONFIGURED'
      : (error?.message?.includes('PAYMENT_PROOF_STORAGE_FAILED') ? 'PAYMENT_PROOF_STORAGE_FAILED' : 'SUBMISSION_FAILED');
    const safeMsg = isStorageErr
      ? 'Payment proof storage is temporarily unavailable. Your booking is preserved. Please retry in a few moments.'
      : (error.message || 'Failed to process payment proof.');

    res.status(isStorageErr ? 503 : 500).json({
      success: false,
      error: { code: errCode, message: safeMsg },
    });
  }
});

// 5b. Retry Payment Proof Verification (Requirement 8: Idempotent Verification Retry Endpoint)
app.post('/api/bookings/:publicId/retry-verification', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ((req.body.statusToken as string) || (req.query.token as string));

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Valid status verification token is required.' },
      });
    }

    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }
    const booking = bookingRes.rows[0];

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (booking.status_token_hash && booking.status_token_hash !== tokenHash) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid verification token.' },
      });
    }

    // Idempotency: If already confirmed, return existing coupons immediately without duplicate issuance
    if (booking.status === 'payment_confirmed' || booking.status === 'proof_verified') {
      const existingCoupons = await db.query(
        'SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      return res.json({
        success: true,
        data: {
          publicId: booking.public_id,
          status: 'payment_confirmed',
          reviewStatus: 'ocr_verified',
          message: 'Payment proof already verified and confirmed.',
          coupons: existingCoupons.rows,
          couponsIssuedCount: existingCoupons.rows.length,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
        },
      });
    }

    // Retrieve the latest stored payment submission for this booking
    const subRes = await db.query(
      'SELECT * FROM payment_submissions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1',
      [booking.id]
    );

    if (subRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_PAYMENT_PROOF',
          message: 'No payment proof submission was found for this booking.',
        },
      });
    }

    const submission = subRes.rows[0];

    if (!submission.screenshot_storage_path) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_SCREENSHOT_STORED',
          message: 'Stored payment proof screenshot is missing. Please re-upload.',
        },
      });
    }

    // Download existing sanitized proof from private Supabase Storage
    const downloaded = await downloadPaymentScreenshot(submission.screenshot_storage_path);
    if (!downloaded || !downloaded.buffer) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'STORAGE_UNAVAILABLE',
          message: 'Unable to retrieve stored payment screenshot. Please retry in a few moments.',
        },
      });
    }

    // Run Local OCR
    const analysis = await analyzePaymentScreenshot(
      downloaded.buffer,
      {
        expectedMerchantName: config.PAYEE_DISPLAY_NAME,
        expectedAmount: (booking.total_amount_paise / 100).toFixed(2),
        expectedAmountPaise: booking.total_amount_paise,
        sessionTimestampIso: booking.created_at || new Date().toISOString(),
        bookingCreatedAt: booking.created_at,
        paymentExpiresAt: booking.payment_expires_at,
      }
    );

    if (!analysis.analysisCompleted || analysis.warnings?.includes('OCR_PROCESSING_ERROR')) {
      await db.query(
        'UPDATE payment_submissions SET status = $1, updated_at = $2 WHERE id = $3',
        ['ocr_processing_error', new Date().toISOString(), submission.id]
      );

      return res.json({
        success: true,
        data: {
          submissionId: submission.id,
          publicId: booking.public_id,
          status: 'ocr_processing_error',
          reviewStatus: 'ocr_processing_error',
          retryable: true,
          message: "We couldn't process this receipt right now. Your payment proof is saved. Please retry verification.",
          details: {
            utrMatched: null,
            amountMatched: null,
            statusMatched: null,
            payeeMatched: null,
          },
        },
      });
    }

    const extractedRrn = analysis.utrOrRrn ? normalizeUtr(analysis.utrOrRrn) : '';
    let isDuplicateUtr = false;
    let utrHash = submission.payer_utr_hash;
    let encryptedUtr = submission.encrypted_utr;

    if (extractedRrn) {
      utrHash = crypto.createHash('sha256').update(extractedRrn).digest('hex');
      const dupUtrRes = await db.query(
        'SELECT id, booking_id FROM payment_submissions WHERE payer_utr_hash = $1 AND booking_id != $2 AND status != $3 AND status != $4',
        [utrHash, booking.id, 'admin_rejected', 'payment_rejected']
      );
      isDuplicateUtr = dupUtrRes.rows.length > 0;
      encryptedUtr = encryptSensitiveField(extractedRrn);
    }

    // Run Deterministic Receipt Verifier
    const verification = verifyPaymentReceipt({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredReference: extractedRrn,
      selectedApp: submission.selected_upi_app || 'other_upi',
      bookingCreatedAt: booking.created_at,
      paymentExpiresAt: booking.payment_expires_at,
      ocrAnalysis: analysis,
      isDuplicateReference: isDuplicateUtr,
      isDuplicateScreenshot: false,
      isExpired: false,
      originalFilename: submission.original_filename,
      isValidScreenshotFormat: true,
    });

    const match = performDeterministicComparison({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredUtr: extractedRrn,
      selectedApp: submission.selected_upi_app || 'other_upi',
      bookingCreatedAt: booking.created_at,
      paymentExpiresAt: booking.payment_expires_at,
      analysis,
      isDuplicateUtr,
      isDuplicateScreenshot: false,
      isExpired: false,
    });

    const isPassed = verification.verified && match.passed;
    const finalReasonCodes = Array.from(new Set([...verification.reasonCodes, ...match.reasonCodes]));
    const extractedPaise = analysis.amount != null ? Math.round(Number(analysis.amount) * 100) : null;

    // Update existing submission with genuine OCR results and extended columns
    await db.query(
      `UPDATE payment_submissions SET
        payer_utr_hash = $1,
        encrypted_utr = $2,
        status = $3,
        ocr_extraction = $4,
        deterministic_comparison = $5,
        verification_result = $6,
        verification_reason_codes = $7,
        risk_score = $8,
        reason_codes = $9,
        ocr_engine = $10,
        extracted_amount_paise = $11,
        extracted_status = $12,
        extracted_transaction_timestamp = $13,
        verified_at = $14,
        updated_at = $15
      WHERE id = $16`,
      [
        utrHash,
        encryptedUtr,
        isPassed ? 'payment_confirmed' : 'payment_rejected',
        JSON.stringify(analysis),
        JSON.stringify(match),
        JSON.stringify(verification),
        finalReasonCodes,
        Math.max(verification.riskScore, match.riskScore),
        finalReasonCodes,
        'tesseract.js',
        extractedPaise,
        analysis.paymentStatus,
        analysis.transactionTimestamp || null,
        isPassed ? new Date().toISOString() : null,
        new Date().toISOString(),
        submission.id,
      ]
    );

    // Record verification run
    const runId = crypto.randomUUID();
    await db.query(
      `INSERT INTO payment_verification_runs (
        id, submission_id, stage, status, confidence, reason_codes, result_json, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        runId,
        submission.id,
        'retry_local_ocr_and_deterministic',
        match.passed ? 'passed' : 'flagged',
        analysis.extractedFields?.fieldConfidence?.amount || 0.8,
        match.reasonCodes,
        JSON.stringify({ match, extractionSummary: { utr: analysis.utrOrRrn, amount: analysis.amount } }),
        new Date().toISOString(),
      ]
    );

    if (match.passed) {
      // Atomic Finalization: Lock booking, issue sequential coupons, transition to payment_confirmed
      const finalResult = await finalizeVerifiedSubmission({
        submissionId: submission.id,
        bookingId: booking.id,
        decisionVersion: 'v3-local-ocr-deterministic-retry',
      });

      return res.json({
        success: true,
        data: {
          submissionId: submission.id,
          publicId: booking.public_id,
          status: 'payment_confirmed',
          reviewStatus: 'ocr_verified',
          message: 'Payment proof accepted. Coupons issued.',
          coupons: finalResult.coupons,
          couponsIssuedCount: finalResult.couponsIssuedCount,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
          details: match.details,
        },
      });
    } else {
      await db.query(
        'UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3',
        ['payment_rejected', new Date().toISOString(), booking.id]
      );

      return res.status(400).json({
        success: false,
        error: {
          code: match.reasonCodes[0] || 'PROOF_VERIFICATION_FAILED',
          message: match.userMessage,
          reasonCodes: match.reasonCodes,
        },
        data: {
          submissionId: submission.id,
          publicId: booking.public_id,
          status: match.nextStatus,
          message: match.userMessage,
          details: match.details,
        },
      });
    }
  } catch (error: any) {
    console.error('Retry verification error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'RETRY_FAILED', message: error.message || 'Failed to retry verification.' },
    });
  }
});

// 6. Booking Status Polling Endpoint (Secured by Access Token)
app.get('/api/bookings/:publicId/status', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ((req.query.token as string) || (req.query.statusToken as string) || (req.headers['x-booking-token'] as string));

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Valid booking access token is required.' },
      });
    }

    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }

    const booking = bookingRes.rows[0];

    // Verify token if present
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (booking.status_token_hash && booking.status_token_hash !== tokenHash) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid status token.' } });
    }

    // Check expiry: Do NOT expire bookings that already have payment proof submitted or are awaiting verification retry
    const isExpired = booking.status === 'expired' || (booking.payment_expires_at && new Date(booking.payment_expires_at).getTime() < Date.now());
    if (
      isExpired &&
      booking.status !== 'payment_confirmed' &&
      booking.status !== 'proof_verified' &&
      booking.status !== 'proof_submitted' &&
      booking.status !== 'ocr_checking' &&
      booking.status !== 'ocr_processing_error' &&
      booking.status !== 'ai_retry_pending'
    ) {
      if (booking.status !== 'expired') {
        await db.query('UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3', ['expired', new Date().toISOString(), booking.id]);
        booking.status = 'expired';
      }
    }

    // Retrieve latest payment submission to provide live retryable state to client
    const subRes = await db.query(
      'SELECT status, reason_codes FROM payment_submissions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1',
      [booking.id]
    );
    const latestSub = subRes.rows[0];

    let coupons: any[] = [];
    if (booking.status === 'payment_confirmed' || booking.status === 'proof_verified') {
      const cRes = await db.query(
        'SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      coupons = cRes.rows;
    }

    return res.json({
      success: true,
      data: {
        publicId: booking.public_id,
        status: booking.status,
        submissionStatus: latestSub?.status || null,
        reasonCodes: latestSub?.reason_codes || [],
        isRetryPending: latestSub?.status === 'ocr_processing_error' || latestSub?.status === 'ai_retry_pending',
        name: booking.participant_name,
        quantity: booking.quantity,
        totalAmount: booking.total_amount_paise / 100,
        paidAt: booking.paid_at ? formatKolkataTime(booking.paid_at) : null,
        isVerified: booking.status === 'payment_confirmed' || booking.status === 'proof_verified',
        isExpired: booking.status === 'expired',
        paymentExpiresAt: booking.payment_expires_at,
        coupons,
        downloadUrl:
          booking.status === 'payment_confirmed' || booking.status === 'proof_verified'
            ? `/api/bookings/${booking.public_id}/download-all?token=${token || ''}`
            : null,
      },
    });
  } catch (error: any) {
    console.error('Status check error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to retrieve booking status.' } });
  }
});

// 7. Verify Coupon by Number (Public verifier QR target)
app.get(['/api/coupons/:couponNumber/verify', '/api/coupons/verify', '/api/coupons/verify/:couponNumber'], async (req: Request, res: Response) => {
  try {
    const couponNumber = (req.params.couponNumber || (req.query.coupon as string) || (req.query.number as string) || '').trim().toUpperCase();

    if (!couponNumber) {
      return res.status(400).json({ success: false, error: { message: 'Coupon number is required.' } });
    }

    const cRes = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [couponNumber]);
    if (cRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        data: { isValid: false, message: 'Coupon not found in official registry.' },
      });
    }

    const coupon = cRes.rows[0];

    return res.json({
      success: true,
      data: {
        isValid: coupon.status === 'valid',
        couponNumber: coupon.coupon_number,
        participantName: coupon.holder_name,
        holderName: coupon.holder_name,
        maskedPhone: maskPhoneNumber(coupon.phone),
        village: coupon.village,
        ticketIndex: coupon.ticket_index,
        totalQuantity: coupon.total_quantity,
        issuedAt: formatKolkataTime(coupon.issued_at),
        status: coupon.status,
      },
    });
  } catch (error: any) {
    console.error('Coupon verification error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to verify coupon.' } });
  }
});

// 8. Single Coupon Download (PDF, PNG, JPEG)
app.get('/api/coupons/:couponNumber/download', async (req: Request, res: Response) => {
  try {
    const { couponNumber } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();

    if (!['pdf', 'png', 'jpeg', 'jpg'].includes(format)) {
      return res.status(400).send('Invalid format requested. Supported formats: pdf, png, jpeg.');
    }

    const cleanNumber = couponNumber.trim().toUpperCase();
    const couponRes = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [cleanNumber]);
    if (couponRes.rows.length === 0) {
      return res.status(404).send('Coupon not found.');
    }

    const coupon = couponRes.rows[0];
    const bookingRes = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);
    const booking = bookingRes.rows[0];

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ((req.query.token as string) || (req.headers['x-booking-token'] as string));
    const adminToken = req.cookies?.admin_session || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    const adminSession = adminToken ? getAdminSession(adminToken) : null;

    let isAuthorized = !!adminSession;
    if (!isAuthorized && token && booking) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      if (booking.download_token_hash === tokenHash || booking.status_token_hash === tokenHash) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(401).send('Unauthorized. Valid booking download token or admin session is required.');
    }

    const isVerified = (booking?.status === 'proof_verified' || booking?.status === 'payment_confirmed') && coupon.status === 'valid';
    if (!isVerified) {
      return res.status(403).send('Ticket cannot be downloaded until payment proof is verified.');
    }

    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || 'YSYS-DRAW',
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.verified_at || booking?.paid_at,
    };

    if (format === 'pdf') {
      const pdfBuffer = await renderTicketPdf(ticketData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${coupon.coupon_number}.pdf"`);
      return res.send(pdfBuffer);
    }

    const targetRaster = format === 'png' ? 'png' : 'jpeg';
    const rasterBuffer = await renderTicketRaster(ticketData, targetRaster);
    res.setHeader('Content-Type', targetRaster === 'png' ? 'image/png' : 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${coupon.coupon_number}.${targetRaster === 'png' ? 'png' : 'jpg'}"`);
    return res.send(rasterBuffer);
  } catch (error: any) {
    console.error('Download ticket error:', error);
    res.status(500).send('Failed to generate ticket.');
  }
});

// 9. Single Coupon Raster Image PNG
app.get('/api/coupons/:couponNumber/raster', async (req: Request, res: Response) => {
  try {
    const couponNumber = req.params.couponNumber.trim().toUpperCase();
    const cRes = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [couponNumber]);
    if (cRes.rows.length === 0) {
      return res.status(404).send('Coupon not found.');
    }

    const coupon = cRes.rows[0];
    const bRes = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);
    const booking = bRes.rows[0];

    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || 'YSYS-DRAW',
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.verified_at || booking?.paid_at,
    };

    const pngBuffer = await renderTicketRaster(ticketData, 'png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${coupon.coupon_number}.png"`);
    res.send(pngBuffer);
  } catch (error: any) {
    console.error('Raster render error:', error);
    res.status(500).send('Failed to render coupon PNG.');
  }
});

// 10. Download All Tickets in Booking (Single combined PDF or ZIP package)
app.get('/api/bookings/:publicId/download-all', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : ((req.headers['x-booking-token'] as string) || (req.query.token as string));

    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).send('Booking not found.');
    }

    const booking = bookingRes.rows[0];

    // Validate access token
    if (token && booking.download_token_hash && booking.status_token_hash) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const isValid = tokenHash === booking.download_token_hash || tokenHash === booking.status_token_hash;
      if (!isValid) {
        return res.status(401).send('Unauthorized to download tickets.');
      }
    }

    if (booking.status !== 'payment_confirmed' && booking.status !== 'proof_verified') {
      return res.status(400).send('Payment is not confirmed for this booking.');
    }

    const cRes = await db.query(
      'SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
      [booking.id]
    );

    if (cRes.rows.length === 0) {
      return res.status(404).send('No coupons found for this booking.');
    }

    const format = req.query.format as string;

    if (format === 'zip' || cRes.rows.length > 5) {
      const zipBuffer = await createTicketsZipArchive(cRes.rows);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="YuvaShakti-${booking.public_id}-Coupons.zip"`);
      return res.send(zipBuffer);
    } else {
      const combinedPdf = await renderMultiTicketPdf(cRes.rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="YuvaShakti-${booking.public_id}-Tickets.pdf"`);
      return res.send(Buffer.from(combinedPdf));
    }
  } catch (error: any) {
    console.error('Download all tickets error:', error);
    res.status(500).send('Failed to generate ticket package.');
  }
});

// 11. Test Mode Simulated Proof Verification (Automated Tests ONLY)
app.post(['/api/test-mode/simulate-proof-verification', '/api/test-mode/simulate-admin-confirm', '/api/test-mode/simulate-payment'], async (req: Request, res: Response) => {
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Prohibited in production mode.' });
  }

  try {
    const { submissionId, bookingPublicId, clientTxnId } = req.body;
    let targetSubId = submissionId;
    let targetBookingId = '';

    if (bookingPublicId) {
      const bRes = await db.query('SELECT id FROM bookings WHERE public_id = $1', [bookingPublicId]);
      if (bRes.rows.length > 0) targetBookingId = bRes.rows[0].id;
    } else if (clientTxnId) {
      const bRes = await db.query('SELECT id FROM bookings WHERE payment_reference = $1 OR public_id = $1', [clientTxnId]);
      if (bRes.rows.length > 0) targetBookingId = bRes.rows[0].id;
    }

    if (!targetBookingId) {
      const latestB = await db.query('SELECT id FROM bookings WHERE status != $1 ORDER BY created_at DESC LIMIT 1', ['payment_confirmed']);
      if (latestB.rows.length > 0) targetBookingId = latestB.rows[0].id;
    }

    if (!targetSubId && targetBookingId) {
      const bData = await db.query('SELECT total_amount_paise FROM bookings WHERE id = $1', [targetBookingId]);
      const expectedAmount = bData.rows[0]?.total_amount_paise || 5000;

      const sRes = await db.query('SELECT id, expected_amount_paise FROM payment_submissions WHERE booking_id = $1 LIMIT 1', [targetBookingId]);
      if (sRes.rows.length > 0) {
        targetSubId = sRes.rows[0].id;
      } else {
        targetSubId = crypto.randomUUID();
        const simUtrHash = `sim-${crypto.randomBytes(8).toString('hex')}`;
        await db.query(
          `INSERT INTO payment_submissions (
            id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
            expected_payee_name, expected_amount_paise, payer_utr_hash, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [targetSubId, targetBookingId, 'YSYS-SIM-REF', 'phonepe', config.PAYEE_UPI_ID, config.PAYEE_DISPLAY_NAME, expectedAmount, simUtrHash, 'proof_submitted']
        );
      }
    }

    if (!targetSubId || !targetBookingId) {
      return res.status(400).json({ error: 'No booking or submission found to verify.' });
    }

    const result = await finalizeVerifiedSubmission({
      submissionId: targetSubId,
      bookingId: targetBookingId,
      decisionVersion: 'test-simulation',
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('SIMULATE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Catch-All JSON 404 for any unmatched /api/* requests (Ensures API requests NEVER return HTML)
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'API_NOT_FOUND',
      message: 'API endpoint not found.',
    },
  });
});

// 13. Global Error Handler (Returns structured JSON)
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('Unhandled API error:', err);
  const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected internal error occurred.',
    },
  });
});

export { app };
export default app;
