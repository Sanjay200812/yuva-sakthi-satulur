import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.ts';
import { generateUpiPaymentSession, generateCanonicalUpiUri } from '../server/upi/upiUri.ts';
import { validateScreenshotBuffer } from '../server/upi/imageProcessor.ts';
import { performDeterministicComparison } from '../server/upi/deterministicMatcher.ts';
import { config } from '../server/config/eventConfig.ts';

// 1x1 valid PNG pixel buffer
const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Phase 11: Direct UPI Collection & Automated Proof Verification Pipeline', () => {
  it('generates canonical NPCI UPI URI with trusted amount and unique reference', () => {
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
  });

  it('creates booking with server-calculated amount and dynamic UPI QR session', async () => {
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
    expect(payment.canonicalUri).toContain('cu=INR');
    expect(payment.appIntents).toHaveProperty('phonepe');
    expect(payment.appIntents).toHaveProperty('google_pay');
    expect(payment.appIntents).toHaveProperty('paytm');
    expect(payment.appIntents).toHaveProperty('fam');
  });

  it('blocks payment proof submission when consent is missing', async () => {
    // 1. Create booking
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const publicId = bRes.body.data.booking.publicId;

    // 2. Submit without consent
    const res = await request(app)
      .post(`/api/bookings/${publicId}/payment-proof`)
      .send({
        utr: '123456789012',
        screenshotBase64: samplePngBase64,
        consentGiven: false,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('blocks payment proof submission when UTR is missing or invalid', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const publicId = bRes.body.data.booking.publicId;

    const res = await request(app)
      .post(`/api/bookings/${publicId}/payment-proof`)
      .send({
        utr: '  ',
        screenshotBase64: samplePngBase64,
        consentGiven: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_UTR');
  });

  it('blocks payment proof submission when screenshot is missing or not an image', async () => {
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Anil', phone: '9848012345', village: 'Satulur', quantity: 1 });
    const publicId = bRes.body.data.booking.publicId;

    const res = await request(app)
      .post(`/api/bookings/${publicId}/payment-proof`)
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

  it('deterministic comparison catches UTR mismatch and amount mismatch', () => {
    const mismatchRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '9574876369@ybl',
      expectedPayeeName: 'Yuva Shakti Youth, Satulur',
      enteredUtr: '123456789012',
      selectedApp: 'phonepe',
      extraction: {
        looks_like_payment_screen: true,
        visible_payment_status: 'success',
        app_name: 'phonepe',
        amount: '100.00', // Mismatched amount!
        currency: 'INR',
        payee_name: null,
        payee_upi_id: null,
        payer_name: null,
        utr_or_rrn: '987654321098', // Mismatched UTR!
        transaction_id: null,
        transaction_timestamp: null,
        obvious_editing_signals: [],
        ai_generated_likelihood: 'low',
        field_confidence: { amount: 0.9, payee: 0.9, utr: 0.9, status: 0.9, timestamp: 0.9 },
      },
      isDuplicateUtr: false,
      isDuplicateScreenshot: false,
    });

    expect(mismatchRes.passed).toBe(false);
    expect(mismatchRes.nextStatus).toBe('verification_failed');
    expect(mismatchRes.reasonCodes).toContain('AMOUNT_MISMATCH');
    expect(mismatchRes.reasonCodes).toContain('UTR_MISMATCH');
  });

  it('deterministic comparison catches duplicate UTR and fails closed', () => {
    const dupRes = performDeterministicComparison({
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
      isDuplicateUtr: true, // Duplicate UTR detected in database!
      isDuplicateScreenshot: false,
    });

    expect(dupRes.passed).toBe(false);
    expect(dupRes.nextStatus).toBe('verification_failed');
    expect(dupRes.reasonCodes).toContain('DUPLICATE_UTR');
  });

  it('completes automated verification and allocates sequential coupons atomically', async () => {
    // 1. Create booking for 2 coupons (₹100)
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Kavitha Devi', phone: '9848099999', village: 'Satulur', quantity: 2 });
    const { booking, payment } = bRes.body.data;

    // 2. Poll initial status -> not yet verified
    const s1 = await request(app).get(`/api/bookings/${booking.publicId}/status`);
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

    // 4. Poll status again -> status is proof_verified and coupons are ready
    const s2 = await request(app).get(`/api/bookings/${booking.publicId}/status`);
    expect(s2.status).toBe(200);
    expect(s2.body.data.status).toBe('proof_verified');
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
