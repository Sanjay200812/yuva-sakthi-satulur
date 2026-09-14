import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.ts';

describe('Phase 11: Booking and Pricing Validation', () => {
  it('rejects empty or invalid participant name', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: ' ',
        phone: '9876543210',
        village: 'Satulur',
        quantity: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_NAME');
  });

  it('rejects invalid or non-Indian mobile numbers', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Ramesh Reddy',
        phone: '12345',
        village: 'Satulur',
        quantity: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_PHONE');
  });

  it('rejects zero, negative, or excessive quantities', async () => {
    const resZero = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Ramesh Reddy',
        phone: '9876543210',
        village: 'Satulur',
        quantity: 0,
      });
    expect(resZero.status).toBe(400);

    const resExcess = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Ramesh Reddy',
        phone: '9876543210',
        village: 'Satulur',
        quantity: 999,
      });
    expect(resExcess.status).toBe(400);
  });

  it('calculates amount strictly on server at ₹50 per coupon: 2 coupons = exactly ₹100', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Srinivasa Rao',
        phone: '9876543210',
        village: 'Satulur Center',
        quantity: 2,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.booking.quantity).toBe(2);
    expect(res.body.data.booking.totalAmount).toBe(100);
    expect(res.body.data.payment.amountInr).toBe('100.00');
  });

  it('calculates amount strictly on server and completely ignores client amount tampering', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Suresh Babu',
        phone: '9876543210',
        village: 'Satulur Center',
        quantity: 3,
        amount: 1, // Client attempting price tampering!
        price: 0,
        total: 5,
        totalAmountPaise: 100,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Server must calculate 3 * 50 = 150
    expect(res.body.data.booking.totalAmount).toBe(150);
    expect(res.body.data.booking.quantity).toBe(3);
    expect(res.body.data.booking.status).toBe('payment_initiated');
    expect(res.body.data.payment.amountInr).toBe('150.00');
  });

  it('enforces a 5-minute payment session on the server and returns exact expiresAt', async () => {
    const beforeTime = Date.now();
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Lakshmi Narayana',
        phone: '9876543210',
        village: 'Satulur',
        quantity: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.payment).toHaveProperty('expiresAt');

    const expiresAtMs = new Date(res.body.data.payment.expiresAt).getTime();
    // Expiry should be approximately 5 minutes (300,000 ms) from now (+/- 10s)
    const diffMs = expiresAtMs - beforeTime;
    expect(diffMs).toBeGreaterThanOrEqual(290000);
    expect(diffMs).toBeLessThanOrEqual(315000);
  });

  it('protects private booking status: guessing public booking ID without statusToken returns 401', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Private User',
        phone: '9848011223',
        village: 'Satulur Secret',
        quantity: 1,
      });
    const publicId = res.body.data.booking.publicId;
    const statusToken = res.body.data.payment.statusToken;

    // Attacker attempting to access private booking details using only the 6-digit public ID
    const unauthRes = await request(app).get(`/api/bookings/${publicId}/status`);
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.success).toBe(false);

    // Legitimate client with statusToken in Authorization header
    const authRes = await request(app)
      .get(`/api/bookings/${publicId}/status`)
      .set('Authorization', `Bearer ${statusToken}`);
    expect(authRes.status).toBe(200);
    expect(authRes.body.success).toBe(true);
    expect(authRes.body.data.publicId).toBe(publicId);
  });

  it('returns safe public configuration from /api/config', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.couponPrice).toBe(50);
    expect(res.body.prize).toBe('20 KG Laddu');
    expect(res.body.canBook).toBe(true);
    expect(res.body).not.toHaveProperty('databaseUrl');
    expect(res.body).not.toHaveProperty('sessionSecret');
    expect(res.body).not.toHaveProperty('fieldEncryptionKey');
  });
});
