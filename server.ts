import express, { Request, Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';

import { config, getPublicConfig, canAcceptPayments } from './server/config/eventConfig.ts';
import { db } from './server/db/client.ts';
import { getPaymentProvider, VyaparGatewayProvider, MockPaymentProvider } from './server/payments/index.ts';
import { allocateCouponsForBooking } from './server/services/couponAllocator.ts';
import {
  renderTicketPdf,
  renderMultiTicketPdf,
  createTicketsZipArchive,
  maskPhoneNumber,
  formatKolkataTime,
} from './server/services/ticketRenderer.ts';
import adminRoutes from './server/admin/routes.ts';

const app = express();
const PORT = Number(config.PORT) || 3000;

// 1. Security Headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: false, // Vite inline scripts & styles in dev
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cookieParser());

// 2. CRITICAL: Raw-body parser for VyaparGateway Webhook BEFORE express.json()
app.post(
  ['/api/payment/webhook', '/api/payments/vyapar-gateway/webhook'],
  express.raw({ type: '*/*' }),
  async (req: Request, res: Response) => {
    try {
      const rawBody = req.body as Buffer;
      const provider = new VyaparGatewayProvider();

      const hasSignature = !!(
        req.headers['x-vyapargateway-signature'] ||
        req.headers['x-signature'] ||
        req.headers['x-hub-signature']
      );

      let verification;
      if (hasSignature || config.PAYMENT_MODE === 'live') {
        verification = await provider.verifyWebhook({
          rawBody,
          headers: req.headers as Record<string, string | string[] | undefined>,
        });

        if (!verification.isValid) {
          console.warn('⚠️ Rejected invalid webhook signature:', verification.reason);
          return res.status(401).json({ success: false, error: verification.reason });
        }
      } else {
        // Direct JSON callback fallback for testing
        let payload: any = {};
        try {
          payload = JSON.parse(rawBody.toString('utf8'));
        } catch {}
        const rawStatus = String(payload.status || payload.payment_status || '').toLowerCase();
        const isSuccess = ['success', 'paid', 'confirmed', 'completed'].includes(rawStatus);
        const clientTxnId = payload.client_txn_id || payload.order_id || payload.txn_id || '';
        verification = {
          isValid: true,
          providerEventId: payload.event_id || payload.payment_id || `ev_${clientTxnId || Date.now()}`,
          clientTxnId,
          providerPaymentId: payload.payment_id || payload.utr || payload.txn_id || 'PROV_PAID',
          status: isSuccess ? ('confirmed' as const) : ('failed' as const),
          amountPaise: payload.amount ? Math.round(Number(payload.amount) * 100) : 0,
          rawPayload: payload,
        };
      }

      // Check event idempotency
      const existingEvent = await db.query(
        'SELECT id FROM payment_events WHERE provider_event_id = $1',
        [verification.providerEventId]
      );

      if (existingEvent.rows.length > 0) {
        return res.json({ success: true, message: 'Event already processed.', order_id: verification.clientTxnId });
      }

      // Atomic Transaction to finalize booking and allocate coupons
      await db.withTransaction(async (client) => {
        // Find payment attempt
        const attemptRes = await client.query(
          'SELECT * FROM payment_attempts WHERE client_txn_id = $1 OR provider_order_id = $1',
          [verification.clientTxnId]
        );

        if (attemptRes.rows.length === 0) {
          throw new Error(`Payment attempt for txn ${verification.clientTxnId} not found`);
        }

        const attempt = attemptRes.rows[0];

        // Find booking
        const bookingRes = await client.query(
          'SELECT * FROM bookings WHERE id = $1',
          [attempt.booking_id]
        );

        if (bookingRes.rows.length === 0) {
          throw new Error(`Booking ${attempt.booking_id} not found`);
        }

        const booking = bookingRes.rows[0];

        if (verification.status === 'confirmed') {
          // 1. Update attempt
          await client.query(
            'UPDATE payment_attempts SET normalized_status = $1, provider_payment_id = $2 WHERE id = $3',
            ['confirmed', verification.providerPaymentId || 'PROV_PAID', attempt.id]
          );

          // 2. Update booking status
          const paidAt = new Date().toISOString();
          await client.query(
            'UPDATE bookings SET status = $1, paid_at = $2 WHERE id = $3',
            ['payment_confirmed', paidAt, booking.id]
          );

          // 3. Allocate coupons atomically
          await allocateCouponsForBooking(client, booking.id, () => db.getNextCouponSerial());

          // 4. Record event
          await client.query(
            `INSERT INTO payment_events (
              id, provider, provider_event_id, event_type, payload, processing_result
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              crypto.randomUUID(),
              'vyapar_gateway',
              verification.providerEventId,
              'payment.confirmed',
              verification.rawPayload,
              'SUCCESS_ALLOCATED',
            ]
          );
        } else {
          // Payment failed
          await client.query(
            'UPDATE payment_attempts SET normalized_status = $1 WHERE id = $2',
            ['failed', attempt.id]
          );

          await client.query(
            'UPDATE bookings SET status = $1 WHERE id = $2',
            ['payment_failed', booking.id]
          );
        }
      });

      return res.json({
        success: true,
        status: verification.status === 'confirmed' ? 'SUCCESS' : 'FAILED',
        order_id: verification.clientTxnId,
      });
    } catch (error: any) {
      console.error('Webhook processing failure:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// 2b. Real-Time Status Endpoint for Instant Polling (/api/payment/status?order_id=...)
app.get(['/api/payment/status', '/api/payment/webhook'], async (req: Request, res: Response) => {
  try {
    const orderId = (req.query.order_id || req.query.client_txn_id || req.query.id || req.query.public_id) as string;
    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_ORDER_ID', message: 'Please provide an order_id or client_txn_id parameter.' },
      });
    }

    // 1. Lookup payment attempt
    const attemptRes = await db.query(
      'SELECT * FROM payment_attempts WHERE client_txn_id = $1 OR provider_order_id = $1',
      [orderId]
    );

    let attempt = attemptRes.rows[0];
    let booking: any = null;

    if (attempt) {
      const bRes = await db.query('SELECT * FROM bookings WHERE id = $1', [attempt.booking_id]);
      booking = bRes.rows[0];
    } else {
      // 2. Lookup booking by publicId
      const bRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [orderId]);
      booking = bRes.rows[0];
      if (booking) {
        const attRes = await db.query('SELECT * FROM payment_attempts WHERE booking_id = $1', [booking.id]);
        attempt = attRes.rows[0];
      }
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        status: 'FAILED',
        error: { code: 'NOT_FOUND', message: 'Order / Booking not found.' },
      });
    }

    // 3. Check if already confirmed
    if (booking.status === 'payment_confirmed') {
      const couponsRes = await db.query(
        'SELECT coupon_number, holder_name, phone, village, status, issued_at FROM coupons WHERE booking_id = $1',
        [booking.id]
      );

      return res.json({
        success: true,
        status: 'SUCCESS',
        order_id: attempt?.client_txn_id || booking.public_id,
        booking: {
          publicId: booking.public_id,
          id: booking.public_id,
          name: booking.name,
          phone: booking.phone,
          village: booking.village,
          quantity: booking.quantity,
          totalAmount: Math.round(booking.total_amount_paise / 100),
          paidAt: booking.paid_at,
          status: 'confirmed',
          coupons: couponsRes.rows,
        },
      });
    }

    // 4. Check if failed or expired
    if (booking.status === 'payment_failed' || booking.status === 'expired' || booking.status === 'cancelled') {
      return res.json({
        success: true,
        status: 'FAILED',
        order_id: attempt?.client_txn_id || booking.public_id,
        message: 'Payment was cancelled or failed.',
      });
    }

    // 5. If still pending, perform instant real-time status check with VyaparGateway
    if (config.VYAPAR_API_KEY && attempt && config.PAYMENT_PROVIDER === 'vyapar_gateway') {
      try {
        const provider = new VyaparGatewayProvider();
        const liveStatus = await provider.fetchPaymentStatus({
          clientTxnId: attempt.client_txn_id,
          providerOrderId: attempt.provider_order_id,
        });

        if (liveStatus.status === 'confirmed') {
          await db.withTransaction(async (client) => {
            await client.query(
              'UPDATE payment_attempts SET normalized_status = $1, provider_payment_id = $2 WHERE id = $3',
              ['confirmed', liveStatus.providerPaymentId || 'LIVE_VERIFIED', attempt.id]
            );
            const paidAt = new Date().toISOString();
            await client.query(
              'UPDATE bookings SET status = $1, paid_at = $2 WHERE id = $3',
              ['payment_confirmed', paidAt, booking.id]
            );
            await allocateCouponsForBooking(client, booking.id, () => db.getNextCouponSerial());
          });

          const couponsRes = await db.query(
            'SELECT coupon_number, holder_name, phone, village, status, issued_at FROM coupons WHERE booking_id = $1',
            [booking.id]
          );

          return res.json({
            success: true,
            status: 'SUCCESS',
            order_id: attempt.client_txn_id,
            booking: {
              publicId: booking.public_id,
              id: booking.public_id,
              name: booking.name,
              phone: booking.phone,
              village: booking.village,
              quantity: booking.quantity,
              totalAmount: Math.round(booking.total_amount_paise / 100),
              paidAt: new Date().toISOString(),
              status: 'confirmed',
              coupons: couponsRes.rows,
            },
          });
        }
      } catch (err) {
        // Continue to return pending
      }
    }

    // Return PENDING
    return res.json({
      success: true,
      status: 'PENDING',
      order_id: attempt?.client_txn_id || booking.public_id,
      message: 'Payment is pending verification.',
    });
  } catch (err: any) {
    console.error('Error fetching payment status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Standard JSON Parser for all other endpoints
app.use(express.json());

// 4. Mount Admin Routes
app.use('/api/admin', adminRoutes);

// 5. Public Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: config.NODE_ENV,
    paymentMode: config.PAYMENT_MODE,
    timestamp: new Date().toISOString(),
  });
});

// 6. Public Event Configuration (Safe Projection)
app.get('/api/config', (req, res) => {
  res.json(getPublicConfig());
});

// Helper for Indian Phone Normalization
function normalizeIndianPhone(phone: string): string | null {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    const withoutPrefix = cleaned.slice(2);
    if (/^[6-9]\d{9}$/.test(withoutPrefix)) {
      return withoutPrefix;
    }
  }
  return null;
}

// 7. Create Public Booking & Payment Session
app.post('/api/bookings', async (req, res) => {
  try {
    const gate = canAcceptPayments();
    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        error: { code: 'BOOKING_UNAVAILABLE', message: gate.reason },
      });
    }

    const { name, phone, village, quantity } = req.body;

    // Validate inputs
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_NAME', message: 'Please enter a valid participant name (2-80 characters).' },
      });
    }

    const normalizedPhone = normalizeIndianPhone(String(phone || ''));
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PHONE', message: 'Please enter a valid 10-digit Indian mobile number.' },
      });
    }

    if (!village || typeof village !== 'string' || village.trim().length < 2 || village.trim().length > 80) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_VILLAGE', message: 'Please enter a valid village/town name.' },
      });
    }

    const qty = Number(quantity);
    if (
      quantity === undefined ||
      quantity === null ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > config.EVENT_MAX_COUPONS_PER_BOOKING
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUANTITY',
          message: `Quantity must be an integer between 1 and ${config.EVENT_MAX_COUPONS_PER_BOOKING}.`,
        },
      });
    }

    // Strict Server-Side Pricing (Paise)
    const unitPricePaise = config.EVENT_COUPON_PRICE_PAISE; // 5000 paise = ₹50
    const totalAmountPaise = unitPricePaise * qty;

    const publicId = `BK-${Math.floor(100000 + Math.random() * 900000)}`;
    const clientTxnId = `ORD_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const bookingId = crypto.randomUUID();

    // Secure tokens
    const statusToken = crypto.randomBytes(24).toString('hex');
    const statusTokenHash = crypto.createHash('sha256').update(statusToken).digest('hex');

    const downloadToken = crypto.randomBytes(24).toString('hex');
    const downloadTokenHash = crypto.createHash('sha256').update(downloadToken).digest('hex');

    // Insert booking into database
    await db.query(
      `INSERT INTO bookings (
        id, public_id, participant_name, phone, village, quantity,
        unit_price_paise, total_amount_paise, status, provider_name,
        download_token_hash, status_token_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        bookingId,
        publicId,
        name.trim(),
        normalizedPhone,
        village.trim(),
        qty,
        unitPricePaise,
        totalAmountPaise,
        'payment_pending',
        'vyapar_gateway',
        downloadTokenHash,
        statusTokenHash,
      ]
    );

    // Call payment provider
    const provider = getPaymentProvider();
    const paymentSession = await provider.createPaymentSession({
      bookingId,
      publicBookingId: publicId,
      clientTxnId,
      amountPaise: totalAmountPaise,
      customerName: name.trim(),
      customerPhone: normalizedPhone,
      customerVillage: village.trim(),
      redirectUrl: `${config.APP_URL}/?booking=${publicId}&status_token=${statusToken}`,
    });

    // Save payment attempt
    const attemptId = crypto.randomUUID();
    await db.query(
      `INSERT INTO payment_attempts (
        id, booking_id, provider_name, client_txn_id, provider_order_id,
        amount_paise, provider_status, normalized_status, checkout_url,
        qr_data, upi_intent_uri, expires_at, provider_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        attemptId,
        bookingId,
        provider.name,
        clientTxnId,
        paymentSession.providerOrderId || null,
        totalAmountPaise,
        'PENDING',
        'pending',
        paymentSession.checkoutUrl || null,
        paymentSession.qrData || null,
        paymentSession.upiIntentUri || null,
        paymentSession.expiresAt || null,
        paymentSession.rawMetadata || {},
      ]
    );

    return res.json({
      success: true,
      data: {
        booking: {
          publicId,
          name: name.trim(),
          phone: normalizedPhone,
          village: village.trim(),
          quantity: qty,
          totalAmount: totalAmountPaise / 100,
          status: 'payment_pending',
        },
        payment: {
          clientTxnId,
          orderId: paymentSession.providerOrderId || clientTxnId,
          checkoutUrl: paymentSession.checkoutUrl,
          qrData: paymentSession.qrData,
          upiIntentUri: paymentSession.upiIntentUri,
          expiresAt: paymentSession.expiresAt,
          statusToken,
          isTestMode: config.PAYMENT_MODE === 'test',
        },
      },
    });
  } catch (error: any) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'BOOKING_FAILED', message: error.message || 'Failed to create booking.' },
    });
  }
});

// 8. Booking Status Polling Endpoint
app.get('/api/bookings/:publicId/status', async (req, res) => {
  try {
    const { publicId } = req.params;
    const statusToken = (req.query.token as string) || (req.headers['x-status-token'] as string);

    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }

    const booking = bookingRes.rows[0];

    // Verify status token
    if (statusToken) {
      const hash = crypto.createHash('sha256').update(statusToken).digest('hex');
      if (hash !== booking.status_token_hash && hash !== booking.download_token_hash) {
        return res.status(403).json({ success: false, error: { message: 'Invalid status token.' } });
      }
    }

    // If still pending, check status with provider as fallback reconciliation
    if (booking.status === 'payment_pending') {
      const attRes = await db.query(
        'SELECT * FROM payment_attempts WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1',
        [booking.id]
      );
      if (attRes.rows.length > 0) {
        const attempt = attRes.rows[0];
        try {
          const provider = getPaymentProvider();
          const providerStatus = await provider.fetchPaymentStatus({
            clientTxnId: attempt.client_txn_id,
            providerOrderId: attempt.provider_order_id,
          });

          if (providerStatus.status === 'confirmed') {
            await db.withTransaction(async (client) => {
              await client.query(
                'UPDATE payment_attempts SET normalized_status = $1, provider_payment_id = $2 WHERE id = $3',
                ['confirmed', providerStatus.providerPaymentId || 'PROV_RECONCILED', attempt.id]
              );
              await client.query(
                'UPDATE bookings SET status = $1, paid_at = $2 WHERE id = $3',
                ['payment_confirmed', new Date().toISOString(), booking.id]
              );
              await allocateCouponsForBooking(client, booking.id, () => db.getNextCouponSerial());
            });
            booking.status = 'payment_confirmed';
          }
        } catch {
          // ignore provider status check errors on polling
        }
      }
    }

    // If confirmed, retrieve issued coupons
    let coupons: any[] = [];
    if (booking.status === 'payment_confirmed') {
      const couponsRes = await db.query(
        'SELECT coupon_number, holder_name, phone, village, ticket_index, total_quantity, issued_at FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      coupons = couponsRes.rows;
    }

    res.json({
      success: true,
      data: {
        publicId: booking.public_id,
        status: booking.status,
        isConfirmed: booking.status === 'payment_confirmed',
        quantity: booking.quantity,
        totalAmount: booking.total_amount_paise / 100,
        paidAt: booking.paid_at,
        coupons,
        downloadUrl: booking.status === 'payment_confirmed' ? `/api/bookings/${booking.public_id}/download-all` : null,
      },
    });
  } catch (error: any) {
    console.error('Fetch booking status error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch status.' } });
  }
});

// 9. Public Coupon Verification Tool (PII Protected)
app.get('/api/coupons/:couponNumber/verify', async (req, res) => {
  try {
    const { couponNumber } = req.params;
    const cleanNumber = couponNumber.trim().toUpperCase();

    const couponRes = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [cleanNumber]);
    if (couponRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No valid ticket found with this coupon number.' },
      });
    }

    const coupon = couponRes.rows[0];
    const bookingRes = await db.query('SELECT status, paid_at, public_id FROM bookings WHERE id = $1', [
      coupon.booking_id,
    ]);
    const booking = bookingRes.rows[0];

    const isValid = coupon.status === 'valid' && booking?.status === 'payment_confirmed';

    return res.json({
      success: true,
      data: {
        couponNumber: coupon.coupon_number,
        isValid,
        status: coupon.status,
        participantName: coupon.holder_name,
        maskedPhone: maskPhoneNumber(coupon.phone),
        village: coupon.village,
        ticketIndex: coupon.ticket_index,
        totalQuantity: coupon.total_quantity,
        issuedAt: formatKolkataTime(coupon.issued_at),
        drawDate: '19th Sunday Evening, 6:30 PM',
        venue: config.EVENT_VENUE,
        prize: config.EVENT_PRIZE,
      },
    });
  } catch (error: any) {
    console.error('Coupon verify error:', error);
    res.status(500).json({ success: false, error: { message: 'Verification failed.' } });
  }
});

// 10. Public Download Single Ticket PDF
app.get('/api/coupons/:couponNumber/download', async (req, res) => {
  try {
    const { couponNumber } = req.params;
    const cleanNumber = couponNumber.trim().toUpperCase();

    const couponRes = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [cleanNumber]);
    if (couponRes.rows.length === 0) {
      return res.status(404).send('Coupon not found');
    }

    const coupon = couponRes.rows[0];
    const bookingRes = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);
    const booking = bookingRes.rows[0];

    if (booking.status !== 'payment_confirmed' || coupon.status !== 'valid') {
      return res.status(403).send('Ticket cannot be downloaded until payment is confirmed.');
    }

    const pdfBuffer = await renderTicketPdf({
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking.public_id,
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking.paid_at,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${coupon.coupon_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('Download ticket error:', error);
    res.status(500).send('Failed to generate ticket PDF.');
  }
});

// 11. Download All Tickets for a Booking (ZIP or Multi-page PDF)
app.get('/api/bookings/:publicId/download-all', async (req, res) => {
  try {
    const { publicId } = req.params;
    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);

    if (bookingRes.rows.length === 0) {
      return res.status(404).send('Booking not found');
    }

    const booking = bookingRes.rows[0];
    if (booking.status !== 'payment_confirmed') {
      return res.status(403).send('Tickets cannot be downloaded until payment is confirmed.');
    }

    const couponsRes = await db.query(
      'SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
      [booking.id]
    );

    const tickets = couponsRes.rows.map((c) => ({
      couponNumber: c.coupon_number,
      participantName: c.holder_name,
      phone: c.phone,
      village: c.village,
      bookingPublicId: booking.public_id,
      ticketIndex: c.ticket_index,
      totalQuantity: c.total_quantity,
      paidAt: booking.paid_at,
    }));

    if (tickets.length === 1) {
      const pdfBuffer = await renderTicketPdf(tickets[0]);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${tickets[0].couponNumber}.pdf"`);
      return res.send(pdfBuffer);
    }

    // Multiple tickets: send ZIP
    const zipBuffer = await createTicketsZipArchive(tickets);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="tickets_${booking.public_id}.zip"`);
    res.send(zipBuffer);
  } catch (error: any) {
    console.error('Download all tickets error:', error);
    res.status(500).send('Failed to generate ticket package.');
  }
});

// 12. Test Mode Simulated Payment Confirmation (Development & Automated Tests ONLY)
app.post('/api/test-mode/simulate-payment', async (req, res) => {
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    if (config.NODE_ENV === 'production' || config.PAYMENT_MODE === 'live') {
      return res.status(403).json({ error: 'Prohibited in production mode.' });
    }
  }

  try {
    const { clientTxnId } = req.body;
    if (!clientTxnId) {
      return res.status(400).json({ error: 'clientTxnId required' });
    }

    const attemptRes = await db.query(
      'SELECT * FROM payment_attempts WHERE client_txn_id = $1',
      [clientTxnId]
    );

    if (attemptRes.rows.length === 0) {
      return res.status(404).json({ error: 'Attempt not found' });
    }

    const attempt = attemptRes.rows[0];

    await db.withTransaction(async (client) => {
      await client.query(
        'UPDATE payment_attempts SET normalized_status = $1, provider_payment_id = $2 WHERE id = $3',
        ['confirmed', `sim_pay_${Date.now()}`, attempt.id]
      );

      const paidAt = new Date().toISOString();
      await client.query(
        'UPDATE bookings SET status = $1, paid_at = $2 WHERE id = $3',
        ['payment_confirmed', paidAt, attempt.booking_id]
      );

      await allocateCouponsForBooking(client, attempt.booking_id, () => db.getNextCouponSerial());
    });

    MockPaymentProvider.confirmTxn(clientTxnId);

    res.json({ success: true, message: 'Simulated payment confirmed in TEST MODE.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Mount Vite middleware or Static Bundle
async function startServer() {
  if (config.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Yuva Shakti Portal running on http://0.0.0.0:${PORT}`);
    console.log(`💳 Payment Provider: ${config.PAYMENT_PROVIDER} [Mode: ${config.PAYMENT_MODE}]`);
  });
}

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app };
