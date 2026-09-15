import crypto from 'crypto';
import { db } from '../db/client.ts';
import { config } from '../config/eventConfig.ts';
import { allocateCouponsForBooking } from '../services/couponAllocator.ts';

export interface AutomatedFinalizationParams {
  submissionId: string;
  bookingId: string;
  idempotencyKey?: string;
  decisionVersion?: string;
}

export interface FinalizedBookingResult {
  booking: any;
  coupons: any[];
  couponsIssuedCount: number;
}

/**
 * Concurrency-safe, atomic automated finalization.
 * Locks the booking and submission, checks idempotency, validates RRN uniqueness,
 * transitions statuses to 'payment_confirmed', allocates unique sequential coupon numbers,
 * and creates coupon records and system audit log.
 */
export async function finalizeVerifiedSubmission(
  params: AutomatedFinalizationParams
): Promise<FinalizedBookingResult> {
  const {
    submissionId,
    bookingId,
    decisionVersion = 'v1-ocr-deterministic-auto',
  } = params;

  // Use a transactional boundary
  return await db.transaction(async (client) => {
    // 1. Fetch & lock booking
    const bRes = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
    if (bRes.rows.length === 0) {
      throw new Error(`Booking ${bookingId} not found`);
    }
    const booking = bRes.rows[0];

    // Check if already finalized (Idempotency)
    if (booking.status === 'payment_confirmed' || booking.status === 'proof_verified') {
      const existingCoupons = await client.query(
        'SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      return {
        booking: { ...booking, status: 'payment_confirmed' },
        coupons: existingCoupons.rows,
        couponsIssuedCount: existingCoupons.rows.length,
      };
    }

    // 2. Fetch & lock submission
    const sRes = await client.query('SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE', [submissionId]);
    if (sRes.rows.length === 0) {
      throw new Error(`Submission ${submissionId} not found`);
    }
    const submission = sRes.rows[0];

    // 3. Enforce global RRN uniqueness among verified submissions
    if (submission.payer_utr_hash) {
      const existingUtrRes = await client.query(
        `SELECT id, booking_id FROM payment_submissions 
         WHERE payer_utr_hash = $1 AND status IN ('payment_confirmed', 'proof_verified') AND booking_id != $2`,
        [submission.payer_utr_hash, booking.id]
      );
      if (existingUtrRes.rows.length > 0) {
        throw new Error('This 12-digit UPI RRN has already been finalized for another booking.');
      }
    }

    const finalizedAt = new Date().toISOString();

    // 4. Update payment submission to payment_confirmed
    await client.query(
      `UPDATE payment_submissions 
       SET status = 'payment_confirmed', 
           ocr_engine = $1,
           updated_at = $2
       WHERE id = $3`,
      [decisionVersion, finalizedAt, submission.id]
    );

    // 5. Update booking to payment_confirmed
    await client.query(
      `UPDATE bookings 
       SET status = 'payment_confirmed', 
           paid_at = $1,
           verified_at = $1, 
           updated_at = $1 
       WHERE id = $2`,
      [finalizedAt, booking.id]
    );

    // 6. Sequential atomic coupon serial allocation strictly in 1501-2250 range
    const issuedCoupons = await allocateCouponsForBooking(client, booking.id, async () => {
      const res = await client.query("SELECT nextval('coupon_serial_seq') as nextval");
      return parseInt(res.rows[0].nextval, 10);
    });

    // 7. System Audit Event
    const auditId = crypto.randomUUID();
    await client.query(
      `INSERT INTO admin_audit_logs (
        id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        auditId,
        'automated_proof_finalized',
        'booking',
        booking.id,
        JSON.stringify({
          submissionId: submission.id,
          publicBookingId: booking.public_id,
          couponsIssued: issuedCoupons.length,
          amountPaise: booking.total_amount_paise,
          utrHash: submission.payer_utr_hash,
          decisionVersion,
        }),
        finalizedAt,
      ]
    );

    return {
      booking: { ...booking, status: 'payment_confirmed', paid_at: finalizedAt, verified_at: finalizedAt },
      coupons: issuedCoupons,
      couponsIssuedCount: issuedCoupons.length,
    };
  });
}
