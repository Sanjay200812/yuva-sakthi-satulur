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

  it('calculates amount strictly on server at ₹50 per coupon and ignores client tampering', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Suresh Babu',
        phone: '9876543210',
        village: 'Satulur Center',
        quantity: 3,
        amount: 1, // Client attempting price tampering!
        price: 0,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Server must calculate 3 * 50 = 150
    expect(res.body.data.booking.totalAmount).toBe(150);
    expect(res.body.data.booking.quantity).toBe(3);
    expect(res.body.data.booking.status).toBe('payment_initiated');
  });

  it('returns safe public configuration from /api/config', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.couponPrice).toBe(50);
    expect(res.body.prize).toBe('20 KG Laddu');
    expect(res.body.canBook).toBe(true);
    expect(res.body).not.toHaveProperty('databaseUrl');
    expect(res.body).not.toHaveProperty('sessionSecret');
  });
});
