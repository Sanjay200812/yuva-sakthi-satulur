import { CouponBooking } from '../types.ts';

export interface BookingCreationParams {
  name: string;
  phone: string;
  village: string;
  quantity: number;
}

export interface BookingCreationResponse {
  booking: {
    publicId: string;
    name: string;
    phone: string;
    village: string;
    quantity: number;
    totalAmount: number;
    status: string;
  };
  payment: {
    clientTxnId: string;
    orderId?: string;
    checkoutUrl?: string;
    qrData?: string;
    upiIntentUri?: string;
    expiresAt: string;
    statusToken: string;
    isTestMode: boolean;
  };
}

/**
 * Creates a genuine booking record on the server and initiates a VyaparGateway payment session.
 */
export async function createBooking(params: BookingCreationParams): Promise<BookingCreationResponse> {
  const response = await fetch('/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message || 'Failed to create booking.');
  }

  return data.data;
}

/**
 * Polls the backend status endpoint until payment is confirmed, failed, or timed out.
 */
export async function pollPaymentStatus(
  publicId: string,
  statusToken: string,
  onConfirmed: (booking: CouponBooking) => void,
  onError: (msg: string) => void,
  maxAttempts = 60,
  intervalMs = 3000
): Promise<() => void> {
  let attempts = 0;
  let isCancelled = false;

  const check = async () => {
    if (isCancelled) return;
    attempts++;

    try {
      const res = await fetch(`/api/bookings/${publicId}/status?token=${encodeURIComponent(statusToken)}`);
      if (!res.ok) {
        if (attempts >= maxAttempts) {
          onError('Payment status check timed out. Please verify with helpline.');
        }
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        const b = json.data;
        if (b.status === 'payment_confirmed') {
          const couponNumbers = (b.coupons || []).map((c: any) => c.coupon_number);
          const confirmedBooking: CouponBooking = {
            id: b.publicId,
            ticketNumbers: couponNumbers,
            name: b.coupons?.[0]?.holder_name || 'Participant',
            phone: b.coupons?.[0]?.phone || '',
            village: b.coupons?.[0]?.village || 'Satulur',
            quantity: b.quantity,
            totalAmount: b.totalAmount,
            bookedAt: new Date(b.paidAt || Date.now()).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
            status: 'confirmed',
            transactionRef: 'VYAPAR_UPI_VERIFIED',
            paymentGateway: 'VyaparGateway UPI',
            downloadUrl: b.downloadUrl,
          };
          onConfirmed(confirmedBooking);
          return;
        } else if (b.status === 'payment_failed' || b.status === 'expired') {
          onError('Payment was not completed or expired. Please try again.');
          return;
        }
      }
    } catch {
      // transient network error, continue polling
    }

    if (attempts < maxAttempts && !isCancelled) {
      setTimeout(check, intervalMs);
    } else if (!isCancelled) {
      onError('Payment verification window timed out. If money was deducted, your ticket will be confirmed shortly.');
    }
  };

  setTimeout(check, intervalMs);

  return () => {
    isCancelled = true;
  };
}

/**
 * Test mode helper: Simulates payment confirmation in development only.
 */
export async function simulateTestPayment(clientTxnId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/test-mode/simulate-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientTxnId }),
    });
    const json = await res.json();
    return json.success === true;
  } catch {
    return false;
  }
}

/**
 * Real-time instant status polling targeting /api/payment/status?order_id=... every 2-3 seconds
 */
export function pollVyaparPaymentStatus(
  orderId: string,
  onSuccess: (booking: CouponBooking) => void,
  onFailed: (errorMessage: string) => void,
  intervalMs = 2500, // Every 2-3 seconds as specified
  maxAttempts = 120
): () => void {
  let attempts = 0;
  let isCancelled = false;

  const check = async () => {
    if (isCancelled) return;
    attempts++;

    try {
      const res = await fetch(`/api/payment/status?order_id=${encodeURIComponent(orderId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'SUCCESS' && json.booking) {
          const b = json.booking;
          const couponNumbers = (b.coupons || []).map((c: any) => c.coupon_number);
          const confirmedBooking: CouponBooking = {
            id: b.publicId || b.id || orderId,
            ticketNumbers: couponNumbers,
            name: b.name || b.coupons?.[0]?.holder_name || 'Participant',
            phone: b.phone || b.coupons?.[0]?.phone || '',
            village: b.village || b.coupons?.[0]?.village || 'Satulur',
            quantity: b.quantity || 1,
            totalAmount: b.totalAmount || 50,
            bookedAt: new Date(b.paidAt || Date.now()).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
            status: 'confirmed',
            transactionRef: 'VYAPAR_UPI_VERIFIED',
            paymentGateway: 'VyaparGateway UPI',
            downloadUrl: `/api/coupons/${b.publicId || orderId}/download.pdf`,
          };
          onSuccess(confirmedBooking);
          return;
        } else if (json.status === 'FAILED') {
          onFailed(json.message || 'Payment was cancelled or failed. Please try again.');
          return;
        }
      }
    } catch {
      // transient network error, keep polling
    }

    if (attempts < maxAttempts && !isCancelled) {
      setTimeout(check, intervalMs);
    } else if (!isCancelled) {
      onFailed('Payment verification window timed out. If money was deducted, your ticket will be confirmed shortly.');
    }
  };

  setTimeout(check, intervalMs);

  return () => {
    isCancelled = true;
  };
}

