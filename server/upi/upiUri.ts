import QRCode from 'qrcode';
import { config } from '../config/eventConfig.ts';

export interface UpiSessionInput {
  publicBookingId: string;
  transactionReference: string;
  totalAmountPaise: number;
  participantName: string;
}

export interface UpiSessionResult {
  canonicalUri: string;
  qrDataUrl: string;
  payeeUpiId: string;
  maskedPayeeUpiId: string;
  payeeDisplayName: string;
  amountInr: string;
  totalAmountPaise: number;
  transactionReference: string;
  expiresAt: string;
  appIntents: {
    phonepe: string;
    google_pay: string;
    paytm: string;
    other_upi: string;
    standard: string;
  };
}

export function maskUpiId(upiId: string): string {
  if (!upiId) return '';
  const parts = upiId.split('@');
  if (parts.length !== 2) return upiId;
  const user = parts[0];
  const handle = parts[1];
  if (user.length <= 4) {
    return `${user[0]}***@${handle}`;
  }
  return `${user.slice(0, 2)}****${user.slice(-2)}@${handle}`;
}

export function generateCanonicalUpiUri(input: {
  payeeUpiId: string;
  payeeDisplayName: string;
  transactionReference: string;
  totalAmountPaise: number;
  note: string;
}): string {
  const amountInr = (input.totalAmountPaise / 100).toFixed(2);
  const params = new URLSearchParams();
  params.set('pa', input.payeeUpiId);
  params.set('pn', input.payeeDisplayName);
  params.set('tr', input.transactionReference);
  params.set('am', amountInr);
  params.set('cu', 'INR');
  params.set('tn', input.note);
  return `upi://pay?${params.toString()}`;
}

export async function generateUpiPaymentSession(input: UpiSessionInput): Promise<UpiSessionResult> {
  const amountInr = (input.totalAmountPaise / 100).toFixed(2);
  const payeeId = config.PAYEE_UPI_ID;
  const payeeName = config.PAYEE_DISPLAY_NAME;
  const note = `${config.UPI_TRANSACTION_NOTE_PREFIX} Lucky Draw ${input.publicBookingId}`;

  // NPCI Canonical UPI URI specification
  // upi://pay?pa=address&pn=name&tr=ref&am=amount&cu=INR&tn=note
  const params = new URLSearchParams();
  params.set('pa', payeeId);
  params.set('pn', payeeName);
  params.set('tr', input.transactionReference);
  params.set('am', amountInr);
  params.set('cu', 'INR');
  params.set('tn', note);

  const canonicalUri = `upi://pay?${params.toString()}`;

  // Generate QR Code data URL with dark purple branding
  const qrDataUrl = await QRCode.toDataURL(canonicalUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: {
      dark: '#070B19',
      light: '#FFFFFF',
    },
  });

  const expiresAt = new Date(Date.now() + config.PAYMENT_SESSION_MINUTES * 60 * 1000).toISOString();

  // App-specific intent URIs
  const queryString = params.toString();
  const appIntents = {
    phonepe: `phonepe://pay?${queryString}`,
    google_pay: `gpay://upi/pay?${queryString}`,
    paytm: `paytmmp://pay?${queryString}`,
    other_upi: canonicalUri,
    standard: canonicalUri,
  };

  return {
    canonicalUri,
    qrDataUrl,
    payeeUpiId: payeeId,
    maskedPayeeUpiId: maskUpiId(payeeId),
    payeeDisplayName: payeeName,
    amountInr,
    totalAmountPaise: input.totalAmountPaise,
    transactionReference: input.transactionReference,
    expiresAt,
    appIntents,
  };
}
