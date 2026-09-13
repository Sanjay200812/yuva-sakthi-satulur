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

export class VyaparGatewayProvider implements PaymentProvider {
  public readonly name = 'vyapar_gateway';

  private get baseUrl(): string {
    let url = config.VYAPAR_GATEWAY_BASE_URL || 'https://vyapargateway.com/api/v1/';
    if (!url.endsWith('/')) url += '/';
    return url;
  }

  async createPaymentSession(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const amountRupees = Number((input.amountPaise / 100).toFixed(2));

    const payload = {
      amount: amountRupees,
      client_txn_id: input.clientTxnId,
      customer_name: input.customerName,
      customer_email: 'support@yuvashakti.org',
      customer_mobile: input.customerPhone,
      redirect_url: input.redirectUrl,
      merchant_id: config.VYAPAR_GATEWAY_MERCHANT_ID || undefined,
    };

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry

    // If live credentials are not set, throw diagnostic error
    if (!config.VYAPAR_GATEWAY_API_KEY) {
      throw new Error(
        'VyaparGateway API Key (VYAPAR_GATEWAY_API_KEY) is not configured. Please supply your merchant credentials in .env.'
      );
    }

    const response = await fetch(`${this.baseUrl}create_order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.VYAPAR_GATEWAY_API_KEY,
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VyaparGateway order creation failed [${response.status}]: ${errorText}`);
    }

    const data = await response.json();

    return {
      clientTxnId: input.clientTxnId,
      providerOrderId: data.order_id || data.id || `vg_${Date.now()}`,
      checkoutUrl: data.payment_url || data.checkout_url || data.hosted_url,
      qrData: data.qr_data || data.qr_code || data.upi_intent,
      upiIntentUri: data.upi_intent || data.upi_url,
      expiresAt: data.expires_at || expiresAt,
      rawMetadata: {
        order_id: data.order_id || data.id,
        created_at: new Date().toISOString(),
      },
    };
  }

  async fetchPaymentStatus(input: PaymentStatusInput): Promise<NormalizedPaymentStatus> {
    if (!config.VYAPAR_GATEWAY_API_KEY) {
      throw new Error('VyaparGateway API Key not configured for status check.');
    }

    const response = await fetch(`${this.baseUrl}check_order_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.VYAPAR_GATEWAY_API_KEY,
      },
      body: JSON.stringify({
        client_txn_id: input.clientTxnId,
        order_id: input.providerOrderId,
      }),
    });

    if (!response.ok) {
      return {
        clientTxnId: input.clientTxnId,
        status: 'pending',
        rawStatus: `HTTP_${response.status}`,
      };
    }

    const data = await response.json();
    const rawStatus = (data.status || '').toLowerCase();

    let normalized: 'pending' | 'confirmed' | 'failed' | 'expired' = 'pending';
    if (['success', 'paid', 'confirmed', 'completed'].includes(rawStatus)) {
      normalized = 'confirmed';
    } else if (['failed', 'failure', 'rejected'].includes(rawStatus)) {
      normalized = 'failed';
    } else if (['expired', 'cancelled'].includes(rawStatus)) {
      normalized = 'expired';
    }

    return {
      clientTxnId: input.clientTxnId,
      providerPaymentId: data.payment_id || data.utr || data.txn_id,
      status: normalized,
      amountPaise: data.amount ? Math.round(Number(data.amount) * 100) : undefined,
      rawStatus,
    };
  }

  async verifyWebhook(input: RawWebhookInput): Promise<VerifiedWebhookEvent> {
    const rawBody = input.rawBody;
    const headers = input.headers;

    const signatureHeader =
      headers['x-vyapargateway-signature'] ||
      headers['x-signature'] ||
      headers['x-hub-signature'];

    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!signature) {
      return {
        isValid: false,
        providerEventId: '',
        clientTxnId: '',
        status: 'failed',
        amountPaise: 0,
        reason: 'Missing webhook signature header',
        rawPayload: null,
      };
    }

    const secret = config.VYAPAR_GATEWAY_WEBHOOK_SECRET || (config.PAYMENT_MODE === 'test' ? 'test_webhook_secret_key_12345' : '');
    if (!secret) {
      return {
        isValid: false,
        providerEventId: '',
        clientTxnId: '',
        status: 'failed',
        amountPaise: 0,
        reason: 'Server webhook secret not configured',
        rawPayload: null,
      };
    }

    // 1. HMAC SHA-256 calculation on the RAW buffer
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // 2. Constant-time comparison
    const sigBuffer = Buffer.from(signature, 'hex');
    const compBuffer = Buffer.from(computedSignature, 'hex');

    if (sigBuffer.length !== compBuffer.length || !crypto.timingSafeEqual(sigBuffer, compBuffer)) {
      return {
        isValid: false,
        providerEventId: '',
        clientTxnId: '',
        status: 'failed',
        amountPaise: 0,
        reason: 'Invalid webhook signature mismatch',
        rawPayload: null,
      };
    }

    // Parse payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return {
        isValid: false,
        providerEventId: '',
        clientTxnId: '',
        status: 'failed',
        amountPaise: 0,
        reason: 'Invalid JSON payload in webhook body',
        rawPayload: null,
      };
    }

    // 3. Timestamp check (tolerance: 5 minutes = 300,000ms)
    const timestampHeader = headers['x-vyapargateway-timestamp'] || payload.timestamp;
    if (timestampHeader) {
      const ts = Number(timestampHeader);
      const now = Date.now();
      const eventTime = ts > 1e11 ? ts : ts * 1000;
      if (Math.abs(now - eventTime) > 5 * 60 * 1000) {
        return {
          isValid: false,
          providerEventId: payload.event_id || payload.txn_id || `evt_${Date.now()}`,
          clientTxnId: payload.client_txn_id || '',
          status: 'failed',
          amountPaise: 0,
          reason: 'Webhook timestamp outside 5-minute tolerance',
          rawPayload: payload,
        };
      }
    }

    const rawStatus = (payload.status || payload.payment_status || '').toLowerCase();
    const isPaid = ['success', 'paid', 'confirmed', 'completed'].includes(rawStatus);

    return {
      isValid: true,
      providerEventId: payload.event_id || payload.payment_id || `ev_${payload.client_txn_id || payload.order_id || Date.now()}`,
      clientTxnId: payload.client_txn_id || payload.order_id || payload.txn_id || '',
      providerPaymentId: payload.payment_id || payload.utr || payload.txn_id,
      status: isPaid ? 'confirmed' : 'failed',
      amountPaise: payload.amount ? Math.round(Number(payload.amount) * 100) : 0,
      rawPayload: payload,
    };
  }
}
