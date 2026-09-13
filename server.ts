import express, { Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';

import { config, getPublicConfig, canAcceptPayments } from './server/config/eventConfig.ts';
import { db } from './server/db/client.ts';
import { generateUpiPaymentSession } from './server/upi/upiUri.ts';
import { processPaymentScreenshot } from './server/upi/imageProcessor.ts';
import { analyzePaymentScreenshotWithGemini } from './server/upi/geminiAnalyzer.ts';
import { performDeterministicComparison, normalizeUtr } from './server/upi/deterministicMatcher.ts';
import { finalizeVerifiedSubmission } from './server/upi/automatedFinalizer.ts';
import { allocateCouponsForBooking } from './server/services/couponAllocator.ts';
import {
  renderTicketPdf,
  renderMultiTicketPdf,
  renderTicketRaster,
  createTicketsZipArchive,
  maskPhoneNumber,
  formatKolkataTime,
} from './server/services/ticketRenderer.ts';
import adminRoutes from './server/admin/routes.ts';

const app = express();
const PORT = Number(config.PORT) || 3000;

// 1. Security Headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: false, // Vite inline scripts & styles in dev
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Helper to normalize 10-digit Indian Mobile
function normalizeIndianPhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return null;
}

// 2. Health & Config
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
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

    if (!village || typeof village !== 'string' || village.trim().length < 2 || village.trim().length > 80) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_VILLAGE', message: 'Please enter a valid village/town name.' },
      });
    }

    const qty = Number(quantity);
    if (
      quantity === undefined ||
      quantity === null ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > config.EVENT_MAX_COUPONS_PER_BOOKING
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUANTITY',
          message: `Quantity must be an integer between 1 and ${config.EVENT_MAX_COUPONS_PER_BOOKING}.`,
        },
      });
    }

    // Strict Server-Side Pricing (Paise)
    const unitPricePaise = config.EVENT_COUPON_PRICE_PAISE; // 5000 paise = ₹50
    const totalAmountPaise = unitPricePaise * qty;

    const publicId = `BK-${Math.floor(100000 + Math.random() * 900000)}`;
    const paymentReference = `YSYS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const bookingId = crypto.randomUUID();

    // Secure tokens
    const statusToken = crypto.randomBytes(24).toString('hex');
    const statusTokenHash = crypto.createHash('sha256').update(statusToken).digest('hex');

    const downloadToken = crypto.randomBytes(24).toString('hex');
    const downloadTokenHash = crypto.createHash('sha256').update(downloadToken).digest('hex');

    // Generate canonical NPCI UPI Session & QR
    const upiSession = await generateUpiPaymentSession({
      publicBookingId: publicId,
      transactionReference: paymentReference,
      totalAmountPaise,
      participantName: name.trim(),
    });

    // Insert booking into database
    await db.query(
      `INSERT INTO bookings (
        id, public_id, participant_name, phone, village, quantity,
        unit_price_paise, total_amount_paise, status, provider_name,
        download_token_hash, status_token_hash, selected_upi_app, payment_reference
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        bookingId,
        publicId,
        name.trim(),
        normalizedPhone,
        village.trim(),
        qty,
        unitPricePaise,
        totalAmountPaise,
        'payment_initiated',
        'direct_upi',
        downloadTokenHash,
        statusTokenHash,
        selectedApp || 'other_upi',
        paymentReference,
      ]
    );

    return res.json({
      success: true,
      data: {
        booking: {
          id: bookingId,
          publicId,
          name: name.trim(),
          phone: normalizedPhone,
          village: village.trim(),
          quantity: qty,
          totalAmount: totalAmountPaise / 100,
          status: 'payment_initiated',
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
          appIntents: upiSession.appIntents,
        },
      },
    });
  } catch (error: any) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'BOOKING_FAILED', message: error.message || 'Failed to create booking.' },
    });
  }
});

// 5. Submit Mandatory Payment Proof (UTR + Screenshot + Consent)
app.post('/api/bookings/:publicId/payment-proof', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const { utr, screenshotBase64, selectedApp, consentGiven } = req.body;

    // 1. Validate Consent
    if (!consentGiven) {
      return res.status(400).json({
        success: false,
        error: { code: 'CONSENT_REQUIRED', message: 'You must consent to automated image analysis and administrator verification.' },
      });
    }

    // 2. Validate UTR
    if (!utr || typeof utr !== 'string' || utr.trim().length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_UTR', message: 'Please enter a valid 12-digit UTR/RRN/Transaction reference number.' },
      });
    }

    // 3. Validate Screenshot presence
    if (!screenshotBase64 || typeof screenshotBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_SCREENSHOT', message: 'Payment confirmation screenshot is mandatory.' },
      });
    }

    // 4. Find Booking
    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }

    const booking = bookingRes.rows[0];
    if (booking.status === 'payment_confirmed') {
      return res.json({
        success: true,
        data: { status: 'payment_confirmed', message: 'Payment already confirmed. Coupons are available.' },
      });
    }

    // 5. Clean & Decode Screenshot Buffer
    const cleanBase64 = screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(cleanBase64, 'base64');

    // 6. Process Image: magic bytes, EXIF strip, dimension check, SHA-256, phash, save to disk
    const processed = await processPaymentScreenshot(imageBuffer, booking.id);

    // 7. Check Duplicate UTR (Global uniqueness check)
    const normalizedUtr = normalizeUtr(utr);
    const utrHash = crypto.createHash('sha256').update(normalizedUtr).digest('hex');

    const dupUtrRes = await db.query(
      'SELECT id, booking_id FROM payment_submissions WHERE payer_utr_hash = $1 AND booking_id != $2 AND status != $3',
      [utrHash, booking.id, 'admin_rejected']
    );
    const isDuplicateUtr = dupUtrRes.rows.length > 0;

    // 8. Check Duplicate Screenshot Hash
    const dupScreenRes = await db.query(
      'SELECT id, booking_id FROM payment_submissions WHERE screenshot_sha256 = $1 AND booking_id != $2 AND status != $3',
      [processed.sha256, booking.id, 'admin_rejected']
    );
    const isDuplicateScreenshot = dupScreenRes.rows.length > 0;

    // 9. Run Gemini-Assisted OCR & Risk Analysis
    const extraction = await analyzePaymentScreenshotWithGemini(
      processed.sanitizedBuffer,
      processed.mimeType
    );

    // 10. Run Deterministic Comparison Engine
    const match = performDeterministicComparison({
      expectedAmountPaise: booking.total_amount_paise,
      expectedPayeeUpiId: config.PAYEE_UPI_ID,
      expectedPayeeName: config.PAYEE_DISPLAY_NAME,
      enteredUtr: utr,
      selectedApp: selectedApp || booking.selected_upi_app || 'other_upi',
      extraction,
      isDuplicateUtr,
      isDuplicateScreenshot,
    });

    const submissionId = crypto.randomUUID();
    const paymentRef = booking.payment_reference || `YSYS-${Date.now().toString(36).toUpperCase()}`;

    // Simple symmetric encryption for raw UTR at rest
    const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(config.FIELD_ENCRYPTION_KEY.slice(0, 32)), null);
    let encryptedUtr = cipher.update(normalizedUtr, 'utf8', 'hex');
    encryptedUtr += cipher.final('hex');

    // 11. Persist payment submission record
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

    // 12. Record verification run
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
      // Step 6: Idempotent atomic automatic finalization and coupon issuance
      const finalResult = await finalizeVerifiedSubmission({
        submissionId,
        bookingId: booking.id,
        decisionVersion: 'v1-gemini-deterministic-auto',
      });

      return res.json({
        success: true,
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'proof_verified',
          message: 'Payment proof verified, coupons ready.',
          coupons: finalResult.coupons,
          details: match.details,
        },
      });
    } else {
      // Step 5 Fail-Closed: mark booking verification_failed
      await db.query(
        'UPDATE bookings SET status = $1, updated_at = $2 WHERE id = $3',
        ['verification_failed', new Date().toISOString(), booking.id]
      );

      return res.status(400).json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: match.userMessage,
          reasonCodes: match.reasonCodes,
        },
        data: {
          submissionId,
          publicId: booking.public_id,
          status: 'verification_failed',
          message: match.userMessage,
          details: match.details,
        },
      });
    }
  } catch (error: any) {
    console.error('Payment proof submission error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SUBMISSION_FAILED', message: error.message || 'Failed to process payment proof.' },
    });
  }
});

// 6. Booking Status Polling Endpoint
app.get('/api/bookings/:publicId/status', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }

    const booking = bookingRes.rows[0];

    const isVerified = booking.status === 'proof_verified' || booking.status === 'payment_confirmed';
    let coupons: any[] = [];
    if (isVerified) {
      const couponsRes = await db.query(
        'SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      coupons = couponsRes.rows;
    }

    // Get latest submission status message if any
    const subRes = await db.query(
      'SELECT status, reason_codes, admin_review_note FROM payment_submissions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1',
      [booking.id]
    );
    const latestSub = subRes.rows[0];

    let userMessage = 'Payment not yet submitted';
    if (booking.status === 'ai_checking' || booking.status === 'proof_submitted') {
      userMessage = 'Checking uploaded proof...';
    } else if (isVerified) {
      userMessage = 'Payment proof verified, coupons ready.';
    } else if (booking.status === 'verification_failed') {
      userMessage = latestSub?.reason_codes?.length
        ? `Verification failed: ${latestSub.reason_codes.join(', ')}. Please correct and resubmit.`
        : 'Verification failed, correct the highlighted issue and resubmit.';
    }

    res.json({
      success: true,
      data: {
        publicId: booking.public_id,
        status: isVerified ? 'proof_verified' : booking.status,
        isConfirmed: isVerified,
        isVerified,
        quantity: booking.quantity,
        totalAmount: booking.total_amount_paise / 100,
        paidAt: booking.verified_at || booking.paid_at,
        message: userMessage,
        coupons,
        downloadUrl: isVerified ? `/api/bookings/${booking.public_id}/download-all` : null,
      },
    });
  } catch (error: any) {
    console.error('Fetch booking status error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch status.' } });
  }
});

// 7. Get Issued Coupons for Booking
app.get('/api/bookings/:publicId/coupons', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const bookingRes = await db.query('SELECT id, status FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }

    const booking = bookingRes.rows[0];
    const isVerified = booking.status === 'proof_verified' || booking.status === 'payment_confirmed';
    if (!isVerified) {
      return res.status(403).json({ success: false, error: { message: 'Payment proof not verified yet.' } });
    }

    const couponsRes = await db.query(
      'SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
      [booking.id]
    );

    res.json({ success: true, data: couponsRes.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// 8. Public Coupon Verification (PII Protected)
app.get('/api/coupons/:couponNumber/verify', async (req: Request, res: Response) => {
  try {
    const { couponNumber } = req.params;
    const cleanNumber = couponNumber.trim().toUpperCase();

    const couponRes = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [cleanNumber]);
    if (couponRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No valid ticket found with this coupon number.' },
      });
    }

    const coupon = couponRes.rows[0];
    const bookingRes = await db.query('SELECT status, paid_at, verified_at, public_id FROM bookings WHERE id = $1', [
      coupon.booking_id,
    ]);
    const booking = bookingRes.rows[0];

    const isVerified = (booking?.status === 'proof_verified' || booking?.status === 'payment_confirmed') && coupon.status === 'valid';

    return res.json({
      success: true,
      data: {
        couponNumber: coupon.coupon_number,
        isValid: isVerified,
        status: coupon.status,
        participantName: coupon.holder_name,
        maskedPhone: maskPhoneNumber(coupon.phone),
        village: coupon.village,
        ticketIndex: coupon.ticket_index,
        totalQuantity: coupon.total_quantity,
        issuedAt: formatKolkataTime(coupon.issued_at),
        drawDate: '19th Sunday Evening, 6:30 PM',
        venue: config.EVENT_VENUE,
        prize: config.EVENT_PRIZE,
      },
    });
  } catch (error: any) {
    console.error('Coupon verify error:', error);
    res.status(500).json({ success: false, error: { message: 'Verification failed.' } });
  }
});

// 9. Download Single Ticket (PDF, PNG, JPEG)
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
      return res.status(404).send('Coupon not found');
    }

    const coupon = couponRes.rows[0];
    const bookingRes = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);
    const booking = bookingRes.rows[0];

    const isVerified = (booking?.status === 'proof_verified' || booking?.status === 'payment_confirmed') && coupon.status === 'valid';
    if (!isVerified) {
      return res.status(403).send('Ticket cannot be downloaded until payment proof is verified.');
    }

    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking.public_id,
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking.verified_at || booking.paid_at,
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

// 10. Download All Tickets for a Booking (ZIP or Multi-page PDF)
app.get('/api/bookings/:publicId/download-all', async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);

    if (bookingRes.rows.length === 0) {
      return res.status(404).send('Booking not found');
    }

    const booking = bookingRes.rows[0];
    const isVerified = booking.status === 'proof_verified' || booking.status === 'payment_confirmed';
    if (!isVerified) {
      return res.status(403).send('Tickets cannot be downloaded until payment proof is verified.');
    }

    const couponsRes = await db.query(
      'SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
      [booking.id]
    );

    const tickets = couponsRes.rows.map((c) => ({
      couponNumber: c.coupon_number,
      participantName: c.holder_name,
      phone: c.phone,
      village: c.village,
      bookingPublicId: booking.public_id,
      ticketIndex: c.ticket_index,
      totalQuantity: c.total_quantity,
      paidAt: booking.verified_at || booking.paid_at,
    }));

    if (tickets.length === 1) {
      const pdfBuffer = await renderTicketPdf(tickets[0]);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${tickets[0].couponNumber}.pdf"`);
      return res.send(pdfBuffer);
    }

    // Multiple tickets: send ZIP package containing PDFs, PNGs, and JPEGs
    const zipBuffer = await createTicketsZipArchive(tickets);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="tickets_${booking.public_id}.zip"`);
    res.send(zipBuffer);
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
      // Find latest unverified booking
      const latestB = await db.query('SELECT id FROM bookings WHERE status != $1 ORDER BY created_at DESC LIMIT 1', ['proof_verified']);
      if (latestB.rows.length > 0) targetBookingId = latestB.rows[0].id;
    }

    if (!targetSubId && targetBookingId) {
      const sRes = await db.query('SELECT id FROM payment_submissions WHERE booking_id = $1 LIMIT 1', [targetBookingId]);
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
          [targetSubId, targetBookingId, 'YSYS-SIM-REF', 'phonepe', config.PAYEE_UPI_ID, config.PAYEE_DISPLAY_NAME, 5000, simUtrHash, 'proof_submitted']
        );
      }
    }

    if (!targetSubId || !targetBookingId) {
      return res.status(400).json({ error: 'No booking or submission found to verify.' });
    }

    const result = await finalizeVerifiedSubmission({
      submissionId: targetSubId,
      bookingId: targetBookingId,
      decisionVersion: 'test-mode-simulation',
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('SIMULATE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Mount Vite middleware or Static Bundle
async function startServer() {
  if (config.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Yuva Shakti Portal running on http://0.0.0.0:${PORT}`);
    console.log(`💳 Payment Mode: ${config.PAYMENT_MODE} [Payee: ${config.PAYEE_UPI_ID}]`);
  });
}

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app };
