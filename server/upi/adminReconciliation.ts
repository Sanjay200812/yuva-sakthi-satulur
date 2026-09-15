import crypto from 'crypto';
import { db } from '../db/client.ts';
import { config } from '../config/eventConfig.ts';
import { allocateCouponsForBooking } from '../services/couponAllocator.ts';

export interface BankRecordMatchInput {
  bankTxnId?: string;
  receivedAmountPaise: number;
  recipientAccount: string;
  matchNote?: string;
}

export interface ConfirmPaymentParams {
  submissionId: string;
  adminUserId: string;
  bankRecordMatch: BankRecordMatchInput;
  auditNote: string;
  idempotencyKey?: string;
}

export interface RejectPaymentParams {
  submissionId: string;
  adminUserId: string;
  reviewNote: string;
}

export interface RequestResubmissionParams {
  submissionId: string;
  adminUserId: string;
  guidanceNote: string;
}

export interface ConfirmedPaymentResult {
  booking: any;
  coupons: any[];
  couponsIssuedCount: number;
}

/**
 * Concurrency-safe, atomic admin reconciliation against organizer's real bank / merchant UPI record.
 * Locks booking and submission, enforces UTR uniqueness among confirmed payments,
 * marks status 'payment_confirmed', allocates sequential coupon numbers, and inserts audit logs.
 */
export async function confirmPaymentFromBankRecord(
  params: ConfirmPaymentParams
): Promise<ConfirmedPaymentResult> {
  const { submissionId, adminUserId, bankRecordMatch, auditNote, idempotencyKey } = params;

  return await db.transaction(async (client) => {
    // 1. Fetch & lock submission
    const sRes = await client.query('SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE', [submissionId]);
    if (sRes.rows.length === 0) {
      throw new Error(`Payment submission ${submissionId} not found`);
    }
    const submission = sRes.rows[0];

    // 2. Fetch & lock booking
    const bRes = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [submission.booking_id]);
    if (bRes.rows.length === 0) {
      throw new Error(`Booking ${submission.booking_id} not found`);
    }
    const booking = bRes.rows[0];

    // Idempotency: If already confirmed, return existing coupons
    if (booking.status === 'payment_confirmed') {
      const existingCoupons = await client.query(
        'SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
        [booking.id]
      );
      return {
        booking,
        coupons: existingCoupons.rows,
        couponsIssuedCount: existingCoupons.rows.length,
      };
    }

    // 3. Validate received amount matches expected amount
    if (bankRecordMatch.receivedAmountPaise < booking.total_amount_paise) {
      throw new Error(
        `Received amount (₹${bankRecordMatch.receivedAmountPaise / 100}) is less than expected amount (₹${booking.total_amount_paise / 100})`
      );
    }

    // 4. Enforce global UTR uniqueness among admin_confirmed submissions
    if (submission.payer_utr_hash) {
      const existingUtrRes = await client.query(
        `SELECT id, booking_id FROM payment_submissions 
         WHERE payer_utr_hash = $1 AND status = 'admin_confirmed' AND booking_id != $2`,
        [submission.payer_utr_hash, booking.id]
      );
      if (existingUtrRes.rows.length > 0) {
        throw new Error('This UTR has already been confirmed for another booking.');
      }
    }

    const confirmedAt = new Date().toISOString();

    // 5. Update submission to admin_confirmed
    await client.query(
      `UPDATE payment_submissions 
       SET status = 'admin_confirmed', 
           admin_reviewer_id = $1, 
           admin_review_note = $2, 
           bank_record_match = $3, 
           reviewed_at = $4,
           updated_at = $4
       WHERE id = $5`,
      [
        adminUserId,
        auditNote || 'Confirmed against bank record',
        JSON.stringify(bankRecordMatch),
        confirmedAt,
        submission.id,
      ]
    );

    // 6. Update booking to payment_confirmed
    await client.query(
      `UPDATE bookings 
       SET status = 'payment_confirmed', 
           paid_at = $1, 
           verified_at = $1, 
           updated_at = $1 
       WHERE id = $2`,
      [confirmedAt, booking.id]
    );

    // 7. Concurrency-safe sequential coupon serial allocation strictly in 1501-2250 range
    const issuedCoupons = await allocateCouponsForBooking(client, booking.id, async () => {
      const res = await client.query("SELECT nextval('coupon_serial_seq') as nextval");
      return parseInt(res.rows[0].nextval, 10);
    });

    // 8. Write immutable admin audit log
    await client.query(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        adminUserId,
        'CONFIRM_PAYMENT_FROM_BANK_RECORD',
        'booking',
        booking.id,
        JSON.stringify({
          submissionId: submission.id,
          couponsIssuedCount: issuedCoupons.length,
          couponNumbers: issuedCoupons.map((c) => c.coupon_number),
          bankRecordMatch,
          auditNote,
          idempotencyKey,
        }),
        confirmedAt,
      ]
    );

    return {
      booking: {
        ...booking,
        status: 'payment_confirmed',
        paid_at: confirmedAt,
        verified_at: confirmedAt,
      },
      coupons: issuedCoupons,
      couponsIssuedCount: issuedCoupons.length,
    };
  });
}

/**
 * Admin action: Reject payment proof.
 */
export async function rejectPaymentSubmission(params: RejectPaymentParams): Promise<void> {
  const { submissionId, adminUserId, reviewNote } = params;

  await db.transaction(async (client) => {
    const sRes = await client.query('SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE', [submissionId]);
    if (sRes.rows.length === 0) throw new Error(`Submission ${submissionId} not found`);
    const submission = sRes.rows[0];

    const now = new Date().toISOString();

    await client.query(
      `UPDATE payment_submissions 
       SET status = 'admin_rejected', 
           admin_reviewer_id = $1, 
           admin_review_note = $2, 
           reviewed_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [adminUserId, reviewNote, now, submission.id]
    );

    await client.query(
      `UPDATE bookings 
       SET status = 'payment_rejected', 
           updated_at = $1 
       WHERE id = $2`,
      [now, submission.booking_id]
    );

    await client.query(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        adminUserId,
        'REJECT_PAYMENT_SUBMISSION',
        'booking',
        submission.booking_id,
        JSON.stringify({ submissionId, reviewNote }),
        now,
      ]
    );
  });
}

/**
 * Admin action: Request proof resubmission from customer.
 */
export async function requestProofResubmission(params: RequestResubmissionParams): Promise<void> {
  const { submissionId, adminUserId, guidanceNote } = params;

  await db.transaction(async (client) => {
    const sRes = await client.query('SELECT * FROM payment_submissions WHERE id = $1 FOR UPDATE', [submissionId]);
    if (sRes.rows.length === 0) throw new Error(`Submission ${submissionId} not found`);
    const submission = sRes.rows[0];

    const now = new Date().toISOString();

    await client.query(
      `UPDATE payment_submissions 
       SET status = 'superseded', 
           admin_reviewer_id = $1, 
           admin_review_note = $2, 
           reviewed_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [adminUserId, guidanceNote, now, submission.id]
    );

    await client.query(
      `UPDATE bookings 
       SET status = 'proof_required', 
           updated_at = $1 
       WHERE id = $2`,
      [now, submission.booking_id]
    );

    await client.query(
      `INSERT INTO admin_audit_logs (
        id, admin_user_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        adminUserId,
        'REQUEST_PROOF_RESUBMISSION',
        'booking',
        submission.booking_id,
        JSON.stringify({ submissionId, guidanceNote }),
        now,
      ]
    );
  });
}
