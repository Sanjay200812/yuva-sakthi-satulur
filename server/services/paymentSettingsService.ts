import crypto from 'crypto';
import { db } from '../db/client.ts';
import { config, isValidUpiId } from '../config/eventConfig.ts';

export interface PaymentSettingsRecord {
  id: string;
  payee_upi_id: string;
  payee_display_name: string;
  coupon_price_paise: number;
  payments_enabled: boolean;
  max_quantity: number;
  payment_session_minutes: number;
  updated_at: string;
  updated_by?: string | null;
}

export interface PublicPaymentSettings {
  payeeUpiId: string;
  payeeDisplayName: string;
  couponPricePaise: number;
  couponPriceInr: number;
  paymentsEnabled: boolean;
  maxQuantity: number;
  paymentSessionMinutes: number;
  sessionDurationLabel: string;
  updatedAt?: string;
}

export interface UpdatePaymentSettingsInput {
  payeeUpiId?: string;
  payeeDisplayName?: string;
  couponPriceInr?: number;
  couponPricePaise?: number;
  paymentsEnabled?: boolean;
  maxQuantity?: number;
  payee_upi_id?: string;
  payee_display_name?: string;
  payments_enabled?: boolean;
  max_quantity?: number;
  coupon_price_inr?: number;
  coupon_price_paise?: number;
}

// In-memory cache for fast lookups
let cachedSettings: PaymentSettingsRecord | null = null;
let lastFetchedAt = 0;
const CACHE_TTL_MS = 5000; // 5 seconds maximum cache life if not explicitly invalidated

export function clearPaymentSettingsCache(): void {
  cachedSettings = null;
  lastFetchedAt = 0;
}

export function setCachedPaymentSettings(settings: PaymentSettingsRecord): void {
  cachedSettings = { ...settings };
  lastFetchedAt = Date.now();
}

/**
 * Retrieves authoritative payment settings from the database.
 * If no settings row exists yet, bootstraps from configuration/environment defaults.
 */
export async function getPaymentSettings(): Promise<PaymentSettingsRecord> {
  const now = Date.now();
  if (cachedSettings && (now - lastFetchedAt) < CACHE_TTL_MS) {
    return { ...cachedSettings };
  }

  try {
    const res = await db.query<PaymentSettingsRecord>('SELECT * FROM payment_settings LIMIT 1');
    if (res.rows && res.rows.length > 0) {
      const row = res.rows[0];
      const settings: PaymentSettingsRecord = {
        id: row.id || '00000000-0000-0000-0000-000000000002',
        payee_upi_id: row.payee_upi_id || config.PAYEE_UPI_ID || '9574876369@ybl',
        payee_display_name: row.payee_display_name || config.PAYEE_DISPLAY_NAME || 'Yuva Shakti Youth Satulur',
        coupon_price_paise: Number(row.coupon_price_paise) || config.EVENT_COUPON_PRICE_PAISE || 5000,
        payments_enabled: row.payments_enabled !== undefined ? Boolean(row.payments_enabled) : true,
        max_quantity: Number(row.max_quantity) || config.EVENT_MAX_COUPONS_PER_BOOKING || 20,
        payment_session_minutes: 5, // Permanently 5 minutes
        updated_at: row.updated_at || new Date().toISOString(),
        updated_by: row.updated_by || null,
      };
      setCachedPaymentSettings(settings);
      return settings;
    }

    // Bootstrap default row in DB if none exists
    const defaultSettings: PaymentSettingsRecord = {
      id: crypto.randomUUID(),
      payee_upi_id: (process.env.PAYEE_UPI_ID || config.PAYEE_UPI_ID || '9574876369@ybl').trim(),
      payee_display_name: (process.env.PAYEE_DISPLAY_NAME || config.PAYEE_DISPLAY_NAME || 'Yuva Shakti Youth Satulur').trim(),
      coupon_price_paise: Number(process.env.EVENT_COUPON_PRICE_PAISE || config.EVENT_COUPON_PRICE_PAISE || 5000),
      payments_enabled: true,
      max_quantity: Number(config.EVENT_MAX_COUPONS_PER_BOOKING || 20),
      payment_session_minutes: 5,
      updated_at: new Date().toISOString(),
      updated_by: null,
    };

    try {
      await db.query(
        `INSERT INTO payment_settings (
          id, payee_upi_id, payee_display_name, coupon_price_paise,
          payments_enabled, max_quantity, payment_session_minutes, updated_at, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          defaultSettings.id,
          defaultSettings.payee_upi_id,
          defaultSettings.payee_display_name,
          defaultSettings.coupon_price_paise,
          defaultSettings.payments_enabled,
          defaultSettings.max_quantity,
          5,
          defaultSettings.updated_at,
          null,
        ]
      );
    } catch {
      // Ignore insert collision
    }

    setCachedPaymentSettings(defaultSettings);
    return defaultSettings;
  } catch (err) {
    console.warn('⚠️ Error fetching payment_settings from DB, falling back to runtime config:', err);
    const fallback: PaymentSettingsRecord = {
      id: 'fallback-settings',
      payee_upi_id: config.PAYEE_UPI_ID || '9574876369@ybl',
      payee_display_name: config.PAYEE_DISPLAY_NAME || 'Yuva Shakti Youth Satulur',
      coupon_price_paise: config.EVENT_COUPON_PRICE_PAISE || 5000,
      payments_enabled: true,
      max_quantity: config.EVENT_MAX_COUPONS_PER_BOOKING || 20,
      payment_session_minutes: 5,
      updated_at: new Date().toISOString(),
      updated_by: null,
    };
    return fallback;
  }
}

/**
 * Updates payment settings in the database and immediately updates the cache.
 */
export async function updatePaymentSettings(
  input: UpdatePaymentSettingsInput,
  adminUserId?: string | null
): Promise<PaymentSettingsRecord> {
  const current = await getPaymentSettings();

  let cleanUpi = current.payee_upi_id;
  const rawUpi = input.payeeUpiId !== undefined ? input.payeeUpiId : (input as any).payee_upi_id;
  if (rawUpi !== undefined) {
    const trimmed = String(rawUpi).trim();
    if (!isValidUpiId(trimmed)) {
      throw new Error('INVALID_UPI_ID: Invalid UPI VPA format. Example: 7075920852@ybl');
    }
    cleanUpi = trimmed;
  }

  const rawName = input.payeeDisplayName !== undefined ? input.payeeDisplayName : (input as any).payee_display_name;
  const cleanName = rawName !== undefined ? String(rawName).trim() : current.payee_display_name;
  if (!cleanName || cleanName.length < 2) {
    throw new Error('INVALID_DISPLAY_NAME: Business display name must be at least 2 characters.');
  }

  let cleanPrice = current.coupon_price_paise;
  if (input.couponPriceInr !== undefined) {
    cleanPrice = Math.round(Number(input.couponPriceInr) * 100);
  } else if (input.couponPricePaise !== undefined) {
    cleanPrice = Math.round(Number(input.couponPricePaise));
  }
  if (cleanPrice <= 0 || isNaN(cleanPrice)) {
    throw new Error('INVALID_PRICE: Coupon price must be greater than zero.');
  }

  const cleanEnabled = input.paymentsEnabled !== undefined ? Boolean(input.paymentsEnabled) : current.payments_enabled;
  const cleanMaxQty = input.maxQuantity !== undefined ? Math.min(Math.max(1, parseInt(String(input.maxQuantity), 10)), 100) : current.max_quantity;
  const updatedAt = new Date().toISOString();

  // Try updating first
  const updateRes = await db.query(
    `UPDATE payment_settings SET
      payee_upi_id = $1,
      payee_display_name = $2,
      coupon_price_paise = $3,
      payments_enabled = $4,
      max_quantity = $5,
      payment_session_minutes = 5,
      updated_at = $6,
      updated_by = $7`,
    [cleanUpi, cleanName, cleanPrice, cleanEnabled, cleanMaxQty, updatedAt, adminUserId || null]
  );

  if (updateRes.rowCount === 0) {
    // If no row existed, insert new
    await db.query(
      `INSERT INTO payment_settings (
        id, payee_upi_id, payee_display_name, coupon_price_paise,
        payments_enabled, max_quantity, payment_session_minutes, updated_at, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [crypto.randomUUID(), cleanUpi, cleanName, cleanPrice, cleanEnabled, cleanMaxQty, 5, updatedAt, adminUserId || null]
    );
  }

  const updated: PaymentSettingsRecord = {
    id: current.id || crypto.randomUUID(),
    payee_upi_id: cleanUpi,
    payee_display_name: cleanName,
    coupon_price_paise: cleanPrice,
    payments_enabled: cleanEnabled,
    max_quantity: cleanMaxQty,
    payment_session_minutes: 5,
    updated_at: updatedAt,
    updated_by: adminUserId || null,
  };

  // Invalidate and refresh cache
  setCachedPaymentSettings(updated);

  // Sync to config object in memory
  config.PAYEE_UPI_ID = cleanUpi;
  config.PAYEE_DISPLAY_NAME = cleanName;
  config.EVENT_COUPON_PRICE_PAISE = cleanPrice;
  config.PAYMENTS_ENABLED = cleanEnabled;
  config.EVENT_MAX_COUPONS_PER_BOOKING = cleanMaxQty;

  return updated;
}

/**
 * Public-safe payment settings projection for /api/config or public endpoints.
 */
export async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  const settings = await getPaymentSettings();
  return {
    payeeUpiId: settings.payee_upi_id,
    payeeDisplayName: settings.payee_display_name,
    couponPricePaise: settings.coupon_price_paise,
    couponPriceInr: settings.coupon_price_paise / 100,
    paymentsEnabled: settings.payments_enabled,
    maxQuantity: settings.max_quantity,
    paymentSessionMinutes: 5,
    sessionDurationLabel: '5 Minutes — Security Rule',
    updatedAt: settings.updated_at,
  };
}
