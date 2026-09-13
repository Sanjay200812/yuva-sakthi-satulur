import crypto from 'crypto';
import { config } from '../config/eventConfig.ts';
import {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentStatusInput,
  NormalizedPaymentStatus,
  RawWebhookInput,
  VerifiedWebhookEvent,
} from './provider.ts';

export class MockPaymentProvider implements PaymentProvider {
  public readonly name = 'mock_provider';

  constructor() {
    if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
      if (config.NODE_ENV === 'production' || config.PAYMENT_MODE === 'live') {
        throw new Error('FATAL: MockPaymentProvider cannot be instantiated in production or live payment mode.');
      }
    }
  }

  async createPaymentSession(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const amountRupees = (input.amountPaise / 100).toFixed(2);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Standard simulated UPI intent URI for testing
    const upiUri = `upi://pay?pa=yuvashakti@upi&pn=Yuva%20Shakti%20Youth&am=${amountRupees}&cu=INR&tn=TEST%20MODE%20Lucky%20Draw%20${input.clientTxnId}`;

    return {
      clientTxnId: input.clientTxnId,
      providerOrderId: `mock_ord_${Date.now().toString().slice(-6)}`,
      checkoutUrl: `${config.APP_URL}/mock-pay?txn=${input.clientTxnId}&amount=${amountRupees}`,
      qrData: upiUri,
      upiIntentUri: upiUri,
      expiresAt,
      rawMetadata: {
        mode: 'TEST MODE (Mock Provider)',
        timestamp: new Date().toISOString(),
      },
    };
  }

  public static confirmedTxns = new Set<string>();

  static confirmTxn(txnId: string) {
    this.confirmedTxns.add(txnId);
  }

  async fetchPaymentStatus(input: PaymentStatusInput): Promise<NormalizedPaymentStatus> {
    const isConfirmed = MockPaymentProvider.confirmedTxns.has(input.clientTxnId);
    return {
      clientTxnId: input.clientTxnId,
      providerPaymentId: isConfirmed ? `mock_pay_${input.clientTxnId}` : undefined,
      status: isConfirmed ? 'confirmed' : 'pending',
      rawStatus: isConfirmed ? 'SUCCESS_TEST_MODE' : 'PENDING_TEST_MODE',
    };
  }

  async verifyWebhook(input: RawWebhookInput): Promise<VerifiedWebhookEvent> {
    let payload: any;
    try {
      payload = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      return {
        isValid: false,
        providerEventId: '',
        clientTxnId: '',
        status: 'failed',
        amountPaise: 0,
        reason: 'Invalid JSON',
        rawPayload: null,
      };
    }

    return {
      isValid: true,
      providerEventId: payload.event_id || `mock_evt_${Date.now()}`,
      clientTxnId: payload.client_txn_id,
      providerPaymentId: payload.payment_id || `mock_utr_${Date.now().toString().slice(-6)}`,
      status: 'confirmed',
      amountPaise: payload.amount ? Math.round(payload.amount * 100) : 5000,
      rawPayload: payload,
    };
  }
}
