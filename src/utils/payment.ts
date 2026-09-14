import { CouponBooking } from '../types.ts';
import { safeFetchJson } from './api.ts';

export interface BookingCreationParams {
  name: string;
  phone: string;
  village: string;
  quantity: number;
  selectedApp?: string;
}

export interface BookingCreationResponse {
  booking: {
    id: string;
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
    orderId: string;
    qrDataUrl: string;
    canonicalUri: string;
    payeeUpiId: string;
    rawPayeeUpiId: string;
    payeeDisplayName: string;
    amountInr: string;
    totalAmount: number;
    expiresAt: string;
    statusToken: string;
    downloadToken?: string;
    appIntents: {
      phonepe: string;
      google_pay: string;
      paytm: string;
      other_upi: string;
      standard: string;
      fam?: string;
    };
  };
}

export interface PaymentProofParams {
  publicId: string;
  screenshotBase64: string;
  selectedApp: string;
  consentGiven: boolean;
  statusToken?: string;
  isRecovery?: boolean;
}

export interface PaymentProofResponse {
  submissionId: string;
  publicId: string;
  status: string;
  message: string;
  coupons?: any[];
  details: {
    utrMatched: boolean | null;
    amountMatched: boolean | null;
    statusMatched: boolean | null;
    payeeMatched: boolean | null;
  };
}

/**
 * Creates a genuine booking record on the server and generates a Direct UPI payment session.
 */
export async function createBooking(params: BookingCreationParams): Promise<BookingCreationResponse> {
  const data = await safeFetchJson<any>(
    '/api/bookings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    },
    'Booking service'
  );

  if (!data.success) {
    throw new Error(data.error?.message || 'Failed to create booking.');
  }

  return data.data;
}

/**
 * Submits mandatory payment proof (payment screenshot and user consent) for automated verification.
 */
export async function submitPaymentProof(params: PaymentProofParams): Promise<PaymentProofResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.statusToken) {
    headers['Authorization'] = `Bearer ${params.statusToken}`;
  }

  const data = await safeFetchJson<any>(
    `/api/bookings/${params.publicId}/payment-proof`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        screenshotBase64: params.screenshotBase64,
        selectedApp: params.selectedApp,
        consentGiven: params.consentGiven,
        statusToken: params.statusToken,
        isRecovery: params.isRecovery,
      }),
    },
    'Payment proof service'
  );

  if (!data.success) {
    throw new Error(data.error?.message || 'Failed to submit payment proof.');
  }

  return data.data;
}

export interface RetryVerificationParams {
  publicId: string;
  statusToken?: string;
}

/**
 * Retries automated verification for an existing payment proof without requiring a new upload or payment.
 */
export async function retryPaymentVerification(params: RetryVerificationParams): Promise<PaymentProofResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.statusToken) {
    headers['Authorization'] = `Bearer ${params.statusToken}`;
  }

  const data = await safeFetchJson<any>(
    `/api/bookings/${params.publicId}/retry-verification`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ statusToken: params.statusToken }),
    },
    'Verification retry service'
  );

  if (!data.success) {
    throw new Error(data.error?.message || 'Failed to retry verification.');
  }

  return data.data;
}

/**
 * Polls the backend status endpoint until payment is confirmed, failed, or timed out.
 */
export function pollPaymentStatus(
  publicId: string,
  onStatusChange: (status: string, message: string, booking?: CouponBooking) => void,
  intervalMs = 3000,
  statusToken?: string
): () => void {
  let isCancelled = false;

  const check = async () => {
    if (isCancelled) return;

    try {
      const headers: Record<string, string> = {};
      if (statusToken) {
        headers['Authorization'] = `Bearer ${statusToken}`;
      }
      const json = await safeFetchJson<any>(
        `/api/bookings/${publicId}/status`,
        { headers },
        'Payment status'
      );
      if (json.success && json.data) {
        const b = json.data;

        if (b.status === 'payment_confirmed' || b.status === 'proof_verified') {
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
            transactionRef: 'AUTOMATED_PROOF_VERIFIED',
          };
          onStatusChange('payment_confirmed', b.message, confirmedBooking);
          return; // stop polling
        }

        onStatusChange(b.status, b.message);
      }
    } catch {
      // transient network error, continue polling
    }

    if (!isCancelled) {
      setTimeout(check, intervalMs);
    }
  };

  check();

  return () => {
    isCancelled = true;
  };
}

/**
 * Test helper for development / Vitest simulations
 */
export async function simulateAdminBankConfirm(bookingPublicId: string): Promise<boolean> {
  try {
    const json = await safeFetchJson<any>(
      '/api/test-mode/simulate-admin-confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingPublicId }),
      },
      'Payment simulation'
    );
    return json.success === true;
  } catch {
    return false;
  }
}

