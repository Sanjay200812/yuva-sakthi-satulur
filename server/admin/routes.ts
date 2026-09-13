import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/client.ts';
import {
  requireAdminAuth,
  checkLoginRateLimit,
  comparePassword,
  createAdminSession,
  destroyAdminSession,
} from './auth.ts';
import { renderTicketPdf, formatKolkataTime, maskPhoneNumber } from '../services/ticketRenderer.ts';

const router = express.Router();

// 1. Admin Login
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkLoginRateLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed login attempts. Please try again later.' },
      });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email and password are required.' },
      });
    }

    const userRes = await db.query('SELECT * FROM admin_users WHERE email = $1', [email.toLowerCase().trim()]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'Invalid email or password.' },
      });
    }

    const user = userRes.rows[0];
    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'Invalid email or password.' },
      });
    }

    const token = createAdminSession({ id: user.id, email: user.email, role: user.role });

    // Set secure HTTP-only cookie
    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, email: user.email, role: user.role },
      },
    });
  } catch (error: any) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, error: { message: 'Internal server error during login.' } });
  }
});

// 2. Admin Logout
router.post('/auth/logout', requireAdminAuth, (req: Request, res: Response) => {
  const token = req.cookies.admin_session || req.headers.authorization?.replace('Bearer ', '');
  if (token) destroyAdminSession(token);
  res.clearCookie('admin_session');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// 3. Current Admin Profile
router.get('/auth/me', requireAdminAuth, (req: Request, res: Response) => {
  const user = (req as any).adminUser;
  res.json({ success: true, data: user });
});

// 4. Admin Dashboard Metrics (Confirmed payments only!)
router.get('/dashboard', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const metricsRes = await db.query('SELECT admin_metrics FROM event_settings');
    const data = metricsRes.rows[0] || {
      confirmedBookingsCount: 0,
      validCouponsCount: 0,
      totalRevenueInr: 0,
      bookingsToday: 0,
      couponsToday: 0,
      failedOrPendingAttempts: 0,
      lastPaymentAt: null,
    };

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Dashboard metrics error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch dashboard metrics.' } });
  }
});

// 5. Applied Coupons List (ONLY Real Successfully Paid & Confirmed Applications!)
router.get('/coupons', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string || '';
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));

    const sql = `
      SELECT 
        c.id, c.coupon_number, c.holder_name, c.phone, c.village, c.status,
        c.ticket_index, c.total_quantity, c.issued_at,
        b.public_id as booking_public_id, b.status as booking_status, b.paid_at,
        b.unit_price_paise as amount_paise,
        pa.provider_payment_id
      FROM coupons c
      JOIN bookings b ON c.booking_id = b.id
      LEFT JOIN payment_attempts pa ON b.id = pa.booking_id AND pa.normalized_status = 'confirmed'
      WHERE b.status = 'payment_confirmed' AND c.status = 'valid'
      ORDER BY c.issued_at DESC
    `;

    const resData = await db.query(sql, [search]);
    let items = resData.rows;

    const total = items.length;
    const startIndex = (page - 1) * limit;
    const paginatedItems = items.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: {
        coupons: paginatedItems.map((item) => ({
          ...item,
          formattedPaidAt: formatKolkataTime(item.paid_at),
          maskedPhone: maskPhoneNumber(item.phone),
          amountInr: (item.amount_paise || 5000) / 100,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error: any) {
    console.error('Fetch applied coupons error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch applied coupons list.' } });
  }
});

// Helper to escape formula injection in CSV
function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  let str = String(val).replace(/"/g, '""');
  if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
    str = `'${str}`;
  }
  return `"${str}"`;
}

// 6. Export Confirmed Coupons to CSV
router.get('/coupons/export.csv', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const sql = `
      SELECT 
        c.coupon_number, c.holder_name, c.phone, c.village,
        b.public_id as booking_ref, c.ticket_index, c.total_quantity,
        b.paid_at, pa.provider_payment_id
      FROM coupons c
      JOIN bookings b ON c.booking_id = b.id
      LEFT JOIN payment_attempts pa ON b.id = pa.booking_id AND pa.normalized_status = 'confirmed'
      WHERE b.status = 'payment_confirmed' AND c.status = 'valid'
      ORDER BY c.serial ASC
    `;

    const result = await db.query(sql);

    const headers = [
      'Coupon Number',
      'Participant Name',
      'Phone',
      'Village',
      'Booking Ref',
      'Ticket Position',
      'Payment Ref',
      'Paid Date (Kolkata)',
      'Price',
    ];

    const rows = result.rows.map((r) => [
      escapeCsv(r.coupon_number),
      escapeCsv(r.holder_name),
      escapeCsv(r.phone),
      escapeCsv(r.village),
      escapeCsv(r.booking_ref),
      escapeCsv(`${r.ticket_index} of ${r.total_quantity}`),
      escapeCsv(r.provider_payment_id || 'CONFIRMED'),
      escapeCsv(formatKolkataTime(r.paid_at)),
      escapeCsv('₹50'),
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="confirmed_coupons_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    console.error('CSV Export Error:', error);
    res.status(500).send('Failed to export CSV');
  }
});

// 7. Admin Download of Single Ticket PDF
router.get('/coupons/:couponNumber/download', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { couponNumber } = req.params;
    const resCoupon = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [couponNumber]);

    if (resCoupon.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Coupon not found.' } });
    }

    const coupon = resCoupon.rows[0];
    const resBooking = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);
    const booking = resBooking.rows[0];

    const pdfBuffer = await renderTicketPdf({
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || 'BK-SYS',
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.paid_at,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${coupon.coupon_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('Admin ticket download error:', error);
    res.status(500).send('Failed to generate coupon PDF.');
  }
});

// 8. Payment Diagnostics View (Pending/Failed attempts)
router.get('/payments', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM payment_attempts JOIN bookings');
    res.json({
      success: true,
      data: result.rows.map((p) => ({
        id: p.id,
        bookingPublicId: p.booking_public_id,
        participantName: p.participant_name,
        phone: maskPhoneNumber(p.phone || ''),
        amountInr: (p.amount_paise || 0) / 100,
        provider: p.provider_name,
        clientTxnId: p.client_txn_id,
        providerOrderId: p.provider_order_id,
        normalizedStatus: p.normalized_status,
        failureReason: p.failure_reason,
        createdAt: formatKolkataTime(p.created_at),
      })),
    });
  } catch (error: any) {
    console.error('Payment diagnostics error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch payment diagnostics.' } });
  }
});

export default router;
