-- Migration 007: Payment Settings Sync, Booking Snapshots, and Simplified Deterministic Verification
-- Supabase / PostgreSQL Compatible & Idempotent

DO $$
BEGIN
  -- 1. Create payment_settings table if it doesn't exist
  CREATE TABLE IF NOT EXISTS payment_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payee_upi_id TEXT NOT NULL DEFAULT '7075920852@ybl',
    payee_display_name TEXT NOT NULL DEFAULT 'Yuva Shakti Youth Satulur',
    coupon_price_paise INTEGER NOT NULL DEFAULT 5000,
    payments_enabled BOOLEAN NOT NULL DEFAULT true,
    max_quantity INTEGER NOT NULL DEFAULT 20,
    payment_session_minutes INTEGER NOT NULL DEFAULT 5 CHECK (payment_session_minutes = 5),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES admin_users(id)
  );

  -- Insert default row if table is empty
  IF NOT EXISTS (SELECT 1 FROM payment_settings) THEN
    INSERT INTO payment_settings (
      payee_upi_id,
      payee_display_name,
      coupon_price_paise,
      payments_enabled,
      max_quantity,
      payment_session_minutes
    ) VALUES (
      '7075920852@ybl',
      'Yuva Shakti Youth Satulur',
      5000,
      true,
      20,
      5
    );
  END IF;

  -- 2. Add snapshot columns to bookings table
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expected_payee_upi_id TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expected_payee_name TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_started_at TIMESTAMPTZ DEFAULT NOW();
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

  -- 3. Add columns to payment_submissions for deterministic verification
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS entered_reference_hash TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS encrypted_entered_reference TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS extracted_reference_hash TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS encrypted_extracted_reference TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS original_filename TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS ocr_engine TEXT DEFAULT 'tesseract.js';
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS ocr_extraction JSONB;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS verification_result JSONB;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS verification_reason_codes TEXT[] DEFAULT '{}';
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS extracted_amount_paise INTEGER;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS extracted_status TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS extracted_payee_upi_id TEXT;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS extracted_transaction_timestamp TIMESTAMPTZ;
  ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

  -- 4. Create partial unique index on confirmed transaction reference hashes
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_ref_hash_confirmed
    ON payment_submissions(payer_utr_hash)
    WHERE status = 'payment_confirmed';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_extracted_ref_confirmed
    ON payment_submissions(extracted_reference_hash)
    WHERE status = 'payment_confirmed';

  -- 5. Clean check constraints on payment_submissions & bookings
  ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_status_check;
  ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_status_check CHECK (status IN (
    'proof_submitted',
    'ocr_checking',
    'ocr_check_failed',
    'ocr_processing_error',
    'proof_verification_failed',
    'verification_processing',
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
    'processing_error',
    'superseded',
    'expired'
  ));

  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'created',
    'payment_initiated',
    'proof_required',
    'proof_submitted',
    'ocr_checking',
    'ocr_check_failed',
    'ocr_processing_error',
    'proof_verification_failed',
    'verification_processing',
    'ai_checking',
    'ai_retry_pending',
    'ai_check_failed',
    'awaiting_admin_review',
    'proof_verified',
    'payment_confirmed',
    'payment_rejected',
    'processing_error',
    'expired',
    'refunded',
    'cancelled'
  ));
END $$;
