-- Migration 005: Add local OCR columns and update status check constraints
DO $$
BEGIN
  -- 1. Add OCR columns to payment_submissions table
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS ocr_extraction JSONB;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS ocr_engine TEXT DEFAULT 'tesseract.js';
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS extracted_transaction_timestamp TIMESTAMPTZ;

  -- 2. Update payment_submissions check constraint to support local OCR verification states
  ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_status_check;
  ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_status_check CHECK (status IN (
    'proof_submitted',
    'ocr_checking',
    'ocr_check_failed',
    'ocr_processing_error',
    'ai_checking',
    'ai_retry_pending',
    'ai_check_passed',
    'ai_check_failed',
    'awaiting_admin_review',
    'admin_confirmed',
    'admin_rejected',
    'proof_verified',
    'payment_confirmed',
    'payment_rejected',
    'superseded',
    'expired'
  ));

  -- 3. Update bookings check constraint to support OCR states while preserving existing states
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'created',
    'payment_initiated',
    'proof_required',
    'proof_submitted',
    'ocr_checking',
    'ocr_check_failed',
    'ocr_processing_error',
    'ai_checking',
    'ai_retry_pending',
    'ai_check_failed',
    'awaiting_admin_review',
    'proof_verified',
    'payment_confirmed',
    'payment_rejected',
    'expired',
    'refunded',
    'cancelled'
  ));
END $$;
