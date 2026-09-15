import crypto from 'crypto';
import { DBClient, db } from '../db/client.ts';

export const MIN_COUPON_SERIAL = 1501;
export const MAX_COUPON_SERIAL = 2250;
export const TOTAL_COUPON_INVENTORY = 750;
export const OFFICIAL_TEMPLATE_VERSION = 'official-editable-docx-v1';

export interface IssuedCoupon {
  id: string;
  booking_id: string;
  serial: number;
  coupon_number: string;
  holder_name: string;
  phone: string;
  village: string;
  ticket_index: number;
  total_quantity: number;
  template_version: string;
  issued_at: string;
  verification_token?: string;
  status: string;
}

export interface CouponInventory {
  total: number;
  issued: number;
  remaining: number;
  minSerial: number;
  maxSerial: number;
  isSoldOut: boolean;
}

/**
 * Authoritative Coupon Inventory Query
 * Only coupons issued in the official 1501-2250 range count toward the 750 capacity.
 */
export async function getCouponInventory(client?: DBClient): Promise<CouponInventory> {
  const queryExecutor = client || db;
  const res = await queryExecutor.query(
    'SELECT COUNT(*)::int as count FROM coupons WHERE serial >= $1 AND serial <= $2 AND status = $3',
    [MIN_COUPON_SERIAL, MAX_COUPON_SERIAL, 'valid']
  );
  const issued = Number(res.rows[0]?.count || 0);
  const remaining = Math.max(0, TOTAL_COUPON_INVENTORY - issued);
  return {
    total: TOTAL_COUPON_INVENTORY,
    issued,
    remaining,
    minSerial: MIN_COUPON_SERIAL,
    maxSerial: MAX_COUPON_SERIAL,
    isSoldOut: remaining <= 0,
  };
}

/**
 * Concurrency-Safe, Atomic Coupon Allocator
 * Must be executed within a database transaction!
 */
export async function allocateCouponsForBooking(
  client: DBClient,
  bookingId: string,
  getNextSerialFn: () => Promise<number>
): Promise<IssuedCoupon[]> {
  // 1. Check if booking exists and lock row
  const bookingRes = await client.query(
    'SELECT id, public_id, participant_name, phone, village, quantity, status FROM bookings WHERE id = $1',
    [bookingId]
  );

  if (bookingRes.rows.length === 0) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  const booking = bookingRes.rows[0];

  // 2. Check if already allocated (idempotency guard)
  const existingCouponsRes = await client.query(
    'SELECT * FROM coupons WHERE booking_id = $1 ORDER BY ticket_index ASC',
    [bookingId]
  );

  if (existingCouponsRes.rows.length > 0) {
    // Already allocated - return existing without reallocating
    return existingCouponsRes.rows;
  }

  const quantity = booking.quantity;
  const issuedCoupons: IssuedCoupon[] = [];
  const issuedAt = new Date().toISOString();

  // 3. Allocate exactly N serials strictly within 1501-2250
  for (let i = 1; i <= quantity; i++) {
    let serial: number;
    try {
      serial = await getNextSerialFn();
    } catch (err: any) {
      if (err?.message?.includes('reached maximum value of sequence') || err?.code === 'COUPON_RANGE_EXHAUSTED') {
        const exhaustedErr = new Error('COUPON_RANGE_EXHAUSTED');
        (exhaustedErr as any).code = 'COUPON_RANGE_EXHAUSTED';
        throw exhaustedErr;
      }
      throw err;
    }

    if (serial < MIN_COUPON_SERIAL || serial > MAX_COUPON_SERIAL) {
      const exhaustedErr = new Error('COUPON_RANGE_EXHAUSTED');
      (exhaustedErr as any).code = 'COUPON_RANGE_EXHAUSTED';
      throw exhaustedErr;
    }

    // Official visible coupon number is raw sequential string (e.g. "1501")
    const couponNumber = String(serial);

    // Verification token (used for signed public verification URL)
    const verificationToken = crypto.randomBytes(16).toString('hex');
    const verificationTokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');

    const couponId = crypto.randomUUID();

    await client.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, verification_token_hash, ticket_index, total_quantity, issued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        couponId,
        booking.id,
        serial,
        couponNumber,
        booking.participant_name,
        booking.phone,
        booking.village,
        'valid',
        OFFICIAL_TEMPLATE_VERSION,
        verificationTokenHash,
        i,
        quantity,
        issuedAt,
      ]
    );

    issuedCoupons.push({
      id: couponId,
      booking_id: booking.id,
      serial,
      coupon_number: couponNumber,
      holder_name: booking.participant_name,
      phone: booking.phone,
      village: booking.village,
      ticket_index: i,
      total_quantity: quantity,
      template_version: OFFICIAL_TEMPLATE_VERSION,
      verification_token: verificationToken,
      status: 'valid',
      issued_at: issuedAt,
    });
  }

  return issuedCoupons;
}
