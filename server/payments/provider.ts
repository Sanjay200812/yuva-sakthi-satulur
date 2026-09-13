export interface CreatePaymentInput {
  bookingId: string;
  publicBookingId: string;
  clientTxnId: string;
  amountPaise: number;
  customerName: string;
  customerPhone: string;
  customerVillage: string;
  redirectUrl: string;
}

export interface CreatePaymentResult {
  clientTxnId: string;
  providerOrderId?: string;
  checkoutUrl?: string;
  qrData?: string;
  upiIntentUri?: string;
  expiresAt: string;
  rawMetadata?: any;
}

export interface PaymentStatusInput {
  clientTxnId: string;
  providerOrderId?: string;
}

export interface NormalizedPaymentStatus {
  clientTxnId: string;
  providerPaymentId?: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  amountPaise?: number;
  rawStatus?: string;
}

export interface RawWebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface VerifiedWebhookEvent {
  isValid: boolean;
  providerEventId: string;
  clientTxnId: string;
  providerPaymentId?: string;
  status: 'confirmed' | 'failed' | 'pending';
  amountPaise: number;
  reason?: string;
  rawPayload: any;
}

export interface PaymentProvider {
  name: string;
  createPaymentSession(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  fetchPaymentStatus(input: PaymentStatusInput): Promise<NormalizedPaymentStatus>;
  verifyWebhook(input: RawWebhookInput): Promise<VerifiedWebhookEvent>;
}
