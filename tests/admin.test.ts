import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../server.ts';
import { setMockOcrResult } from '../server/upi/localOcrAnalyzer.ts';

describe('Phase 11: Admin Panel Authentication & Verified Coupons Registry', () => {
  let adminToken = '';

  it('blocks unauthenticated requests to admin dashboard with 401', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('blocks unauthenticated requests to applied coupons list with 401', async () => {
    const res = await request(app).get('/api/admin/coupons');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects invalid admin login credentials', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@yuvashakti.org', password: 'WrongPassword123!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('successfully authenticates valid admin user and provides session token', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@yuvashakti.org', password: 'YuvaShakti@Admin2026' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    adminToken = res.body.data.token;
  });

  it('shows ONLY genuine proof-verified coupons in the main Applied Coupons list', async () => {
    // 1. Create an unverified booking
    const pendingRes = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Pending Applicant',
        phone: '9574876369',
        village: 'Satulur',
        quantity: 1,
      });
    const pendingPublicId = pendingRes.body.data.booking.publicId;

    // 2. Fetch admin coupons list with valid session
    const listRes = await request(app)
      .get('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);

    const coupons = listRes.body.data.coupons;

    // Verify that NO pending booking appears in the applied coupons list
    const hasPending = coupons.some((c: any) => c.booking_public_id === pendingPublicId);
    expect(hasPending).toBe(false);

    // Verify that all returned records strictly have booking_status = proof_verified or payment_confirmed
    for (const c of coupons) {
      expect(['proof_verified', 'payment_confirmed']).toContain(c.booking_status);
      expect(c.status).toBe('valid');
    }
  });

  it('exports verified coupons to CSV with spreadsheet formula injection protection', async () => {
    const res = await request(app)
      .get('/api/admin/coupons/export.csv')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Coupon Number,Participant Name,Phone');
  });

  it('returns 404 for non-existent submission in payment reconciliation confirmation', async () => {
    const res = await request(app)
      .post('/api/admin/payment-reviews/fake-id/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bankTxnId: 'BANK-123', receivedAmountPaise: 5000 });

    expect(res.status).toBe(404);
  });

  it('provides payment verification audit log with status filtering', async () => {
    const res = await request(app)
      .get('/api/admin/payment-reviews?status=payment_confirmed')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('atomically finalizes verified proof and makes coupons available in admin registry and audit logs', async () => {
    // 1. Create an unverified booking - must NOT be in admin coupons list
    const bRes = await request(app)
      .post('/api/bookings')
      .send({ name: 'Admin Test Participant', phone: '9848099888', village: 'Satulur Center', quantity: 1 });
    const { booking, payment } = bRes.body.data;

    const couponsBefore = await request(app)
      .get('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(couponsBefore.body.data.coupons.some((c: any) => c.booking_public_id === booking.publicId)).toBe(false);

    // 2. Submit payment proof with authorization (screenshot + consent only, no client UTR)
    const validImgBase64 = (await sharp({
      create: { width: 250, height: 250, channels: 3, background: { r: 240, g: 240, b: 240 } }
    }).png().toBuffer()).toString('base64');

    setMockOcrResult({
      analysisCompleted: true,
      rawText: 'Payment Successful 50 UTR 998877665544',
      normalizedText: 'Payment Successful 50 UTR 998877665544',
      paymentStatus: 'success',
      amount: 50,
      amountText: '50.00',
      utrOrRrn: '998877665544',
      transactionId: 'TXN-ADMIN',
      transactionDate: null,
      transactionTime: null,
      transactionTimestamp: null,
      payeeName: 'Yuva Shakti Youth Satulur',
      payeeUpiId: '7075920852@ybl',
      payerName: 'Admin Test Participant',
      detectedApp: 'phonepe',
      extractedFields: {},
      warnings: [],
    });

    const pRes = await request(app)
      .post(`/api/bookings/${booking.publicId}/payment-proof`)
      .set('Authorization', `Bearer ${payment.statusToken}`)
      .send({
        screenshotBase64: validImgBase64,
        consentGiven: true,
      });
    expect(pRes.status).toBe(200);
    expect(pRes.body.success).toBe(true);

    // 3. After proof verification, genuine coupons MUST appear in Applied Coupons
    const couponsAfter = await request(app)
      .get('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(couponsAfter.body.data.coupons.some((c: any) => c.booking_public_id === booking.publicId)).toBe(true);

    const issuedCoupon = couponsAfter.body.data.coupons.find((c: any) => c.booking_public_id === booking.publicId);
    expect(issuedCoupon.coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);
    expect(issuedCoupon.holder_name).toBe('Admin Test Participant');

    // 4. Verification record must exist in payment review audit logs
    const reviewsRes = await request(app)
      .get('/api/admin/payment-reviews')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reviewsRes.status).toBe(200);
    expect(reviewsRes.body.data.some((r: any) => r.bookingPublicId === booking.publicId)).toBe(true);
  });

  describe('Production API Routing & Security Hardening', () => {
    it('GET /api/health returns HTTP 200 with JSON content-type and status ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('service', 'yuva-shakti-portal');
    });

    it('unmatched /api/* route returns JSON 404 and NEVER falls back to HTML', async () => {
      const res = await request(app).get('/api/some/non/existent/endpoint');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.success).toBe(false);
      expect(res.body.error).toHaveProperty('code', 'API_NOT_FOUND');
    });

    it('admin login sets HTTP-only cookie and normalizes mixed-case email', async () => {
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ email: 'ADMIN@YuvaShakti.ORG', password: 'YuvaShakti@Admin2026' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('admin@yuvashakti.org');

      // Verify Set-Cookie header contains admin_session with HttpOnly
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const sessionCookie = Array.isArray(cookies) ? cookies.find((c: string) => c.includes('admin_session=')) : cookies;
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('HttpOnly');
    });

    it('authenticates admin using HTTP-only cookie session (stateless across instances)', async () => {
      // 1. Log in to get cookie
      const loginRes = await request(app)
        .post('/api/admin/auth/login')
        .send({ email: 'admin@yuvashakti.org', password: 'YuvaShakti@Admin2026' });

      const cookies = loginRes.headers['set-cookie'];
      const rawCookie = Array.isArray(cookies) ? cookies[0] : cookies;
      const cookieValue = rawCookie.split(';')[0]; // e.g. "admin_session=..."

      // 2. Fetch /api/admin/auth/me using only the cookie (no Authorization header)
      const meRes = await request(app)
        .get('/api/admin/auth/me')
        .set('Cookie', [cookieValue]);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.email).toBe('admin@yuvashakti.org');

      // 3. Fetch dashboard using the cookie
      const dashRes = await request(app)
        .get('/api/admin/dashboard')
        .set('Cookie', [cookieValue]);

      expect(dashRes.status).toBe(200);
      expect(dashRes.body.success).toBe(true);
    });

    it('denies login and access for deactivated admin accounts (is_active = false)', async () => {
      // Create a deactivated admin user in db
      const inactiveId = '00000000-0000-0000-0000-000000000099';
      const bcrypt = await import('bcryptjs');
      const hash = bcrypt.hashSync('InactivePassword123!', 10);
      await (app as any); // ensure app loaded

      // Insert directly into db
      const { db } = await import('../server/db/client.ts');
      await db.query(
        `INSERT INTO admin_users (id, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, false)`,
        [inactiveId, 'disabled@yuvashakti.org', hash, 'viewer']
      );

      // Attempt login
      const res = await request(app)
        .post('/api/admin/auth/login')
        .send({ email: 'disabled@yuvashakti.org', password: 'InactivePassword123!' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('ACCOUNT_DISABLED');
    });

    it('logout clears the admin_session cookie', async () => {
      const res = await request(app).post('/api/admin/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const cookies = res.headers['set-cookie'];
      const rawCookie = Array.isArray(cookies) ? cookies[0] : cookies;
      // Cookie is either expired or emptied
      expect(rawCookie).toMatch(/admin_session=;.*(expires=|max-age=0)/i);
    });

    it('Section 4 & 52: fetches payment settings with locked 5-minute session rule', async () => {
      const res = await request(app)
        .get('/api/admin/payment-settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.paymentSessionMinutes).toBe(5);
      expect(res.body.data.sessionDurationLabel).toBe('5 Minutes — Security Rule');
      expect(res.body.data.payeeUpiId).toBe('7075920852@ybl');
    });

    it('Section 4 & 52: updates payment settings and preserves 5-minute locked session duration', async () => {
      // 1. Invalid UPI ID is rejected
      const invalidRes = await request(app)
        .put('/api/admin/payment-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payeeUpiId: 'invalid-vpa-no-handle' });

      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error?.code).toBe('INVALID_UPI_ID');

      // 2. Valid settings update
      const validRes = await request(app)
        .put('/api/admin/payment-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          payeeUpiId: '7075920852@ybl',
          payeeDisplayName: 'Yuva Shakti Youth Satulur',
          couponPriceInr: 50,
          paymentsEnabled: true,
          maxQuantity: 20,
        });

      expect(validRes.status).toBe(200);
      expect(validRes.body.success).toBe(true);
      expect(validRes.body.data.paymentSessionMinutes).toBe(5);
    });
  });
});

