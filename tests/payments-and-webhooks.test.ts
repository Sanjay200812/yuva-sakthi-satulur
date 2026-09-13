import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../server.ts';
import { config } from '../server/config/eventConfig.ts';
import { VyaparGatewayProvider } from '../server/payments/vyaparGateway.ts';

describe('Phase 11: Payments and Signed Webhooks', () => {
  it('rejects webhooks with missing signature', async () => {
    const payload = JSON.stringify({ client_txn_id: 'ORD_123', status: 'success' });
    const res = await request(app)
      .post('/api/payments/vyapar-gateway/webhook')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('rejects webhooks with tampered/invalid signature', async () => {
    const payload = JSON.stringify({ client_txn_id: 'ORD_123', status: 'success' });
    const res = await request(app)
      .post('/api/payments/vyapar-gateway/webhook')
      .set('Content-Type', 'application/json')
      .set('x-vyapargateway-signature', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('rejects webhooks older than 5 minutes tolerance', async () => {
    const secret = 'test_webhook_secret_key_12345';
    config.VYAPAR_GATEWAY_WEBHOOK_SECRET = secret;

    const staleTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    const payload = JSON.stringify({
      client_txn_id: 'ORD_9999',
      status: 'success',
      timestamp: staleTime,
    });

    const rawBuffer = Buffer.from(payload, 'utf8');
    const provider = new VyaparGatewayProvider();

    const verification = await provider.verifyWebhook({
      rawBody: rawBuffer,
      headers: {
        'x-vyapargateway-signature': crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex'),
        'x-vyapargateway-timestamp': String(staleTime),
      },
    });

    expect(verification.isValid).toBe(false);
    expect(verification.reason).toContain('5-minute tolerance');
  });

  it('completes end-to-end booking, payment confirmation, and status polling', async () => {
    // 1. Create booking
    const bookingRes = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Venkata Rao',
        phone: '9574876369',
        village: 'Satulur',
        quantity: 2,
      });

    expect(bookingRes.status).toBe(200);
    const { booking, payment } = bookingRes.body.data;
    expect(booking.quantity).toBe(2);
    expect(booking.totalAmount).toBe(100);

    // 2. Poll initial status -> should be payment_pending
    const statusRes1 = await request(app)
      .get(`/api/bookings/${booking.publicId}/status?token=${payment.statusToken}`);
    expect(statusRes1.status).toBe(200);
    expect(statusRes1.body.data.status).toBe('payment_pending');
    expect(statusRes1.body.data.coupons.length).toBe(0); // Zero coupons allocated before payment!

    // 3. Confirm payment in test mode
    const confirmRes = await request(app)
      .post('/api/test-mode/simulate-payment')
      .send({ clientTxnId: payment.clientTxnId });
    expect(confirmRes.status).toBe(200);

    // 4. Poll status again -> should be payment_confirmed with exactly 2 unique coupons
    const statusRes2 = await request(app)
      .get(`/api/bookings/${booking.publicId}/status?token=${payment.statusToken}`);
    expect(statusRes2.status).toBe(200);
    expect(statusRes2.body.data.status).toBe('payment_confirmed');
    expect(statusRes2.body.data.coupons.length).toBe(2);

    const [c1, c2] = statusRes2.body.data.coupons;
    expect(c1.coupon_number).not.toBe(c2.coupon_number);
    expect(c1.coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);
    expect(c2.coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);
  });

  it('supports instant real-time status polling via GET /api/payment/status?order_id=...', async () => {
    // 1. Create a booking
    const bookingRes = await request(app)
      .post('/api/bookings')
      .send({
        name: 'Sita Devi',
        phone: '9848012345',
        village: 'Satulur',
        quantity: 1,
      });

    expect(bookingRes.status).toBe(200);
    const { booking, payment } = bookingRes.body.data;
    const orderId = payment.orderId || payment.clientTxnId;

    // 2. Poll /api/payment/status?order_id=... -> should be PENDING
    const statusPending = await request(app).get(`/api/payment/status?order_id=${orderId}`);
    expect(statusPending.status).toBe(200);
    expect(statusPending.body.status).toBe('PENDING');

    // 3. Confirm via /api/test-mode/simulate-payment
    await request(app)
      .post('/api/test-mode/simulate-payment')
      .send({ clientTxnId: payment.clientTxnId });

    // 4. Poll again -> should be SUCCESS with confirmed booking & coupons
    const statusSuccess = await request(app).get(`/api/payment/status?order_id=${orderId}`);
    expect(statusSuccess.status).toBe(200);
    expect(statusSuccess.body.status).toBe('SUCCESS');
    expect(statusSuccess.body.booking).toBeDefined();
    expect(statusSuccess.body.booking.coupons.length).toBe(1);
    expect(statusSuccess.body.booking.coupons[0].coupon_number).toMatch(/^YSYS-\d{4}-\d{6}$/);
  });
});
