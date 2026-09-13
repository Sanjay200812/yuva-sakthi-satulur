import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Runtime environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  APP_URL: z.preprocess((val) => {
    if (typeof val === 'string') {
      let trimmed = val.trim();
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = `https://${trimmed}`;
      }
      return trimmed.replace(/\/+$/, '');
    }
    return val;
  }, z.string().url()).default('http://localhost:3000'),

  // Security
  SESSION_SECRET: z.string().min(16).default('super-secret-yuva-shakti-key-change-in-prod-min-16-chars'),
  ADMIN_EMAIL: z.string().email().default('admin@yuvashakti.org'),

  // Database
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Direct Merchant-UPI & Gemini Verification Configuration
  PAYMENT_MODE: z.string().default('direct_upi_manual_reconciliation'),
  PAYEE_UPI_ID: z.string().default(process.env.PAYEE_UPI_ID || '9574876369@ybl'),
  PAYEE_DISPLAY_NAME: z.string().default(process.env.PAYEE_DISPLAY_NAME || 'Yuva Shakti Youth Satulur'),
  UPI_TRANSACTION_NOTE_PREFIX: z.string().default(process.env.UPI_TRANSACTION_NOTE_PREFIX || 'YSYS'),
  PAYMENT_SESSION_MINUTES: z.coerce.number().int().positive().default(20),
  PAYMENT_SCREENSHOT_MAX_BYTES: z.coerce.number().int().positive().default(5242880),
  PAYMENT_PROOF_BUCKET: z.string().default('payment-proofs'),
  GEMINI_API_KEY: z.string().default(process.env.GEMINI_API_KEY || ''),
  GEMINI_MODEL: z.string().default(process.env.GEMINI_MODEL || 'gemini-2.5-flash'),
  GEMINI_STORE_INTERACTIONS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  FIELD_ENCRYPTION_KEY: z.string().default(process.env.FIELD_ENCRYPTION_KEY || 'c9b68a3f81e9b2512a8848db92ea91bc310dc2e811c7fae98f0601931889c02b'),

  // Event Configuration
  EVENT_NAME: z.string().default('Yuva Shakti Youth Satulur Lucky Draw'),
  EVENT_ORGANIZER: z.string().default('Yuva Shakti Youth, Satulur'),
  EVENT_PRIZE: z.string().default('20 KG Laddu'),
  EVENT_VENUE: z.string().default('Satulur Center, Guntur District, Andhra Pradesh'),
  EVENT_HELPLINE: z.string().default('+91 95748 76369'),
  EVENT_DRAW_AT: z.string().default('2026-10-19T18:30:00+05:30'),
  EVENT_TIMEZONE: z.string().default('Asia/Kolkata'),
  EVENT_COUPON_PREFIX: z.string().default('YSYS'),
  EVENT_COUPON_PRICE_PAISE: z.coerce.number().int().positive().default(5000),
  EVENT_MAX_COUPONS_PER_BOOKING: z.coerce.number().int().positive().default(20),

  // Go-Live Gates (Fail closed)
  BOOKING_OPEN: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  PAYMENTS_ENABLED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  LEGAL_APPROVAL_CONFIRMED: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  LOTTERY_LICENCE_NUMBER: z.string().optional().default(''),
  LOTTERY_LICENCE_DATE: z.string().optional().default(''),
  TEMPLATE_VERSION: z.string().default('v1-official'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment configuration error:', parsedEnv.error.format());
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

export const config = parsedEnv.success ? parsedEnv.data : envSchema.parse({});

// Server validation for payment creation
export function canAcceptPayments(): { allowed: boolean; reason?: string } {
  if (!config.BOOKING_OPEN) {
    return { allowed: false, reason: 'Bookings are currently closed for this event.' };
  }
  if (!config.PAYMENTS_ENABLED) {
    return { allowed: false, reason: 'Online payments are currently disabled.' };
  }
  if (!config.LEGAL_APPROVAL_CONFIRMED && config.NODE_ENV === 'production') {
    return { allowed: false, reason: 'Legal compliance confirmation is pending.' };
  }
  const drawDate = new Date(config.EVENT_DRAW_AT);
  if (isNaN(drawDate.getTime())) {
    return { allowed: false, reason: 'Configured event draw date is invalid.' };
  }
  if (drawDate.getTime() < Date.now()) {
    return { allowed: false, reason: 'The lucky draw event has already concluded.' };
  }
  return { allowed: true };
}

// Safe public projection for frontend client consumption
export function getPublicConfig() {
  const paymentGate = canAcceptPayments();
  return {
    eventName: config.EVENT_NAME,
    organizer: config.EVENT_ORGANIZER,
    prize: config.EVENT_PRIZE,
    venue: config.EVENT_VENUE,
    helpline: config.EVENT_HELPLINE,
    drawAt: config.EVENT_DRAW_AT,
    timezone: config.EVENT_TIMEZONE,
    couponPrefix: config.EVENT_COUPON_PREFIX,
    couponPricePaise: config.EVENT_COUPON_PRICE_PAISE,
    couponPrice: config.EVENT_COUPON_PRICE_PAISE / 100,
    maxCouponsPerBooking: config.EVENT_MAX_COUPONS_PER_BOOKING,
    bookingOpen: config.BOOKING_OPEN,
    paymentsEnabled: config.PAYMENTS_ENABLED,
    legalApprovalConfirmed: config.LEGAL_APPROVAL_CONFIRMED,
    licenceNumber: config.LOTTERY_LICENCE_NUMBER || null,
    licenceDate: config.LOTTERY_LICENCE_DATE || null,
    paymentMode: config.PAYMENT_MODE,
    payeeUpiId: config.PAYEE_UPI_ID,
    payeeDisplayName: config.PAYEE_DISPLAY_NAME,
    sessionMinutes: config.PAYMENT_SESSION_MINUTES,
    maxScreenshotBytes: config.PAYMENT_SCREENSHOT_MAX_BYTES,
    canBook: paymentGate.allowed,
    unavailableReason: paymentGate.reason || null,
  };
}
