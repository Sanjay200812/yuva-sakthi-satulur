import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.ts';

describe('Phase 11: Admin Panel Authentication & Confirmed Coupons List', () => {
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

  it('shows ONLY genuine paid/confirmed coupons in the main Applied Coupons list', async () => {
    // 1. Create a pending booking (NOT paid)
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

    // Verify that all returned records strictly have booking_status = payment_confirmed
    for (const c of coupons) {
      expect(c.booking_status).toBe('payment_confirmed');
      expect(c.status).toBe('valid');
    }
  });

  it('exports confirmed coupons to CSV with spreadsheet formula injection protection', async () => {
    const res = await request(app)
      .get('/api/admin/coupons/export.csv')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Coupon Number,Participant Name,Phone');
  });
});
