import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import QRCode from 'qrcode';
import fs from 'fs';
import { app } from '../server.ts';
import { generateCanonicalUpiUri, generateUpiPaymentSession } from '../server/upi/upiUri.ts';
import { canAcceptPayments, config } from '../server/config/eventConfig.ts';
import {
  validateScreenshotBuffer,
  processPaymentScreenshot,
  getSignedScreenshotUrl,
  checkStorageHealth,
} from '../server/upi/imageProcessor.ts';
import { performDeterministicComparison, performDeterministicOcrComparison } from '../server/upi/deterministicMatcher.ts';
import {
  setMockOcrResult,
  setMockOcrText,
  normalizeOcrText,
  extractPaymentReference,
  extractAmount,
  extractPaymentStatus,
  extractTransactionTimestamp,
  extractUpiId,
} from '../server/upi/localOcrAnalyzer.ts';
import { db } from '../server/db/client.ts';

// Helper to generate a valid unique raster PNG base64 string that passes Sharp image validation
async function createValidScreenshotBase64(customSeed?: number): Promise<string> {
  const seed = customSeed || Math.floor(Math.random() * 100000);
  const r = (seed * 17) % 200 + 20;
  const g = (seed * 31) % 200 + 20;
  const b = (seed * 53) % 200 + 20;
  const width = 250 + (seed % 60);
  const height = 350 + (seed % 60);
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r, g, b } },
  }).png().toBuffer();
  return buf.toString('base64');
}

describe('Phase 11: Direct UPI Collection & Automated Proof Verification Pipeline', () => {
  beforeEach(() => {
    setMockOcrResult(null);
    setMockOcrText(null);
  });

  it('generates canonical NPCI UPI URI with fixed am, unique reference, and no mam', () => {
    const uri = generateCanonicalUpiUri({
      payeeUpiId: '7075920852@ybl',
      payeeDisplayName: 'Yuva Shakti Youth, Satulur',
      transactionReference: 'YSYS-REF-101',
      totalAmountPaise: 5000,
      note: 'YSYS Satulur Draw BK-123456',
    });

    expect(uri).toContain('upi://pay?');
    expect(uri).toContain('pa=7075920852%40ybl');
    expect(uri).toContain('am=50.00');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tr=YSYS-REF-101');
    // Must NOT contain mam parameter
    expect(uri).not.toContain('mam=');
  });

  it('creates booking with server-calculated amount and dynamic UPI QR session with 4 dedicated intents', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Venkata Rao',
        phone: '9574876369',
        village: 'Satulur',
        quantity: 2,
        selectedApp: 'phonepe',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { booking, payment } = res.body.data;
    expect(booking.quantity).toBe(2);
    expect(booking.totalAmount).toBe(100);
    expect(booking.status).toBe('payment_initiated');

    // Dynamic QR & URI
    expect(payment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(payment.canonicalUri).toContain('am=100.00');
    expect(payment.canonicalUri).not.toContain('mam=');
    expect(payment.canonicalUri).toContain('cu=INR');

    // 4 UPI App Intents: PhonePe, Google Pay, Paytm, Other UPI Apps
    expect(payment.appIntents).toHaveProperty('phonepe');
    expect(payment.appIntents.phonepe).toMatch(/^phonepe:\/\/pay\?/);

    expect(payment.appIntents).toHaveProperty('google_pay');
    expect(payment.appIntents.google_pay).toMatch(/^gpay:\/\/upi\/pay\?/);

    expect(payment.appIntents).toHaveProperty('paytm');
    expect(payment.appIntents.paytm).toMatch(/^paytmmp:\/\/pay\?/);

    expect(payment.appIntents).toHaveProperty('other_upi');
    expect(payment.appIntents.other_upi).toMatch(/^upi:\/\/pay\?/);
  });

  it('rejects payment proof submission when access token is missing or invalid (401)', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const publicId = bRes.body.data.booking.publicId;

    const validImg = await createValidScreenshotBase64();

    // Submitting without statusToken / Bearer token (no manual UTR in body)
    const res = await request(app)
      .post(`/api/bookings/${publicId}/payment-proof`)
      .send({
        screenshotBase64: validImg,
        consentGiven: true,
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects proof submission if the 5-minute payment session has expired', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Expired Booking User', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    // Simulate expired booking by updating payment_expires_at in database
    await db.query(
      'UPDATE bookings SET payment_expires_at = $1 WHERE public_id = $2',
      [new Date(Date.now() - 60000).toISOString(), booking.publicId]
    );

    const validImg = await createValidScreenshotBase64();

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImg,
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PAYMENT_SESSION_EXPIRED');
  });

  it('blocks payment proof submission when consent is missing', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const validImg = await createValidScreenshotBase64();

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImg,
        consentGiven: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('blocks payment proof submission when screenshot is missing or not an image', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: '',
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_SCREENSHOT');

    // Executable/fake image buffer test
    const fakeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary');
    await expect(validateScreenshotBuffer(fakeBuffer)).rejects.toThrow();
  });

  it('payment-proof API works without client RRN and extracts RRN directly from screenshot OCR', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Nagaraju', phone: '9848011223', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const validImg = await createValidScreenshotBase64();

    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 50 UTR 523489123456',
      normalizedText: 'Payment Successful 50 UTR 523489123456',
      paymentStatus: 'success',
      amount: 50.00,
      amountText: '50.00',
      utrOrRrn: '523489123456',
      transactionId: 'T2609140101',
      transactionDate: '15 Sep 2026',
      transactionTime: '01:24 AM',
      transactionTimestamp: new Date().toISOString(),
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'Nagaraju',
      detectedApp: 'phonepe',
      extractedFields: {},
      warnings: [],
    });

    // Request does NOT contain any manual UTR/RRN
    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImg,
        selectedApp: 'phonepe',
        consentGiven: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('payment_confirmed');
    expect(res.body.data.coupons.length).toBe(1);
    expect(res.body.data.coupons[0].coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);
  });

  it('fails closed when extracted RRN/UTR is missing or illegible from screenshot', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Sudha Rani', phone: '9848022334', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const validImg = await createValidScreenshotBase64();

    // OCR cannot clearly read RRN/UTR
    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 50',
      normalizedText: 'Payment Successful 50',
      paymentStatus: 'success',
      amount: 50.00,
      amountText: '50.00',
      utrOrRrn: null,
      transactionId: null,
      transactionDate: null,
      transactionTime: null,
      transactionTimestamp: null,
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'Sudha Rani',
      detectedApp: 'google_pay',
      extractedFields: {},
      warnings: [],
    });

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImg,
        selectedApp: 'google_pay',
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.reasonCodes).toContain('MISSING_PAYMENT_REFERENCE');
    expect(res.body.error.message).toContain("We couldn't clearly read the transaction reference from this screenshot");
  });

  it('rejects duplicate extracted RRN across different bookings', async () => {
    // 1. First booking with reference 425511223344
    const bRes1 = await request(app)
      .post('/api/bookings')
      .send({ name: 'First User', phone: '9848033445', village: 'Satulur', quantity: 1 });
    const b1 = bRes1.body.data;

    const img1 = await createValidScreenshotBase64();

    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 50 UTR 425511223344',
      normalizedText: 'Payment Successful 50 UTR 425511223344',
      paymentStatus: 'success',
      amount: 50.00,
      amountText: '50.00',
      utrOrRrn: '425511223344',
      transactionId: 'T1001',
      transactionDate: null,
      transactionTime: null,
      transactionTimestamp: new Date().toISOString(),
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'First User',
      detectedApp: 'phonepe',
      extractedFields: {},
      warnings: [],
    });

    const res1 = await request(app)
      .post(`/api/bookings/${b1.booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${b1.payment.statusToken}`)
      .send({
        screenshotBase64: img1,
        consentGiven: true,
      });
    expect(res1.status).toBe(200);

    // 2. Second booking attempting to reuse the same extracted RRN 425511223344
    const bRes2 = await request(app)
      .post('/api/bookings')
      .send({ name: 'Second User', phone: '9848044556', village: 'Satulur', quantity: 1 });
    const b2 = bRes2.body.data;

    // Use a slightly different image so screenshot hash is distinct
    const img2 = (await sharp({
      create: { width: 310, height: 410, channels: 3, background: { r: 240, g: 240, b: 240 } }
    }).png().toBuffer()).toString('base64');

    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 50 UTR 425511223344',
      normalizedText: 'Payment Successful 50 UTR 425511223344',
      paymentStatus: 'success',
      amount: 50.00,
      amountText: '50.00',
      utrOrRrn: '425511223344', // Reused reference!
      transactionId: 'T1002',
      transactionDate: null,
      transactionTime: null,
      transactionTimestamp: new Date().toISOString(),
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'Second User',
      detectedApp: 'phonepe',
      extractedFields: {},
      warnings: [],
    });

    const res2 = await request(app)
      .post(`/api/bookings/${b2.booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${b2.payment.statusToken}`)
      .send({
        screenshotBase64: img2,
        consentGiven: true,
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error.reasonCodes).toContain('DUPLICATE_PAYMENT_REFERENCE');
    expect(res2.body.error.message).toContain('This payment receipt has already been used');
  });

  it('rejects payment when screenshot amount does not match server-calculated total', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Amount Mismatch User', phone: '9848055667', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const validImg = await createValidScreenshotBase64();

    // Amount on screenshot is ₹100 instead of expected ₹50
    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 100 UTR 778899001122',
      normalizedText: 'Payment Successful 100 UTR 778899001122',
      paymentStatus: 'success',
      amount: 100.00,
      amountText: '100.00',
      utrOrRrn: '778899001122',
      transactionId: 'T1003',
      transactionDate: null,
      transactionTime: null,
      transactionTimestamp: new Date().toISOString(),
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'Amount Mismatch User',
      detectedApp: 'phonepe',
      extractedFields: {},
      warnings: [],
    });

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImg,
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.reasonCodes).toContain('AMOUNT_MISMATCH');
    expect(res.body.error.message).toContain('Payment amount');
  });

  it('deterministic comparison fails when OCR amount or OCR RRN is missing', () => {
    // Missing OCR amount
    const noAmountRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '7075920852@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      selectedApp: 'phonepe',
      extraction: {
        looks_like_payment_screen: true,
        visible_payment_status: 'success',
        app_name: 'phonepe',
        amount: null as any,
        currency: 'INR',
        payee_name: null,
        payee_upi_id: null,
        payer_name: null,
        utr_or_rrn: '123456789012',
        transaction_id: null,
        transaction_timestamp: null,
        obvious_editing_signals: [],
        ai_generated_likelihood: 'low',
        field_confidence: { amount: 0, payee: 0.9, utr: 0.95, status: 0.95, timestamp: 0.9 },
      },
      isDuplicateUtr: false,
      isDuplicateScreenshot: false,
    });

    expect(noAmountRes.passed).toBe(false);
    expect(noAmountRes.reasonCodes).toContain('MISSING_AMOUNT');

    // Missing OCR RRN
    const noRrnRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '7075920852@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      selectedApp: 'phonepe',
      extraction: {
        looks_like_payment_screen: true,
        visible_payment_status: 'success',
        app_name: 'phonepe',
        amount: '50.00',
        currency: 'INR',
        payee_name: null,
        payee_upi_id: null,
        payer_name: null,
        utr_or_rrn: null as any,
        transaction_id: null,
        transaction_timestamp: null,
        obvious_editing_signals: [],
        ai_generated_likelihood: 'low',
        field_confidence: { amount: 0.95, payee: 0.9, utr: 0, status: 0.95, timestamp: 0.9 },
      },
      isDuplicateUtr: false,
      isDuplicateScreenshot: false,
    });

    expect(noRrnRes.passed).toBe(false);
    expect(noRrnRes.reasonCodes).toContain('MISSING_PAYMENT_REFERENCE');
    expect(noRrnRes.reasonCodes).toContain('MISSING_RRN');
  });

  it('deterministic comparison fails for failed/pending payment status or tampering/AI indicators', () => {
    // Visible status is pending or failed
    const pendingRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '7075920852@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      selectedApp: 'phonepe',
      extraction: {
        looks_like_payment_screen: true,
        visible_payment_status: 'failed',
        app_name: 'phonepe',
        amount: '50.00',
        currency: 'INR',
        payee_name: null,
        payee_upi_id: null,
        payer_name: null,
        utr_or_rrn: '123456789012',
        transaction_id: null,
        transaction_timestamp: null,
        obvious_editing_signals: [],
        ai_generated_likelihood: 'low',
        field_confidence: { amount: 0.95, payee: 0.9, utr: 0.95, status: 0.95, timestamp: 0.9 },
      },
      isDuplicateUtr: false,
      isDuplicateScreenshot: false,
    });

    expect(pendingRes.passed).toBe(false);
    expect(pendingRes.reasonCodes).toContain('STATUS_NOT_SUCCESS');

    // AI generated likelihood high
    const aiRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '7075920852@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      selectedApp: 'phonepe',
      extraction: {
        looks_like_payment_screen: true,
        visible_payment_status: 'success',
        app_name: 'phonepe',
        amount: '50.00',
        currency: 'INR',
        payee_name: null,
        payee_upi_id: null,
        payer_name: null,
        utr_or_rrn: '123456789012',
        transaction_id: null,
        transaction_timestamp: null,
        obvious_editing_signals: ['Font mismatch on amount', 'Photoshop clone stamp artifacts'],
        ai_generated_likelihood: 'high',
        field_confidence: { amount: 0.95, payee: 0.9, utr: 0.95, status: 0.95, timestamp: 0.9 },
      },
      isDuplicateUtr: false,
      isDuplicateScreenshot: false,
    });

    expect(aiRes.passed).toBe(false);
    expect(aiRes.reasonCodes).toContain('TAMPERING_RISK');
  });

  it('deterministic comparison catches duplicate screenshot and fails closed', () => {
    const dupScreenRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '7075920852@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      selectedApp: 'phonepe',
      extraction: {
        looks_like_payment_screen: true,
        visible_payment_status: 'success',
        app_name: 'phonepe',
        amount: '50.00',
        currency: 'INR',
        payee_name: null,
        payee_upi_id: null,
        payer_name: null,
        utr_or_rrn: '123456789012',
        transaction_id: null,
        transaction_timestamp: null,
        obvious_editing_signals: [],
        ai_generated_likelihood: 'low',
        field_confidence: { amount: 0.95, payee: 0.95, utr: 0.95, status: 0.95, timestamp: 0.95 },
      },
      isDuplicateUtr: false,
      isDuplicateScreenshot: true, // Duplicate screenshot!
    });

    expect(dupScreenRes.passed).toBe(false);
    expect(dupScreenRes.reasonCodes).toContain('DUPLICATE_SCREENSHOT');
  });

  it('completes automated verification and allocates sequential coupons atomically and idempotently', async () => {
    // 1. Create booking for 2 coupons (₹100)
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Kavitha Devi', phone: '9848099999', village: 'Satulur', quantity: 2 });
    const { booking, payment } = bRes.body.data;

    // 2. Poll initial status with statusToken -> not yet verified
    const s1 = await request(app)
      .get(`/api/bookings/${booking.publicId}/status`)
      .set('Authorization', `Bearer ${payment.statusToken}`);
    expect(s1.status).toBe(200);
    expect(s1.body.data.isVerified).toBe(false);
    expect(s1.body.data.coupons.length).toBe(0);

    // 3. Simulate automated proof verification (runs finalizeVerifiedSubmission atomically)
    const simRes = await request(app)
      .post('/api/test-mode/simulate-proof-verification')
      .send({ bookingPublicId: booking.publicId });

    expect(simRes.status).toBe(200);
    expect(simRes.body.success).toBe(true);
    expect(simRes.body.data.coupons.length).toBe(2);

    const [c1, c2] = simRes.body.data.coupons;
    expect(c1.coupon_number).not.toBe(c2.coupon_number);
    expect(c1.coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);
    expect(c2.coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);

    // 4. Idempotency test: calling finalizer again for the same booking must NOT duplicate coupons!
    const repeatSimRes = await request(app)
      .post('/api/test-mode/simulate-proof-verification')
      .send({ bookingPublicId: booking.publicId });

    expect(repeatSimRes.status).toBe(200);
    expect(repeatSimRes.body.data.coupons.length).toBe(2);
    expect(repeatSimRes.body.data.coupons[0].coupon_number).toBe(c1.coupon_number);
    expect(repeatSimRes.body.data.coupons[1].coupon_number).toBe(c2.coupon_number);

    // 5. Poll status again -> status is payment_confirmed and coupons are ready
    const s2 = await request(app)
      .get(`/api/bookings/${booking.publicId}/status`)
      .set('Authorization', `Bearer ${payment.statusToken}`);
    expect(s2.status).toBe(200);
    expect(s2.body.data.status).toBe('payment_confirmed');
    expect(s2.body.data.isVerified).toBe(true);
    expect(s2.body.data.coupons.length).toBe(2);
  });

  it('generates dynamic quantity of coupons (3 coupons -> exactly 3 sequential coupons)', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Triad Buyer', phone: '9848077889', village: 'Satulur', quantity: 3 });
    const { booking, payment } = bRes.body.data;

    const validImg = await createValidScreenshotBase64();

    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 150 UTR 334455667788',
      normalizedText: 'Payment Successful 150 UTR 334455667788',
      paymentStatus: 'success',
      amount: 150.00,
      amountText: '150.00',
      utrOrRrn: '334455667788',
      transactionId: 'T3001',
      transactionDate: null,
      transactionTime: null,
      transactionTimestamp: new Date().toISOString(),
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'Triad Buyer',
      detectedApp: 'phonepe',
      extractedFields: {},
      warnings: [],
    });

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImg,
        selectedApp: 'phonepe',
        consentGiven: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.coupons.length).toBe(3);
    const setOfNumbers = new Set(res.body.data.coupons.map((c: any) => c.coupon_number));
    expect(setOfNumbers.size).toBe(3);
  });

  it('confirms that legacy gateway webhook endpoints are completely removed (404)', async () => {
    const resVyapar = await request(app).post('/api/payments/vyapar-gateway/webhook').send({});
    expect(resVyapar.status).toBe(404);

    const resRazorpay = await request(app).post('/api/razorpay/webhook').send({});
    expect(resRazorpay.status).toBe(404);
  });

  it('Requirement 12: when PAYEE_UPI_ID=7075920852@ybl, canonicalUri, QR, and all 4 UPI app intents use that exact VPA', async () => {
    process.env.PAYEE_UPI_ID = '7075920852@ybl';
    process.env.PAYEE_DISPLAY_NAME = 'Yuva Shakti Youth Satulur';
    process.env.PAYMENT_SESSION_MINUTES = '5';

    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Ramesh Kumar',
        phone: '9876543210',
        village: 'Satulur',
        quantity: 1,
        selectedApp: 'phonepe',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { payment } = res.body.data;
    const expectedVpaEncoded = 'pa=7075920852%40ybl';

    // 1. canonicalUri contains pa=7075920852%40ybl
    expect(payment.canonicalUri).toContain(expectedVpaEncoded);
    expect(payment.rawPayeeUpiId).toBe('7075920852@ybl');

    // 2. QR encodes that same URI
    const expectedQr = await QRCode.toDataURL(payment.canonicalUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
      color: {
        dark: '#070B19',
        light: '#FFFFFF',
      },
    });
    expect(payment.qrDataUrl).toBe(expectedQr);

    // 3. PhonePe intent uses that VPA
    expect(payment.appIntents.phonepe).toContain(expectedVpaEncoded);
    expect(payment.appIntents.phonepe).toMatch(/^phonepe:\/\/pay\?/);

    // 4. GPay intent uses that VPA
    expect(payment.appIntents.google_pay).toContain(expectedVpaEncoded);
    expect(payment.appIntents.google_pay).toMatch(/^gpay:\/\/upi\/pay\?/);

    // 5. Paytm intent uses that VPA
    expect(payment.appIntents.paytm).toContain(expectedVpaEncoded);
    expect(payment.appIntents.paytm).toMatch(/^paytmmp:\/\/pay\?/);

    // 6. Other UPI intent uses that VPA
    expect(payment.appIntents.other_upi).toContain(expectedVpaEncoded);
    expect(payment.appIntents.other_upi).toBe(payment.canonicalUri);

    // 7. /api/config safely exposes it
    const configRes = await request(app).get('/api/config');
    expect(configRes.status).toBe(200);
    expect(configRes.body.payeeUpiId).toBe('7075920852@ybl');
    expect(configRes.body.payeeDisplayName).toBe('Yuva Shakti Youth Satulur');
    expect(configRes.body.sessionMinutes).toBe(5);
  });

  it('Requirement 13: in production, refuses to create payment session if PAYEE_UPI_ID is absent and NEVER falls back to 9574876369@ybl or any other receiver', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origPayeeUpiId = process.env.PAYEE_UPI_ID;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.PAYEE_UPI_ID;

      // 1. canAcceptPayments fails closed
      const gate = canAcceptPayments();
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain('Payment receiver UPI account is not configured');

      // 2. /api/config reflects fail-closed state and NEVER shows 9574876369@ybl
      const configRes = await request(app).get('/api/config');
      expect(configRes.status).toBe(200);
      expect(configRes.body.payeeUpiId).not.toBe('9574876369@ybl');
      expect(configRes.body.canBook).toBe(false);

      // 3. POST /api/bookings refuses with 403 BOOKING_UNAVAILABLE
      const bookingRes = await request(app)
        .post('/api/bookings')
        .send({
          name: 'Fail Closed User',
          phone: '9876543210',
          village: 'Satulur',
          quantity: 1,
        });

      expect(bookingRes.status).toBe(403);
      expect(bookingRes.body.success).toBe(false);
      expect(bookingRes.body.error.code).toBe('BOOKING_UNAVAILABLE');
      expect(JSON.stringify(bookingRes.body)).not.toContain('9574876369');

      // 4. generateUpiPaymentSession directly throws CONFIG_ERROR and refuses to generate session
      await expect(
        generateUpiPaymentSession({
          publicBookingId: 'BK-TEST-FAIL',
          transactionReference: 'YSYS-FAIL',
          totalAmountPaise: 5000,
          participantName: 'Test',
        })
      ).rejects.toThrow('CONFIG_ERROR: Valid receiver UPI ID (PAYEE_UPI_ID) is required');
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.PAYEE_UPI_ID = origPayeeUpiId;
    }
  });

  describe('Storage Safety & Proof Recovery Pipeline', () => {
    it('in production, missing Supabase credentials throws STORAGE_NOT_CONFIGURED and NEVER writes to /var/task or process.cwd()', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origUrl = config.SUPABASE_URL;
      const origKey = config.SUPABASE_SERVICE_ROLE_KEY;

      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      try {
        config.NODE_ENV = 'production';
        config.SUPABASE_URL = '';
        config.SUPABASE_SERVICE_ROLE_KEY = '';

        const dummyBuf = await sharp({
          create: { width: 300, height: 400, channels: 3, background: { r: 100, g: 100, b: 100 } }
        }).jpeg().toBuffer();

        await expect(processPaymentScreenshot(dummyBuf, 'test-prod-booking-1')).rejects.toThrow(
          /STORAGE_NOT_CONFIGURED/
        );

        // Crucial: Filesystem writes must NEVER be invoked in production
        expect(mkdirSpy).not.toHaveBeenCalled();
        expect(writeSpy).not.toHaveBeenCalled();
      } finally {
        config.NODE_ENV = (origNodeEnv as any) || 'test';
        config.SUPABASE_URL = origUrl;
        config.SUPABASE_SERVICE_ROLE_KEY = origKey;
        mkdirSpy.mockRestore();
        writeSpy.mockRestore();
      }
    });

    it('in production, failed Supabase upload throws PAYMENT_PROOF_STORAGE_FAILED and does NOT fall back to filesystem', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origFetch = global.fetch;

      const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
      const writeSpy = vi.spyOn(fs, 'writeFileSync');

      try {
        config.NODE_ENV = 'production';
        config.SUPABASE_URL = 'https://fake-project.supabase.co';
        config.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';

        // Mock Supabase returning 404 Bucket not found
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'Bucket not found' }),
        } as any);

        const dummyBuf = await sharp({
          create: { width: 300, height: 400, channels: 3, background: { r: 120, g: 120, b: 120 } }
        }).jpeg().toBuffer();

        await expect(processPaymentScreenshot(dummyBuf, 'test-prod-booking-2')).rejects.toThrow(
          /PAYMENT_PROOF_STORAGE_FAILED/
        );

        expect(mkdirSpy).not.toHaveBeenCalled();
        expect(writeSpy).not.toHaveBeenCalled();
      } finally {
        config.NODE_ENV = (origNodeEnv as any) || 'test';
        global.fetch = origFetch;
        mkdirSpy.mockRestore();
        writeSpy.mockRestore();
      }
    });

    it('in development/test, allows local filesystem fallback if Supabase is unavailable', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origUrl = config.SUPABASE_URL;

      try {
        config.NODE_ENV = 'test';
        config.SUPABASE_URL = ''; // disable Supabase

        const dummyBuf = await sharp({
          create: { width: 300, height: 400, channels: 3, background: { r: 150, g: 150, b: 150 } }
        }).jpeg().toBuffer();

        const result = await processPaymentScreenshot(dummyBuf, 'test-dev-booking');
        expect(result.storagePath).toContain('uploads');
        expect(result.sanitizedBuffer).toBeInstanceOf(Buffer);
        expect(result.mimeType).toBe('image/jpeg');
      } finally {
        config.NODE_ENV = (origNodeEnv as any) || 'test';
        config.SUPABASE_URL = origUrl;
      }
    });

    it('successful Supabase upload stores supabase:<objectPath> and keeps sanitizedBuffer in memory for Local OCR', async () => {
      const origFetch = global.fetch;

      try {
        global.fetch = vi.fn().mockImplementation(async (url: string) => {
          if (String(url).includes('/storage/v1/object/')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ Key: 'payment-proofs/test/test.jpg' }),
            };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        });

        const dummyBuf = await sharp({
          create: { width: 400, height: 500, channels: 3, background: { r: 50, g: 80, b: 120 } }
        }).jpeg().toBuffer();

        const result = await processPaymentScreenshot(dummyBuf, 'BK-SUPA-SUCCESS');

        expect(result.storagePath).toMatch(/^supabase:BK-SUPA-SUCCESS\//);
        // sanitizedBuffer must be directly available in memory
        expect(result.sanitizedBuffer).toBeDefined();
        expect(result.sanitizedBuffer.length).toBeGreaterThan(0);
        const validated = await validateScreenshotBuffer(result.sanitizedBuffer);
        expect(validated.valid).toBe(true);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('safe recovery rule allows unfinalized booking past payment expiry to resubmit proof and receive coupons', async () => {
      // 1. Create a booking
      const bRes = await request(app)
        .post('/api/bookings')
        .send({ name: 'Real Paid User', phone: '9848011223', village: 'Satulur', quantity: 1 });

      expect(bRes.status).toBe(200);
      const { booking, payment } = bRes.body.data;

      // 2. Artificially set booking created_at and payment_expires_at to simulate payment initiated before expiry
      const createdTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const pastTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await db.query(
        'UPDATE bookings SET created_at = $1, payment_expires_at = $2, status = $3 WHERE id = $4',
        [createdTime, pastTime, 'payment_initiated', booking.id]
      );

      // 3. Mock OCR with matching extraction
      setMockOcrResult({
        analysisCompleted: true,
        rawText: 'Payment Successful 50 UTR 998877665544',
        normalizedText: 'Payment Successful 50 UTR 998877665544',
        paymentStatus: 'success',
        amount: 50.00,
        amountText: '50.00',
        utrOrRrn: '998877665544',
        transactionId: 'TXN-REC-1',
        transactionDate: null,
        transactionTime: null,
        transactionTimestamp: new Date().toISOString(),
        payeeName: config.PAYEE_DISPLAY_NAME,
        payeeUpiId: config.PAYEE_UPI_ID,
        payerName: 'Real Paid User',
        detectedApp: 'phonepe',
        extractedFields: {},
        warnings: [],
      });

      const validImg = await createValidScreenshotBase64(4455);

      // 4. Submit proof on the expired booking: safe recovery rule MUST allow it to process
      const proofRes = await request(app)
        .post(`/api/bookings/${booking.publicId}/payment-proof`)
        .set('Authorization', `Bearer ${payment.statusToken}`)
        .send({
          screenshotBase64: validImg,
          selectedApp: 'phonepe',
          consentGiven: true,
          isRecovery: true,
        });

      expect(proofRes.status).toBe(200);
      expect(proofRes.body.data.status).toBe('payment_confirmed');
      expect(proofRes.body.data.coupons.length).toBe(1);

      // 5. Idempotent Retry: Submitting proof again for already confirmed booking returns same coupons without duplicates
      const retryRes = await request(app)
        .post(`/api/bookings/${booking.publicId}/payment-proof`)
        .set('Authorization', `Bearer ${payment.statusToken}`)
        .send({
          screenshotBase64: validImg,
          selectedApp: 'phonepe',
          consentGiven: true,
          isRecovery: true,
        });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.data.coupons.length).toBe(1);
      expect(retryRes.body.data.coupons[0].coupon_number).toBe(proofRes.body.data.coupons[0].coupon_number);
    });

    it('permanently fixes payment session to exactly 5 minutes even if process.env.PAYMENT_SESSION_MINUTES is 20', async () => {
      const origMins = process.env.PAYMENT_SESSION_MINUTES;
      try {
        process.env.PAYMENT_SESSION_MINUTES = '20';

        // 1. Config endpoint reports exactly 5 minutes
        const cfgRes = await request(app).get('/api/config');
        expect(cfgRes.status).toBe(200);
        expect(cfgRes.body.sessionMinutes).toBe(5);
        expect(cfgRes.body.data.sessionMinutes).toBe(5);

        // 2. New booking creation produces expiry exactly 5 minutes (300 seconds) in the future
        const now = Date.now();
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Fixed Timer User', phone: '9848099111', village: 'Satulur', quantity: 1 });

        expect(bRes.status).toBe(200);
        const { booking, payment } = bRes.body.data;
        const expiresAtMs = new Date(booking.expiresAt).getTime();
        const diffSeconds = Math.round((expiresAtMs - now) / 1000);

        // Must be exactly around 300 seconds (5 minutes), NEVER 1200 seconds (20 minutes)
        expect(diffSeconds).toBeGreaterThanOrEqual(295);
        expect(diffSeconds).toBeLessThanOrEqual(305);
        expect(payment.expiresAt).toBe(booking.expiresAt);

        // 3. Database value is also that exact server-generated expiry
        const dbRes = await db.query('SELECT payment_expires_at FROM bookings WHERE public_id = $1', [booking.publicId]);
        const dbExpiresAtMs = new Date(dbRes.rows[0].payment_expires_at).getTime();
        expect(dbExpiresAtMs).toBe(expiresAtMs);
      } finally {
        process.env.PAYMENT_SESSION_MINUTES = origMins;
      }
    });

    it('rejects anon key as service role key for storage operations', async () => {
      const origKey = config.SUPABASE_SERVICE_ROLE_KEY;
      const origNodeEnv = config.NODE_ENV;
      try {
        config.NODE_ENV = 'production';
        config.SUPABASE_SERVICE_ROLE_KEY = 'sbp_fake_anon_key_123';

        const dummyBuf = await sharp({
          create: { width: 300, height: 400, channels: 3, background: { r: 100, g: 100, b: 100 } }
        }).jpeg().toBuffer();

        await expect(processPaymentScreenshot(dummyBuf, 'test-anon-key-booking')).rejects.toThrow(
          /STORAGE_NOT_CONFIGURED/
        );
      } finally {
        config.SUPABASE_SERVICE_ROLE_KEY = origKey;
        config.NODE_ENV = (origNodeEnv as any) || 'test';
      }
    });

    it('health check endpoint safely reports storage status without leaking credentials', async () => {
      const healthRes = await request(app).get('/api/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body).toHaveProperty('storage');
      expect(healthRes.body.storage.provider).toBe('supabase');
      expect(healthRes.body.storage.bucket).toBe('payment-proofs');
      expect(healthRes.body).toHaveProperty('paymentProofStorageConfigured');
      expect(JSON.stringify(healthRes.body)).not.toContain('sb_secret');
      expect(JSON.stringify(healthRes.body)).not.toContain('postgres:');
    });

    it('admin signed screenshot URL uses Supabase signed URL and remains private', async () => {
      const origFetch = global.fetch;
      try {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            signedURL: '/object/sign/payment-proofs/BK-1/hash.jpg?token=temp-jwt-token',
          }),
        } as any);

        const signed = await getSignedScreenshotUrl('supabase:BK-1/hash.jpg', 300);
        expect(signed).toContain('token=temp-jwt-token');
        expect(signed).not.toContain('sb_secret');
      } finally {
        global.fetch = origFetch;
      }
    });
  });

  describe('Phase 14: Deterministic Code-Only Local OCR Verification Engine', () => {
    describe('Receipt Parsing Unit Tests (PhonePe, Google Pay, Paytm, Other)', () => {
      it('parses PhonePe receipt text accurately', () => {
        const text = `
          Payment Successful
          ₹50
          Paid to Yuva Shakti
          UPI Ref No: 123456789012
          15 Sep 2026, 1:24 AM
        `;
        const normalized = normalizeOcrText(text);
        const status = extractPaymentStatus(normalized);
        const amount = extractAmount(normalized, 50);
        const ref = extractPaymentReference(normalized);
        const ts = extractTransactionTimestamp(normalized);

        expect(status.status).toBe('success');
        expect(amount.amount).toBe(50);
        expect(ref.utrOrRrn).toBe('123456789012');
        expect(ts.timestampIso).not.toBeNull();
      });

      it('parses Google Pay receipt text accurately', () => {
        const text = `
          Payment complete
          ₹100.00
          UPI transaction ID
          234567890123
          15 Sept 2026 01:26 AM
        `;
        const normalized = normalizeOcrText(text);
        const status = extractPaymentStatus(normalized);
        const amount = extractAmount(normalized, 100);
        const ref = extractPaymentReference(normalized);
        const ts = extractTransactionTimestamp(normalized);

        expect(status.status).toBe('success');
        expect(amount.amount).toBe(100);
        expect(ref.utrOrRrn).toBe('234567890123');
        expect(ts.timestampIso).not.toBeNull();
      });

      it('parses Paytm receipt text accurately', () => {
        const text = `
          Payment Successful
          ₹ 50.00
          Sent to 7075920852@ybl
          UPI Ref: 345678901234
          15-09-2026 01:24 AM
        `;
        const normalized = normalizeOcrText(text);
        const status = extractPaymentStatus(normalized);
        const amount = extractAmount(normalized, 50);
        const ref = extractPaymentReference(normalized);
        const upi = extractUpiId(normalized);

        expect(status.status).toBe('success');
        expect(amount.amount).toBe(50);
        expect(ref.utrOrRrn).toBe('345678901234');
        expect(upi.upiId).toBe('7075920852@ybl');
      });

      it('parses Bank Reference Number / RRN label variations', () => {
        const text = `
          Transaction Success
          Amount: INR 50.00
          Bank Reference Number: 987654321098
        `;
        const normalized = normalizeOcrText(text);
        const ref = extractPaymentReference(normalized);
        expect(ref.utrOrRrn).toBe('987654321098');
      });

      it('prioritizes explicit FAILED over success words', () => {
        const text = `
          Payment Failed
          Payment processing completed
          ₹50.00
        `;
        const normalized = normalizeOcrText(text);
        const status = extractPaymentStatus(normalized);
        expect(status.status).toBe('failed');
      });

      it('applies controlled numeric normalization for RRN digits without corrupting words', () => {
        const text = `
          UTR: 1O23456789O1
        `;
        const normalized = normalizeOcrText(text);
        const ref = extractPaymentReference(normalized);
        expect(ref.utrOrRrn).toBe('102345678901');
      });
    });

    describe('Verification Integration Scenarios (14 Scenarios)', () => {
      it('Scenario 1: valid ₹50 screenshot OCR -> accepted and coupons issued', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Valid User', phone: '9848011111', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(101);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 111122223333',
          normalizedText: 'Payment Successful ₹50 UTR: 111122223333',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '111122223333',
          transactionId: 'T101',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Valid User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('payment_confirmed');
        expect(res.body.data.coupons.length).toBe(1);
      });

      it('Scenario 2: quantity 2 + ₹100 -> accepted', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Double Buyer', phone: '9848022222', village: 'Satulur', quantity: 2 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(102);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹100 UTR: 222233334444',
          normalizedText: 'Payment Successful ₹100 UTR: 222233334444',
          paymentStatus: 'success',
          amount: 100.00,
          amountText: '100.00',
          utrOrRrn: '222233334444',
          transactionId: 'T102',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Double Buyer',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('payment_confirmed');
        expect(res.body.data.coupons.length).toBe(2);
      });

      it('Scenario 3: quantity 2 + ₹50 -> AMOUNT_MISMATCH', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Underpayer', phone: '9848033333', village: 'Satulur', quantity: 2 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(103);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 333344445555',
          normalizedText: 'Payment Successful ₹50 UTR: 333344445555',
          paymentStatus: 'success',
          amount: 50.00, // Expected 100!
          amountText: '50.00',
          utrOrRrn: '333344445555',
          transactionId: 'T103',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Underpayer',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('AMOUNT_MISMATCH');
      });

      it('Scenario 4: success + missing RRN -> MISSING_PAYMENT_REFERENCE', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'No RRN User', phone: '9848044444', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(104);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50',
          normalizedText: 'Payment Successful ₹50',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: null, // missing RRN
          transactionId: null,
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'No RRN User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('MISSING_PAYMENT_REFERENCE');
      });

      it('Scenario 5: failed transaction -> STATUS_NOT_SUCCESS', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Failed User', phone: '9848055555', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(105);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Failed ₹50 UTR: 555566667777',
          normalizedText: 'Payment Failed ₹50 UTR: 555566667777',
          paymentStatus: 'failed',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '555566667777',
          transactionId: 'T105',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Failed User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('STATUS_NOT_SUCCESS');
      });

      it('Scenario 6: pending transaction -> STATUS_NOT_SUCCESS', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Pending User', phone: '9848066666', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(106);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Processing ₹50 UTR: 666677778888',
          normalizedText: 'Payment Processing ₹50 UTR: 666677778888',
          paymentStatus: 'pending',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '666677778888',
          transactionId: 'T106',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Pending User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('STATUS_NOT_SUCCESS');
      });

      it('Scenario 7: duplicate RRN -> DUPLICATE_PAYMENT_REFERENCE', async () => {
        // First booking succeeds
        const bRes1 = await request(app)
          .post('/api/bookings')
          .send({ name: 'User One', phone: '9848077777', village: 'Satulur', quantity: 1 });
        const b1 = bRes1.body.data;
        const img1 = await createValidScreenshotBase64(1071);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 777711112222',
          normalizedText: 'Payment Successful ₹50 UTR: 777711112222',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '777711112222',
          transactionId: 'T1071',
          transactionDate: null,
          transactionTime: null,
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'User One',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        await request(app)
          .post(`/api/bookings/${b1.booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${b1.payment.statusToken}`)
          .send({ screenshotBase64: img1, consentGiven: true });

        // Second booking attempts same RRN
        const bRes2 = await request(app)
          .post('/api/bookings')
          .send({ name: 'User Two', phone: '9848077778', village: 'Satulur', quantity: 1 });
        const b2 = bRes2.body.data;
        const img2 = await createValidScreenshotBase64(1072);

        const res2 = await request(app)
          .post(`/api/bookings/${b2.booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${b2.payment.statusToken}`)
          .send({ screenshotBase64: img2, consentGiven: true });

        expect(res2.status).toBe(400);
        expect(res2.body.error.reasonCodes).toContain('DUPLICATE_PAYMENT_REFERENCE');
      });

      it('Scenario 8: same screenshot for another finalized booking -> DUPLICATE_SCREENSHOT', async () => {
        // First booking
        const bRes1 = await request(app)
          .post('/api/bookings')
          .send({ name: 'Owner', phone: '9848088881', village: 'Satulur', quantity: 1 });
        const b1 = bRes1.body.data;
        const sameImg = await createValidScreenshotBase64(1088);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 888811112222',
          normalizedText: 'Payment Successful ₹50 UTR: 888811112222',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '888811112222',
          transactionId: 'T1088',
          transactionDate: null,
          transactionTime: null,
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Owner',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        await request(app)
          .post(`/api/bookings/${b1.booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${b1.payment.statusToken}`)
          .send({ screenshotBase64: sameImg, consentGiven: true });

        // Second booking uses exact same screenshot image
        const bRes2 = await request(app)
          .post('/api/bookings')
          .send({ name: 'Copycat', phone: '9848088882', village: 'Satulur', quantity: 1 });
        const b2 = bRes2.body.data;

        // Even with a different UTR mock, duplicate screenshot SHA256 must reject
        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 888899990000',
          normalizedText: 'Payment Successful ₹50 UTR: 888899990000',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '888899990000',
          transactionId: 'T1089',
          transactionDate: null,
          transactionTime: null,
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Copycat',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res2 = await request(app)
          .post(`/api/bookings/${b2.booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${b2.payment.statusToken}`)
          .send({ screenshotBase64: sameImg, consentGiven: true });

        expect(res2.status).toBe(400);
        expect(res2.body.error.reasonCodes).toContain('DUPLICATE_SCREENSHOT');
      });

      it('Scenario 9: clear different payee UPI -> WRONG_PAYEE', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Wrong Payee User', phone: '9848099991', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(109);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 to someoneelse@okhdfcbank UTR: 999900001111',
          normalizedText: 'Payment Successful ₹50 to someoneelse@okhdfcbank UTR: 999900001111',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '999900001111',
          transactionId: 'T109',
          transactionDate: null,
          transactionTime: null,
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Someone Else Store',
          payeeUpiId: 'someoneelse@okhdfcbank', // Clearly wrong recipient!
          payerName: 'Wrong Payee User',
          detectedApp: 'google_pay',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('WRONG_PAYEE');
      });

      it('Scenario 10: bad/blurry/empty screenshot -> OCR_UNREADABLE', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Blurry User', phone: '9848099992', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(110);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: '   ',
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
          extractedFields: {},
          warnings: ['OCR_UNREADABLE'],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('OCR_UNREADABLE');
        expect(res.body.error.message).toContain("We couldn't clearly read this screenshot");
      });

      it('Scenario 11: OCR engine crash -> ocr_processing_error (NOT payment rejection)', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Engine Crash User', phone: '9848099993', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(111);

        setMockOcrResult({
          analysisCompleted: false, // Engine failed
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
          extractedFields: {},
          warnings: ['OCR_PROCESSING_ERROR'],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        // Must return 200 with retryable ocr_processing_error state, NOT payment rejection 400!
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('ocr_processing_error');
        expect(res.body.data.retryable).toBe(true);
        expect(res.body.data.message).toContain("We couldn't process this receipt right now");

        // Verify DB booking is NOT rejected
        const dbB = await db.query('SELECT status FROM bookings WHERE public_id = $1', [booking.publicId]);
        expect(dbB.rows[0].status).toBe('proof_submitted');
      });

      it('Scenario 12: transaction clearly before booking -> TRANSACTION_TIME_MISMATCH', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Time Mismatch User', phone: '9848099994', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(112);

        // Transaction timestamp is 3 hours before booking
        const oldTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 121234345656',
          normalizedText: 'Payment Successful ₹50 UTR: 121234345656',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '121234345656',
          transactionId: 'T112',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: oldTimestamp,
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Time Mismatch User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const res = await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        expect(res.status).toBe(400);
        expect(res.body.error.reasonCodes).toContain('TRANSACTION_TIME_MISMATCH');
      });

      it('Scenario 13: retry stored proof via POST /api/bookings/:publicId/retry-verification generates coupon', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Retry Proof User', phone: '9848099995', village: 'Satulur', quantity: 1 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(113);

        // Initial attempt has OCR error
        setMockOcrResult({
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
          extractedFields: {},
          warnings: ['OCR_PROCESSING_ERROR'],
        });

        await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        // Now OCR is successful on retry
        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹50 UTR: 991122334455',
          normalizedText: 'Payment Successful ₹50 UTR: 991122334455',
          paymentStatus: 'success',
          amount: 50.00,
          amountText: '50.00',
          utrOrRrn: '991122334455',
          transactionId: 'T113',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Retry Proof User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        const retryRes = await request(app)
          .post(`/api/bookings/${booking.publicId}/retry-verification`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({});

        expect(retryRes.status).toBe(200);
        expect(retryRes.body.success).toBe(true);
        expect(retryRes.body.data.status).toBe('payment_confirmed');
        expect(retryRes.body.data.coupons.length).toBe(1);

        const coupons = await db.query('SELECT * FROM coupons WHERE booking_id = $1', [booking.id]);
        expect(coupons.rows.length).toBe(1);
      });

      it('Scenario 14: repeated retry calls -> idempotent, no duplicate coupons', async () => {
        const bRes = await request(app)
          .post('/api/bookings')
          .send({ name: 'Idempotent Retry User', phone: '9848099996', village: 'Satulur', quantity: 2 });
        const { booking, payment } = bRes.body.data;
        const validImg = await createValidScreenshotBase64(114);

        setMockOcrResult({
          analysisCompleted: true,
          rawText: 'Payment Successful ₹100 UTR: 887766554433',
          normalizedText: 'Payment Successful ₹100 UTR: 887766554433',
          paymentStatus: 'success',
          amount: 100.00,
          amountText: '100.00',
          utrOrRrn: '887766554433',
          transactionId: 'T114',
          transactionDate: '15 Sep 2026',
          transactionTime: '01:24 AM',
          transactionTimestamp: new Date().toISOString(),
          payeeName: 'Yuva Shakti Youth Satulur',
          payeeUpiId: '7075920852@ybl',
          payerName: 'Idempotent Retry User',
          detectedApp: 'phonepe',
          extractedFields: {},
          warnings: [],
        });

        // Submit initial proof
        await request(app)
          .post(`/api/bookings/${booking.publicId}/payment-proof`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({ screenshotBase64: validImg, consentGiven: true });

        // Call retry-verification 3 times
        const r1 = await request(app)
          .post(`/api/bookings/${booking.publicId}/retry-verification`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({});
        const r2 = await request(app)
          .post(`/api/bookings/${booking.publicId}/retry-verification`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({});
        const r3 = await request(app)
          .post(`/api/bookings/${booking.publicId}/retry-verification`)
          .set('Authorization', `Bearer ${payment.statusToken}`)
          .send({});

        expect(r1.body.data.status).toBe('payment_confirmed');
        expect(r2.body.data.status).toBe('payment_confirmed');
        expect(r3.body.data.status).toBe('payment_confirmed');

        const coupons = await db.query('SELECT * FROM coupons WHERE booking_id = $1', [booking.id]);
        expect(coupons.rows.length).toBe(2);
      });
    });
  });
});
