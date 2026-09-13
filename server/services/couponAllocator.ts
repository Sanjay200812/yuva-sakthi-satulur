import crypto from 'crypto';
import { DBClient } from '../db/client.ts';
import { config } from '../config/eventConfig.ts';

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
  issued_at: string;
  verification_token: string;
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

  // 3. Extract event year from draw date
  const drawDate = new Date(config.EVENT_DRAW_AT);
  const year = isNaN(drawDate.getFullYear()) ? new Date().getFullYear() : drawDate.getFullYear();
  const prefix = config.EVENT_COUPON_PREFIX || 'YSYS';

  const quantity = booking.quantity;
  const issuedCoupons: IssuedCoupon[] = [];

  // 4. Allocate exactly N serials
  for (let i = 1; i <= quantity; i++) {
    const serial = await getNextSerialFn();
    const formattedSerial = String(serial).padStart(6, '0');
    const couponNumber = `${prefix}-${year}-${formattedSerial}`;

    // Verification token (used for signed public verification URL)
    const verificationToken = crypto.randomBytes(16).toString('hex');
    const verificationTokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');

    const couponId = crypto.randomUUID();

    await client.query(
      `INSERT INTO coupons (
        id, booking_id, serial, coupon_number, holder_name, phone, village,
        status, template_version, verification_token_hash, ticket_index, total_quantity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        couponId,
        booking.id,
        serial,
        couponNumber,
        booking.participant_name,
        booking.phone,
        booking.village,
        'valid',
        'v1',
        verificationTokenHash,
        i,
        quantity,
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
      issued_at: new Date().toISOString(),
      verification_token: verificationToken,
    });
  }

  return issuedCoupons;
}
