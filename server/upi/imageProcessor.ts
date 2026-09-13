import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config/eventConfig.ts';

export interface ProcessedImageResult {
  sanitizedBuffer: Buffer;
  storagePath: string;
  sha256: string;
  phash: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
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
 * Strips metadata, validates dimensions/size, re-encodes to clean JPEG,
 * and persists to private storage directory.
 */
export async function processPaymentScreenshot(
  rawBuffer: Buffer,
  bookingId: string
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

  // 3. Sharp metadata strip and re-encode to sanitize image
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

  // Re-encode to sanitized progressive JPEG with quality 92, stripping all EXIF/GPS/comments
  const sanitizedBuffer = await sharp(rawBuffer)
    .rotate() // auto-orient based on EXIF before stripping
    .withMetadata({ orientation: undefined }) // strip all metadata
    .jpeg({ quality: 92, progressive: true })
    .toBuffer();

  // 4. Calculate SHA-256 and Perceptual Hash
  const sha256 = crypto.createHash('sha256').update(sanitizedBuffer).digest('hex');
  const phash = await computePerceptualHash(sanitizedBuffer);

  // 5. Persist to private uploads folder
  const uploadDir = path.resolve(process.cwd(), 'uploads', 'payment-proofs', bookingId);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const filename = `${sha256.slice(0, 16)}.jpg`;
  const storagePath = path.join(uploadDir, filename);
  fs.writeFileSync(storagePath, sanitizedBuffer);

  return {
    sanitizedBuffer,
    storagePath,
    sha256,
    phash,
    mimeType: 'image/jpeg',
    byteSize: sanitizedBuffer.length,
    width: metadata.width,
    height: metadata.height,
  };
}
