import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.ts';
import { generateUpiPaymentSession, generateCanonicalUpiUri } from '../server/upi/upiUri.ts';
import { validateScreenshotBuffer } from '../server/upi/imageProcessor.ts';
import { performDeterministicComparison } from '../server/upi/deterministicMatcher.ts';
import { finalizeVerifiedSubmission } from '../server/upi/automatedFinalizer.ts';
import { db } from '../server/db/client.ts';

// 1x1 valid PNG pixel buffer
const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Phase 11: Direct UPI Collection & Automated Proof Verification Pipeline', () => {
  it('generates canonical NPCI UPI URI with fixed am, unique reference, and no mam', () => {
    const uri = generateCanonicalUpiUri({
      payeeUpiId: '9574876369@ybl',
      payeeDisplayName: 'Yuva Shakti Youth, Satulur',
      transactionReference: 'YSYS-REF-101',
      totalAmountPaise: 5000,
      note: 'YSYS Satulur Draw BK-123456',
    });

    expect(uri).toContain('upi://pay?');
    expect(uri).toContain('pa=9574876369%40ybl');
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

    // Submitting without statusToken
    const res = await request(app)
      .post(`/api/bookings/${publicId}/payment-proof`)
      .send({
        utr: '123456789012',
        screenshotBase64: samplePngBase64,
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

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        utr: '123456789012',
        screenshotBase64: samplePngBase64,
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PAYMENT_SESSION_EXPIRED');
  });

  it('strictly validates 12-digit numeric UPI RRN and rejects non-12-digit inputs', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    // Test 6-digit old format
    const res6 = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        utr: '123456',
        screenshotBase64: samplePngBase64,
        consentGiven: true,
      });
    expect(res6.status).toBe(400);
    expect(res6.body.error.code).toBe('INVALID_RRN');

    // Test 11 digits
    const res11 = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        utr: '12345678901',
        screenshotBase64: samplePngBase64,
        consentGiven: true,
      });
    expect(res11.status).toBe(400);
    expect(res11.body.error.code).toBe('INVALID_RRN');

    // Test alphanumeric characters
    const resAlpha = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        utr: '12345678901A',
        screenshotBase64: samplePngBase64,
        consentGiven: true,
      });
    expect(resAlpha.status).toBe(400);
    expect(resAlpha.body.error.code).toBe('INVALID_RRN');
  });

  it('blocks payment proof submission when consent is missing', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const res = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        utr: '123456789012',
        screenshotBase64: samplePngBase64,
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
        utr: '123456789012',
        screenshotBase64: '',
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_SCREENSHOT');

    // Executable/fake image buffer test
    const fakeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary');
    await expect(validateScreenshotBuffer(fakeBuffer)).rejects.toThrow();
  });

  it('deterministic comparison fails when OCR amount or OCR RRN is missing', () => {
    // Missing OCR amount
    const noAmountRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '9574876369@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      enteredUtr: '123456789012',
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
      expectedPayeeUpiId: '9574876369@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      enteredUtr: '123456789012',
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
    expect(noRrnRes.reasonCodes).toContain('MISSING_RRN');
  });

  it('deterministic comparison fails for failed/pending payment status or tampering/AI indicators', () => {
    // Visible status is pending or failed
    const pendingRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '9574876369@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      enteredUtr: '123456789012',
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
      expectedPayeeUpiId: '9574876369@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      enteredUtr: '123456789012',
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
      expectedPayeeUpiId: '9574876369@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      enteredUtr: '123456789012',
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

  it('confirms that legacy gateway webhook endpoints are completely removed (404)', async () => {
    const resVyapar = await request(app).post('/api/payments/vyapar-gateway/webhook').send({});
    expect(resVyapar.status).toBe(404);

    const resRazorpay = await request(app).post('/api/razorpay/webhook').send({});
    expect(resRazorpay.status).toBe(404);
  });
});
