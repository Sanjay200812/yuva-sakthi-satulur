import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { config, getPublicConfig, canAcceptPayments } from './config/eventConfig.ts';
import { db, isDatabaseConnected } from './db/client.ts';
import { generateUpiPaymentSession } from './upi/upiUri.ts';
import { processPaymentScreenshot, hammingDistance, checkStorageHealth } from './upi/imageProcessor.ts';
import { analyzePaymentScreenshotWithGemini } from './upi/geminiAnalyzer.ts';
import { performDeterministicComparison, normalizeUtr } from './upi/deterministicMatcher.ts';
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
  // YSYS-[timestamp base36]-[4 random hex chars]
  return `YSYS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
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
    const { screenshotBase64, selectedApp, consentGiven } = req.body;

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

    // 5. Idempotency: Return immediately if already confirmed
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

    // 6. Clean & Decode Screenshot Buffer
    const cleanBase64 = screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(cleanBase64, 'base64');

    // 7. Process Image: magic bytes, EXIF strip, dimension check, SHA-256, phash, save to private bucket/disk
    const processed = await processPaymentScreenshot(imageBuffer, booking.id);

    // 8. Run Gemini-Assisted OCR & Risk Analysis (Untrusted Input)
    const extraction = await analyzePaymentScreenshotWithGemini(
      processed.sanitizedBuffer,
      processed.mimeType,
      {
        expectedMerchantName: config.PAYEE_DISPLAY_NAME,
        expectedAmount: (booking.total_amount_paise / 100).toFixed(2),
        sessionTimestampIso: booking.created_at || new Date().toISOString(),
      }
    );

    // 9. Extract and normalize transaction reference exclusively from screenshot OCR
    const extractedRrn = extraction.utr_or_rrn ? normalizeUtr(extraction.utr_or_rrn) : '';
    const submissionId = crypto.randomUUID();
    let utrHash: string;
    let encryptedUtr: string;
    let isDuplicateUtr = false;

    if (extractedRrn) {
      utrHash = crypto.createHash('sha256').update(extractedRrn).digest('hex');
      const dupUtrRes = await db.query(
        'SELECT id, booking_id FROM payment_submissions WHERE payer_utr_hash = $1 AND booking_id != $2 AND status != $3 AND status != $4',
        [utrHash, booking.id, 'admin_rejected', 'ai_check_failed']
      );
      isDuplicateUtr = dupUtrRes.rows.length > 0;
      encryptedUtr = encryptSensitiveField(extractedRrn);
    } else {
      const fallbackRef = `UNEXTRACTED_${submissionId}`;
      utrHash = crypto.createHash('sha256').update(fallbackRef).digest('hex');
      encryptedUtr = encryptSensitiveField(fallbackRef);
    }

    // 10. Check Duplicate Screenshot Hash
    const dupScreenRes = await db.query(
      'SELECT id, booking_id FROM payment_submissions WHERE screenshot_sha256 = $1 AND booking_id != $2 AND status != $3 AND status != $4',
      [processed.sha256, booking.id, 'admin_rejected', 'ai_check_failed']
    );
    let isDuplicateScreenshot = dupScreenRes.rows.length > 0;

    // 10b. Perceptual dHash Duplicate Detection
    if (!isDuplicateScreenshot && processed.phash) {
      const pastSubs = await db.query(
        'SELECT id, booking_id, screenshot_phash, expected_amount_paise FROM payment_submissions WHERE booking_id != $1 AND screenshot_phash IS NOT NULL AND status != $2 AND status != $3',
        [booking.id, 'admin_rejected', 'ai_check_failed']
      );
      for (const past of pastSubs.rows) {
        if (past.screenshot_phash) {
          const dist = hammingDistance(processed.phash, past.screenshot_phash);
          // If images are virtually identical and amount matches, flag duplicate screenshot
          if (dist <= 2 && past.expected_amount_paise === booking.total_amount_paise) {
            isDuplicateScreenshot = true;
            break;
          }
        }
      }
    }

    // 11. Run Deterministic Comparison Engine (Fail-Closed)
    const match = performDeterministicComparison({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredUtr: extractedRrn,
      selectedApp: selectedApp || booking.selected_upi_app || 'other_upi',
      extraction,
      isDuplicateUtr,
      isDuplicateScreenshot,
      isExpired: false,
    });

    const paymentRef = booking.payment_reference || `YSYS-${Date.now().toString(36).toUpperCase()}`;

    // 12. Persist payment submission record
    await db.query(
      `INSERT INTO payment_submissions (
        id, booking_id, payment_reference, selected_upi_app, expected_payee_upi_id,
        expected_payee_name, expected_amount_paise, payer_utr_hash, encrypted_utr,
        screenshot_storage_path, screenshot_sha256, screenshot_phash, mime_type,
        byte_size, width, height, status, gemini_extraction, deterministic_comparison,
        risk_score, reason_codes, ai_model_version
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
        match.nextStatus,
        JSON.stringify(extraction),
        JSON.stringify(match),
        match.riskScore,
        match.reasonCodes,
        config.GEMINI_MODEL,
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
        'gemini_and_deterministic',
        match.passed ? 'passed' : 'flagged',
        extraction.field_confidence?.amount || 0.8,
        match.reasonCodes,
        JSON.stringify({ match, extractionSummary: { utr: extraction.utr_or_rrn, amount: extraction.amount } }),
        new Date().toISOString(),
      ]
    );

    if (match.passed) {
      // 14. AUTOMATED FINALIZATION: Atomic transaction locks booking, allocates sequential coupons, and transitions to payment_confirmed
      const finalResult = await finalizeVerifiedSubmission({
        submissionId,
        bookingId: booking.id,
        decisionVersion: 'v2-automated-gemini-deterministic',
      });

      return res.json({
        success: true,
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'payment_confirmed',
          reviewStatus: 'ai_check_passed',
          message: 'Payment proof accepted',
          coupons: finalResult.coupons,
          couponsIssuedCount: finalResult.couponsIssuedCount,
          downloadUrl: `/api/bookings/${booking.public_id}/download-all?token=${token}`,
          details: match.details,
        },
      });
    } else {
      // Step Fail-Closed: mark booking ai_check_failed
      await db.query(
        'UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3',
        ['ai_check_failed', new Date().toISOString(), booking.id]
      );

      return res.status(400).json({
        success: false,
        error: {
          code: 'AI_CHECK_FAILED',
          message: match.userMessage,
          reasonCodes: match.reasonCodes,
        },
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'ai_check_failed',
          message: match.userMessage,
          details: match.details,
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

    // Check expiry
    const isExpired = booking.status === 'expired' || (booking.payment_expires_at && new Date(booking.payment_expires_at).getTime() < Date.now());
    if (isExpired && booking.status !== 'payment_confirmed' && booking.status !== 'proof_verified') {
      if (booking.status !== 'expired') {
        await db.query('UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3', ['expired', new Date().toISOString(), booking.id]);
        booking.status = 'expired';
      }
    }

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
        name: booking.participant_name,
        quantity: booking.quantity,
        totalAmount: booking.total_amount_paise / 100,
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
