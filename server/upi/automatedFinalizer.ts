import crypto from 'crypto';
import { db } from '../db/client.ts';
import { config } from '../config/eventConfig.ts';

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
           ai_model_version = $1, 
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

    // 6. Sequential atomic coupon serial allocation
    const quantity = booking.quantity || 1;
    const currentYear = new Date().getFullYear();
    const prefix = config.EVENT_COUPON_PREFIX || 'YSYS';

    // Get the current max serial from database
    const serialRes = await client.query('SELECT COALESCE(MAX(serial), 0) as max_serial FROM coupons');
    let nextSerial = Number(serialRes.rows[0]?.max_serial || 0);

    const issuedCoupons: any[] = [];

    for (let i = 1; i <= quantity; i++) {
      nextSerial++;
      const paddedSerial = String(nextSerial).padStart(6, '0');
      const couponNumber = `${prefix}-${currentYear}-${paddedSerial}`;
      const couponId = crypto.randomUUID();

      const verificationToken = crypto.randomBytes(16).toString('hex');
      const verificationTokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');

      await client.query(
        `INSERT INTO coupons (
          id, booking_id, serial, coupon_number, holder_name, phone, village,
          ticket_index, total_quantity, template_version, verification_token_hash, status, issued_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          couponId,
          booking.id,
          nextSerial,
          couponNumber,
          booking.participant_name,
          booking.phone,
          booking.village,
          i,
          quantity,
          config.TEMPLATE_VERSION || 'v1-official',
          verificationTokenHash,
          'valid',
          finalizedAt,
        ]
      );

      issuedCoupons.push({
        id: couponId,
        coupon_number: couponNumber,
        serial: nextSerial,
        holder_name: booking.participant_name,
        phone: booking.phone,
        village: booking.village,
        ticket_index: i,
        total_quantity: quantity,
        status: 'valid',
        issued_at: finalizedAt,
      });
    }

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
          couponsIssued: quantity,
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
      couponsIssuedCount: quantity,
    };
  });
}
