import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSharp } from '../utils/sharpHelper.ts';
import { config, isAnonKey } from '../config/eventConfig.ts';

export interface ProcessedImageResult {
  sanitizedBuffer: Buffer;
  storagePath: string;
  sha256: string;
  phash: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalFilename?: string;
  originalMime?: string;
  detectedMime?: string;
  isSuspiciousFilename?: boolean;
}

/**
 * Checks if the current execution context is a production/serverless environment.
 */
export function isProductionEnvironment(): boolean {
  return (
    config.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV === 'production'
  );
}

/**
 * Checks if a filename contains explicit AI generator signatures.
 * Does NOT flag generic filenames such as file000.jpg, IMG_2026.jpg, screenshot.png.
 */
export function checkSuspiciousFilename(filename?: string): boolean {
  if (!filename || typeof filename !== 'string') return false;
  const lower = filename.toLowerCase();
  const suspiciousRegex = /(?:chatgpt|openai[-_]generated|gemini[-_]generated|dall[-_]?e|midjourney|firefly|ai[-_]generated)/i;
  return suspiciousRegex.test(lower);
}

/**
 * Creates authenticated Supabase client for private storage operations.
 */
export function getSupabaseStorageClient(): SupabaseClient {
  const url = (process.env.SUPABASE_URL || config.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!url || !key) {
    throw new Error('STORAGE_NOT_CONFIGURED: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  }

  if (isAnonKey(key)) {
    throw new Error('STORAGE_NOT_CONFIGURED: Anon key supplied as SUPABASE_SERVICE_ROLE_KEY. Service role key is mandatory for storage operations.');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Validates image magic bytes to ensure file is a legitimate raster image (PNG, JPEG, WebP)
 * Rejects SVG, HTML, EXE, ZIP, PDF, or arbitrary non-image binaries.
 */
export function validateMagicBytes(buffer: Buffer): { valid: boolean; detectedType?: string; error?: string } {
  if (!buffer || buffer.length < 12) {
    return { valid: false, error: 'File buffer is too small or empty.' };
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, detectedType: 'image/jpeg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    return { valid: true, detectedType: 'image/png' };
  }

  // 3. WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { valid: true, detectedType: 'image/webp' };
  }

  return {
    valid: false,
    error: 'Invalid file signature. Only raster payment screenshots (PNG, JPEG, WebP) are permitted.',
  };
}

export async function validateScreenshotBuffer(buffer: Buffer): Promise<{ valid: boolean; detectedType?: string }> {
  const result = validateMagicBytes(buffer);
  if (!result.valid) {
    throw new Error(result.error || 'Invalid file signature.');
  }
  return result;
}

/**
 * Computes a 64-bit difference hash (dHash) for near-duplicate image detection.
 * Resizes to 9x8 grayscale and compares horizontal gradients.
 */
export async function computePerceptualHash(buffer: Buffer): Promise<string> {
  try {
    const sharp = await getSharp();
    if (!sharp) {
      return '0000000000000000';
    }
    const raw = await sharp(buffer)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    let hash = '';
    for (let row = 0; row < 8; row++) {
      let rowByte = 0;
      for (let col = 0; col < 8; col++) {
        const left = raw[row * 9 + col];
        const right = raw[row * 9 + col + 1];
        if (left > right) {
          rowByte |= 1 << (7 - col);
        }
      }
      hash += rowByte.toString(16).padStart(2, '0');
    }
    return hash;
  } catch {
    return '0000000000000000';
  }
}

/**
 * Computes the Hamming distance (number of bit positions where bits differ)
 * between two 64-bit hexadecimal hashes (16 hex chars).
 */
export function hammingDistance(h1: string, h2: string): number {
  if (!h1 || !h2) return 64;
  const len = Math.min(h1.length, h2.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const v1 = parseInt(h1[i], 16);
    const v2 = parseInt(h2[i], 16);
    let xor = (isNaN(v1) ? 0 : v1) ^ (isNaN(v2) ? 0 : v2);
    while (xor > 0) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  dist += Math.abs(h1.length - h2.length) * 4;
  return dist;
}

/**
 * Uploads sanitized screenshot buffer to private Supabase Storage bucket.
 * In production: Supabase upload is mandatory. Fails closed with structured errors.
 * In dev/test: Returns false on failure to allow local filesystem fallback.
 */
async function uploadToSupabaseStorage(
  buffer: Buffer,
  objectPath: string,
  mimeType: string,
  bookingId: string
): Promise<boolean> {
  const isProduction = isProductionEnvironment();
  const supabaseUrl = (process.env.SUPABASE_URL || config.SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceRoleKey || config.PAYMENT_PROOF_BUCKET !== 'payment-proofs') {
    const diagnostic = `Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET || 'missing'}
status=config_missing
message=SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY or PAYMENT_PROOF_BUCKET missing in production
objectPath=${objectPath}
bookingId=${bookingId}
runtime: NODE_ENV=${process.env.NODE_ENV || 'undefined'}, VERCEL=${process.env.VERCEL || 'undefined'}, VERCEL_ENV=${process.env.VERCEL_ENV || 'undefined'}`;

    if (isProduction) {
      console.error(diagnostic);
      throw new Error('STORAGE_NOT_CONFIGURED: Supabase storage credentials or bucket are not configured in production.');
    }
    return false;
  }

  if (isAnonKey(serviceRoleKey)) {
    const diagnostic = `Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET}
status=401
message=Anon key supplied as SUPABASE_SERVICE_ROLE_KEY
objectPath=${objectPath}
bookingId=${bookingId}
runtime: NODE_ENV=${process.env.NODE_ENV || 'undefined'}, VERCEL=${process.env.VERCEL || 'undefined'}, VERCEL_ENV=${process.env.VERCEL_ENV || 'undefined'}`;

    if (isProduction) {
      console.error(diagnostic);
      throw new Error('STORAGE_NOT_CONFIGURED: Anon key cannot be used as SUPABASE_SERVICE_ROLE_KEY.');
    }
    return false;
  }

  try {
    const supabase = getSupabaseStorageClient();
    // Use upsert: true so that customer retries on the same booking with the same screenshot succeed cleanly
    const { data, error } = await supabase.storage
      .from(config.PAYMENT_PROOF_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (!error && data) {
      return true;
    }

    const statusCode = (error as any)?.status || (error as any)?.statusCode || '400';
    const safeErrorMessage = error?.message || 'Storage upload error';

    console.error(`Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET}
status=${statusCode}
message=${safeErrorMessage}
objectPath=${objectPath}
bookingId=${bookingId}
runtime: NODE_ENV=${process.env.NODE_ENV || 'undefined'}, VERCEL=${process.env.VERCEL || 'undefined'}, VERCEL_ENV=${process.env.VERCEL_ENV || 'undefined'}`);

    if (isProduction) {
      throw new Error(`PAYMENT_PROOF_STORAGE_FAILED: Supabase upload failed with status ${statusCode}: ${safeErrorMessage}`);
    }
    return false;
  } catch (err: any) {
    if (err?.message?.startsWith('STORAGE_NOT_CONFIGURED') || err?.message?.startsWith('PAYMENT_PROOF_STORAGE_FAILED')) {
      throw err;
    }
    console.error(`Payment proof storage failed:
provider=supabase
bucket=${config.PAYMENT_PROOF_BUCKET}
status=network_error
message=${err?.message || 'Network exception connecting to Supabase'}
objectPath=${objectPath}
bookingId=${bookingId}
runtime: NODE_ENV=${process.env.NODE_ENV || 'undefined'}, VERCEL=${process.env.VERCEL || 'undefined'}, VERCEL_ENV=${process.env.VERCEL_ENV || 'undefined'}`);

    if (isProduction) {
      throw new Error(`PAYMENT_PROOF_STORAGE_FAILED: Network error during Supabase upload: ${err?.message || 'Network error'}`);
    }
    return false;
  }
}

/**
 * Diagnostics helper to verify Supabase Storage readiness safely without leaking credentials.
 */
export async function checkStorageHealth(): Promise<{
  configured: boolean;
  provider: string;
  bucket: string;
  ready: boolean;
  error?: string;
}> {
  const url = (process.env.SUPABASE_URL || config.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const isConfigured = Boolean(
    url &&
    key &&
    !isAnonKey(key) &&
    config.PAYMENT_PROOF_BUCKET === 'payment-proofs'
  );

  if (!isConfigured) {
    return {
      configured: false,
      provider: 'supabase',
      bucket: config.PAYMENT_PROOF_BUCKET || 'payment-proofs',
      ready: false,
      error: !key
        ? 'SUPABASE_SERVICE_ROLE_KEY is missing'
        : isAnonKey(key)
        ? 'Anon key supplied as SUPABASE_SERVICE_ROLE_KEY'
        : 'Supabase storage credentials or bucket are not configured',
    };
  }

  try {
    const supabase = getSupabaseStorageClient();
    const { data, error } = await supabase.storage.getBucket(config.PAYMENT_PROOF_BUCKET);

    if (error || !data) {
      return {
        configured: true,
        provider: 'supabase',
        bucket: config.PAYMENT_PROOF_BUCKET,
        ready: false,
        error: error?.message || 'Bucket not found or permission denied',
      };
    }

    return {
      configured: true,
      provider: 'supabase',
      bucket: config.PAYMENT_PROOF_BUCKET,
      ready: true,
    };
  } catch (err: any) {
    return {
      configured: true,
      provider: 'supabase',
      bucket: config.PAYMENT_PROOF_BUCKET,
      ready: false,
      error: err?.message || 'Exception connecting to Supabase Storage',
    };
  }
}

/**
 * Generates an authenticated short-lived signed URL for an admin to view a payment proof.
 */
export async function getSignedScreenshotUrl(storagePath: string, expiresIn = 300): Promise<string | null> {
  if (!storagePath) return null;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    const cleanPath = storagePath.startsWith('supabase:') ? storagePath.replace(/^supabase:/, '') : storagePath;
    const supabase = getSupabaseStorageClient();
    const { data, error } = await supabase.storage
      .from(config.PAYMENT_PROOF_BUCKET)
      .createSignedUrl(cleanPath, expiresIn);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    if (error) {
      console.error(`Signed screenshot URL generation failed: ${error.message}`);
    }
  } catch (err) {
    console.warn('⚠️ Failed to generate signed Supabase URL:', err);
  }
  return null;
}

/**
 * Downloads a stored payment proof screenshot from private Supabase Storage or local filesystem.
 * Used for automated verification retry without requiring the customer to re-upload.
 */
export async function downloadPaymentScreenshot(storagePath: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!storagePath) return null;

  try {
    if (storagePath.startsWith('supabase:')) {
      const objectPath = storagePath.replace(/^supabase:/, '');
      const supabase = getSupabaseStorageClient();
      const { data, error } = await supabase.storage
        .from(config.PAYMENT_PROOF_BUCKET)
        .download(objectPath);

      if (error || !data) {
        console.warn(`⚠️ Failed to download proof from Supabase Storage (${objectPath}):`, error?.message);
        return null;
      }

      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const validation = validateMagicBytes(buffer);
      return {
        buffer,
        mimeType: validation.detectedType || 'image/jpeg',
      };
    }

    // Local filesystem fallback (development / test)
    if (fs.existsSync(storagePath)) {
      const buffer = fs.readFileSync(storagePath);
      const validation = validateMagicBytes(buffer);
      return {
        buffer,
        mimeType: validation.detectedType || 'image/jpeg',
      };
    }
  } catch (err: any) {
    console.warn(`⚠️ Error downloading payment screenshot (${storagePath}):`, err?.message);
  }

  return null;
}

/**
 * Strips metadata, validates dimensions/size, re-encodes to clean JPEG,
 * and persists to private Supabase bucket (mandatory in production) or fallback uploads directory (dev only).
 */
export async function processPaymentScreenshot(
  rawBuffer: Buffer,
  bookingId: string,
  originalFilename?: string,
  originalMimeType?: string
): Promise<ProcessedImageResult> {
  // 1. Size check
  if (rawBuffer.length > config.PAYMENT_SCREENSHOT_MAX_BYTES) {
    throw new Error(`Screenshot exceeds maximum allowed size of ${config.PAYMENT_SCREENSHOT_MAX_BYTES / (1024 * 1024)}MB.`);
  }

  // 2. Magic bytes validation
  const validation = validateMagicBytes(rawBuffer);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid image file.');
  }

  // 3. Metadata validation and sanitize image
  const sharp = await getSharp();
  let sanitizedBuffer = rawBuffer;
  let width = 1080;
  let height = 1920;

  if (sharp) {
    const image = sharp(rawBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Unable to parse image dimensions.');
    }

    if (metadata.width < 100 || metadata.height < 100) {
      throw new Error('Screenshot resolution is too low to be a valid payment receipt.');
    }

    if (metadata.width > 8000 || metadata.height > 8000) {
      throw new Error('Screenshot dimensions exceed safe limits.');
    }

    width = metadata.width;
    height = metadata.height;

    // Re-encode to sanitized progressive JPEG with quality 92, stripping all EXIF/GPS/comments
    sanitizedBuffer = await sharp(rawBuffer)
      .rotate() // auto-orient based on EXIF before stripping
      .withMetadata({ orientation: undefined }) // strip all metadata
      .jpeg({ quality: 92, progressive: true })
      .toBuffer();
  }

  // 4. Calculate SHA-256 and Perceptual Hash
  const sha256 = crypto.createHash('sha256').update(sanitizedBuffer).digest('hex');
  const phash = await computePerceptualHash(sanitizedBuffer);

  const filename = `${sha256.slice(0, 16)}.jpg`;
  const objectPath = `${bookingId}/${filename}`;

  // 5. Persist screenshot: Supabase Storage is mandatory in production
  const uploadedToSupabase = await uploadToSupabaseStorage(sanitizedBuffer, objectPath, 'image/jpeg', bookingId);

  let storagePath: string;
  if (uploadedToSupabase) {
    storagePath = `supabase:${objectPath}`;
  } else {
    // In production, NEVER fall back to /var/task or process.cwd()
    if (isProductionEnvironment()) {
      throw new Error('PAYMENT_PROOF_STORAGE_FAILED: Supabase storage is mandatory in production. Local filesystem writes are prohibited.');
    }
    // Local filesystem fallback strictly for local development / testing
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'payment-proofs', bookingId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    storagePath = path.join(uploadDir, filename);
    fs.writeFileSync(storagePath, sanitizedBuffer);
  }

  const isSuspiciousFilename = checkSuspiciousFilename(originalFilename);

  return {
    sanitizedBuffer,
    storagePath,
    sha256,
    phash,
    mimeType: 'image/jpeg',
    byteSize: sanitizedBuffer.length,
    width,
    height,
    originalFilename,
    originalMime: originalMimeType,
    detectedMime: validation.detectedType,
    isSuspiciousFilename,
  };
}
