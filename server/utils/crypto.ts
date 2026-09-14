import crypto from 'crypto';
import { config } from '../config/eventConfig.ts';

function getKeyBuffer(): Buffer {
  const key = config.FIELD_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FIELD_ENCRYPTION_KEY is required in production.');
    }
    // Deterministic fallback for local development / testing only
    return crypto.createHash('sha256').update('dev-key-yuva-shakti-satulur').digest();
  }

  // Expect 64 hex characters (32 bytes) or raw 32 characters
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }

  if (key.length === 32) {
    return Buffer.from(key, 'utf8');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) in production.');
  }

  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypts sensitive fields (like raw 12-digit UPI RRN) with authenticated AES-256-GCM.
 * Uses a random 12-byte IV for every encryption and stores version + IV + Auth Tag + Ciphertext.
 */
export function encryptSensitiveField(plaintext: string): string {
  if (!plaintext) return '';
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts authenticated AES-256-GCM ciphertext payload.
 */
export function decryptSensitiveField(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // Legacy fallback or invalid format
    return payload;
  }

  const [, ivHex, authTagHex, encryptedHex] = parts;
  const key = getKeyBuffer();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
