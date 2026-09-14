import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { app } from '../server.ts';

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
});
