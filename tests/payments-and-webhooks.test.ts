import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../server.ts';
import { generateCanonicalUpiUri } from '../server/upi/upiUri.ts';
import { validateScreenshotBuffer } from '../server/upi/imageProcessor.ts';
import { performDeterministicComparison } from '../server/upi/deterministicMatcher.ts';
import { setMockGeminiExtraction } from '../server/upi/geminiAnalyzer.ts';
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
    setMockGeminiExtraction(null);
  });

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

    // Provide OCR extraction with valid reference number
    setMockGeminiExtraction({
      looks_like_payment_screen: true,
      visible_payment_status: 'success',
      app_name: 'phonepe',
      amount: '50.00',
      currency: 'INR',
      payee_name: 'Yuva Shakti Youth Satulur',
      payee_upi_id: '7075920852@ybl',
      payer_name: 'Nagaraju',
      utr_or_rrn: '523489123456',
      transaction_id: 'T2609140101',
      transaction_timestamp: new Date().toISOString(),
      obvious_editing_signals: [],
      ai_generated_likelihood: 'low',
      field_confidence: {
        amount: 0.98,
        payee: 0.95,
        utr: 0.96,
        status: 0.99,
        timestamp: 0.92,
      },
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
    setMockGeminiExtraction({
      looks_like_payment_screen: true,
      visible_payment_status: 'success',
      app_name: 'google_pay',
      amount: '50.00',
      currency: 'INR',
      payee_name: 'Yuva Shakti Youth Satulur',
      payee_upi_id: '7075920852@ybl',
      payer_name: 'Sudha Rani',
      utr_or_rrn: null, // RRN missing from screenshot
      transaction_id: null,
      transaction_timestamp: new Date().toISOString(),
      obvious_editing_signals: [],
      ai_generated_likelihood: 'low',
      field_confidence: {
        amount: 0.95,
        payee: 0.90,
        utr: 0,
        status: 0.95,
        timestamp: 0.85,
      },
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
    expect(res.body.error.code).toBe('AI_CHECK_FAILED');
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

    setMockGeminiExtraction({
      looks_like_payment_screen: true,
      visible_payment_status: 'success',
      app_name: 'phonepe',
      amount: '50.00',
      currency: 'INR',
      payee_name: 'Yuva Shakti Youth Satulur',
      payee_upi_id: '7075920852@ybl',
      payer_name: 'First User',
      utr_or_rrn: '425511223344',
      transaction_id: 'T1001',
      transaction_timestamp: new Date().toISOString(),
      obvious_editing_signals: [],
      ai_generated_likelihood: 'low',
      field_confidence: { amount: 0.98, payee: 0.95, utr: 0.95, status: 0.99, timestamp: 0.9 },
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

    setMockGeminiExtraction({
      looks_like_payment_screen: true,
      visible_payment_status: 'success',
      app_name: 'phonepe',
      amount: '50.00',
      currency: 'INR',
      payee_name: 'Yuva Shakti Youth Satulur',
      payee_upi_id: '7075920852@ybl',
      payer_name: 'Second User',
      utr_or_rrn: '425511223344', // Reused reference!
      transaction_id: 'T1002',
      transaction_timestamp: new Date().toISOString(),
      obvious_editing_signals: [],
      ai_generated_likelihood: 'low',
      field_confidence: { amount: 0.98, payee: 0.95, utr: 0.95, status: 0.99, timestamp: 0.9 },
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
    setMockGeminiExtraction({
      looks_like_payment_screen: true,
      visible_payment_status: 'success',
      app_name: 'phonepe',
      amount: '100.00',
      currency: 'INR',
      payee_name: 'Yuva Shakti Youth Satulur',
      payee_upi_id: '7075920852@ybl',
      payer_name: 'Amount Mismatch User',
      utr_or_rrn: '778899001122',
      transaction_id: 'T1003',
      transaction_timestamp: new Date().toISOString(),
      obvious_editing_signals: [],
      ai_generated_likelihood: 'low',
      field_confidence: { amount: 0.98, payee: 0.95, utr: 0.95, status: 0.99, timestamp: 0.9 },
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
    expect(res.body.error.message).toBe('Payment amount does not match.');
  });

  it('deterministic comparison fails when OCR amount or OCR RRN is missing', () => {
    // Missing OCR amount
    const noAmountRes = performDeterministicComparison({
      expectedAmountPaise: 5000,
      expectedPayeeUpiId: '9574876369@ybl',
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
      expectedPayeeUpiId: '9574876369@ybl',
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
      expectedPayeeUpiId: '9574876369@ybl',
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
      expectedPayeeUpiId: '9574876369@ybl',
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
      expectedPayeeUpiId: '9574876369@ybl',
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

    setMockGeminiExtraction({
      looks_like_payment_screen: true,
      visible_payment_status: 'success',
      app_name: 'phonepe',
      amount: '150.00',
      currency: 'INR',
      payee_name: 'Yuva Shakti Youth Satulur',
      payee_upi_id: '7075920852@ybl',
      payer_name: 'Triad Buyer',
      utr_or_rrn: '334455667788',
      transaction_id: 'T3001',
      transaction_timestamp: new Date().toISOString(),
      obvious_editing_signals: [],
      ai_generated_likelihood: 'low',
      field_confidence: { amount: 0.98, payee: 0.95, utr: 0.95, status: 0.99, timestamp: 0.9 },
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
});
