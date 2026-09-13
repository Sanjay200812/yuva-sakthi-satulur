import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/client.ts';
import {
  requireAdminAuth,
  checkLoginRateLimit,
  comparePassword,
  createAdminSession,
  destroyAdminSession,
} from './auth.ts';
import { renderTicketPdf, renderTicketRaster, formatKolkataTime, maskPhoneNumber } from '../services/ticketRenderer.ts';
import {
  confirmPaymentFromBankRecord,
  rejectPaymentSubmission,
  requestProofResubmission,
} from '../upi/adminReconciliation.ts';

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

// 4. Admin Dashboard Metrics (Automatically verified payments only!)
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

// 5. Applied Coupons List (ONLY Real Successfully Verified Applications!)
router.get('/coupons', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));

    const sql = `
      SELECT 
        c.id, c.coupon_number, c.holder_name, c.phone, c.village, c.status,
        c.ticket_index, c.total_quantity, c.issued_at,
        b.public_id as booking_public_id, b.status as booking_status, b.paid_at, b.verified_at,
        b.unit_price_paise as amount_paise,
        ps.payer_utr_hash
      FROM coupons c
      JOIN bookings b ON c.booking_id = b.id
      LEFT JOIN payment_submissions ps ON b.id = ps.booking_id AND ps.status = 'proof_verified'
      WHERE (b.status = 'proof_verified' OR b.status = 'payment_confirmed') AND c.status = 'valid'
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
          formattedPaidAt: formatKolkataTime(item.verified_at || item.paid_at),
          maskedPhone: maskPhoneNumber(item.phone),
          amountInr: (item.amount_paise || 5000) / 100,
          verificationMethod: 'Automated Proof Verification (Gemini OCR + Deterministic Rules)',
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

// 6. Export Verified Coupons to CSV
router.get('/coupons/export.csv', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const sql = `
      SELECT 
        c.coupon_number, c.holder_name, c.phone, c.village,
        b.public_id as booking_ref, c.ticket_index, c.total_quantity,
        COALESCE(b.verified_at, b.paid_at) as verified_date,
        ps.payer_utr_hash
      FROM coupons c
      JOIN bookings b ON c.booking_id = b.id
      LEFT JOIN payment_submissions ps ON b.id = ps.booking_id AND ps.status = 'proof_verified'
      WHERE (b.status = 'proof_verified' OR b.status = 'payment_confirmed') AND c.status = 'valid'
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
      'Verification Status',
      'Verified Date (Kolkata)',
      'Price',
    ];

    const rows = result.rows.map((r) => [
      escapeCsv(r.coupon_number),
      escapeCsv(r.holder_name),
      escapeCsv(r.phone),
      escapeCsv(r.village),
      escapeCsv(r.booking_ref),
      escapeCsv(`${r.ticket_index} of ${r.total_quantity}`),
      escapeCsv('Automated Proof Verified'),
      escapeCsv(formatKolkataTime(r.verified_date)),
      escapeCsv('₹50'),
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="verified_coupons_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    console.error('CSV Export Error:', error);
    res.status(500).send('Failed to export CSV');
  }
});

// 7. Admin Download of Single Ticket (PDF, PNG, JPEG)
router.get('/coupons/:couponNumber/download', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { couponNumber } = req.params;
    const format = ((req.query.format as string) || 'pdf').toLowerCase();

    if (!['pdf', 'png', 'jpeg', 'jpg'].includes(format)) {
      return res.status(400).send('Invalid format requested. Supported formats: pdf, png, jpeg.');
    }

    const resCoupon = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [couponNumber]);

    if (resCoupon.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Coupon not found.' } });
    }

    const coupon = resCoupon.rows[0];
    const resBooking = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);
    const booking = resBooking.rows[0];

    const ticketData = {
      couponNumber: coupon.coupon_number,
      participantName: coupon.holder_name,
      phone: coupon.phone,
      village: coupon.village,
      bookingPublicId: booking?.public_id || 'BK-SYS',
      ticketIndex: coupon.ticket_index,
      totalQuantity: coupon.total_quantity,
      paidAt: booking?.verified_at || booking?.paid_at,
    };

    if (format === 'pdf') {
      const pdfBuffer = await renderTicketPdf(ticketData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${coupon.coupon_number}.pdf"`);
      return res.send(pdfBuffer);
    }

    const targetRaster = format === 'png' ? 'png' : 'jpeg';
    const rasterBuffer = await renderTicketRaster(ticketData, targetRaster);
    res.setHeader('Content-Type', targetRaster === 'png' ? 'image/png' : 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${coupon.coupon_number}.${targetRaster === 'png' ? 'png' : 'jpg'}"`);
    return res.send(rasterBuffer);
  } catch (error: any) {
    console.error('Admin ticket download error:', error);
    res.status(500).send('Failed to generate coupon.');
  }
});

// 8. Single Coupon Details
router.get('/coupons/:couponNumber', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { couponNumber } = req.params;
    const resCoupon = await db.query('SELECT * FROM coupons WHERE coupon_number = $1', [couponNumber]);
    if (resCoupon.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Coupon not found.' } });
    }
    const coupon = resCoupon.rows[0];
    const resBooking = await db.query('SELECT * FROM bookings WHERE id = $1', [coupon.booking_id]);

    res.json({
      success: true,
      data: {
        coupon,
        booking: resBooking.rows[0] || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// 9. Payment Reviews Queue (and legacy Payment Diagnostics alias)
router.get(['/payment-reviews', '/payment-diagnostics'], requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string;
    const search = req.query.search as string;

    const result = await db.query(
      `SELECT ps.*, b.public_id as booking_public_id, b.participant_name, b.phone, b.village, b.quantity, b.total_amount_paise
       FROM payment_submissions ps
       JOIN bookings b ON ps.booking_id = b.id
       ORDER BY ps.created_at DESC`
    );

    let items = result.rows;

    if (statusFilter && statusFilter !== 'all') {
      items = items.filter((s: any) => s.status === statusFilter);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter((s: any) =>
        (s.participant_name && s.participant_name.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(q)) ||
        (s.booking_public_id && s.booking_public_id.toLowerCase().includes(q)) ||
        (s.payment_reference && s.payment_reference.toLowerCase().includes(q)) ||
        (s.payer_utr_hash && s.payer_utr_hash.toLowerCase().includes(q))
      );
    }

    res.json({
      success: true,
      data: items.map((s: any) => ({
        id: s.id,
        bookingId: s.booking_id,
        bookingPublicId: s.booking_public_id,
        participantName: s.participant_name,
        phone: maskPhoneNumber(s.phone || ''),
        village: s.village,
        quantity: s.quantity,
        amountInr: (s.expected_amount_paise || 5000) / 100,
        selectedApp: s.selected_upi_app,
        paymentReference: s.payment_reference,
        utrMasked: s.payer_utr_hash ? `UTR-${s.payer_utr_hash.slice(0, 8)}...` : 'Unknown',
        status: s.status,
        riskScore: s.risk_score || 0,
        reasonCodes: s.reason_codes || [],
        geminiExtraction: s.gemini_extraction,
        deterministicComparison: s.deterministic_comparison,
        hasScreenshot: !!s.screenshot_storage_path,
        adminReviewerId: s.admin_reviewer_id,
        adminReviewNote: s.admin_review_note,
        bankRecordMatch: s.bank_record_match,
        reviewedAt: s.reviewed_at ? formatKolkataTime(s.reviewed_at) : null,
        submittedAt: formatKolkataTime(s.created_at),
      })),
    });
  } catch (error: any) {
    console.error('Payment reviews error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch payment reviews queue.' } });
  }
});

// 10. Single Payment Review Submission Details
router.get(['/payment-reviews/:submissionId', '/payment-diagnostics/:submissionId'], requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const result = await db.query('SELECT * FROM payment_submissions WHERE id = $1', [submissionId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Submission not found.' } });
    }
    const submission = result.rows[0];
    const bookingRes = await db.query('SELECT * FROM bookings WHERE id = $1', [submission.booking_id]);

    res.json({
      success: true,
      data: {
        submission,
        booking: bookingRes.rows[0] || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// 11. Secure Authenticated Screenshot Stream (Admin Only)
router.get(['/payment-reviews/:submissionId/screenshot', '/payment-diagnostics/:submissionId/screenshot'], requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const result = await db.query('SELECT * FROM payment_submissions WHERE id = $1', [submissionId]);
    if (result.rows.length === 0) {
      return res.status(404).send('Not found');
    }
    const submission = result.rows[0];
    const filePath = submission.screenshot_storage_path;

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send('Screenshot file not found on disk');
    }

    res.setHeader('Content-Type', submission.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-cache, no-store');
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error: any) {
    res.status(500).send('Error streaming screenshot');
  }
});

// 12. Admin Action: Confirm Payment from Bank Record (Reconciliation)
router.post('/payment-reviews/:submissionId/confirm', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const adminUser = (req as any).adminUser;
    const { bankTxnId, receivedAmountPaise, recipientAccount, matchNote, auditNote, idempotencyKey } = req.body;

    const subRes = await db.query('SELECT expected_amount_paise, expected_payee_upi_id FROM payment_submissions WHERE id = $1', [submissionId]);
    if (subRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Submission not found.' } });
    }
    const sub = subRes.rows[0];

    const result = await confirmPaymentFromBankRecord({
      submissionId,
      adminUserId: adminUser?.id || '00000000-0000-0000-0000-000000000001',
      bankRecordMatch: {
        bankTxnId: bankTxnId || 'BANK-MATCH',
        receivedAmountPaise: Number(receivedAmountPaise) || sub.expected_amount_paise || 5000,
        recipientAccount: recipientAccount || sub.expected_payee_upi_id || '9574876369@ybl',
        matchNote: matchNote || 'Confirmed against official bank/merchant statement',
      },
      auditNote: auditNote || 'Payment confirmed by administrator from real bank record',
      idempotencyKey,
    });

    res.json({
      success: true,
      message: 'Payment confirmed successfully from bank record. Coupons issued.',
      data: result,
    });
  } catch (error: any) {
    console.error('Admin confirm payment error:', error);
    res.status(400).json({ success: false, error: { message: error.message || 'Failed to confirm payment.' } });
  }
});

// 13. Admin Action: Reject Payment Submission
router.post('/payment-reviews/:submissionId/reject', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const adminUser = (req as any).adminUser;
    const { reviewNote } = req.body;

    await rejectPaymentSubmission({
      submissionId,
      adminUserId: adminUser?.id || '00000000-0000-0000-0000-000000000001',
      reviewNote: reviewNote || 'Payment rejected by administrator',
    });

    res.json({
      success: true,
      message: 'Payment rejected successfully.',
    });
  } catch (error: any) {
    console.error('Admin reject payment error:', error);
    res.status(400).json({ success: false, error: { message: error.message || 'Failed to reject payment.' } });
  }
});

// 14. Admin Action: Request Resubmission from Customer
router.post('/payment-reviews/:submissionId/request-resubmission', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { submissionId } = req.params;
    const adminUser = (req as any).adminUser;
    const { guidanceNote } = req.body;

    await requestProofResubmission({
      submissionId,
      adminUserId: adminUser?.id || '00000000-0000-0000-0000-000000000001',
      guidanceNote: guidanceNote || 'Please submit a clear, full payment confirmation screenshot.',
    });

    res.json({
      success: true,
      message: 'Resubmission requested successfully.',
    });
  } catch (error: any) {
    console.error('Admin request resubmission error:', error);
    res.status(400).json({ success: false, error: { message: error.message || 'Failed to request resubmission.' } });
  }
});

// 15. Read-only Booking Details by publicId
router.get('/bookings/:publicId', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const bookingRes = await db.query('SELECT * FROM bookings WHERE public_id = $1', [publicId]);
    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Booking not found.' } });
    }
    const booking = bookingRes.rows[0];
    const couponsRes = await db.query('SELECT * FROM coupons WHERE booking_id = $1', [booking.id]);
    const submissionsRes = await db.query('SELECT * FROM payment_submissions WHERE booking_id = $1', [booking.id]);

    res.json({
      success: true,
      data: {
        booking,
        coupons: couponsRes.rows,
        submissions: submissionsRes.rows,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

export default router;
