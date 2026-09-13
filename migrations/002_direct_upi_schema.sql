-- Migration 002: Direct Merchant-UPI Payment Submissions, Verification Runs, and Status Transitions
-- Supabase / PostgreSQL Compatible

-- 1. Extend bookings table if columns not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'selected_upi_app') THEN
    ALTER TABLE bookings ADD COLUMN selected_upi_app TEXT DEFAULT 'other_upi';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'payment_reference') THEN
    ALTER TABLE bookings ADD COLUMN payment_reference TEXT;
  END IF;

  -- Relax or update status check constraint to support Direct UPI states
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'created',
    'payment_initiated',
    'proof_required',
    'proof_submitted',
    'ai_checking',
    'proof_verified',
    'verification_failed',
    'payment_confirmed',
    'payment_rejected',
    'expired',
    'refunded',
    'cancelled'
  ));
END $$;

-- 2. Payment Submissions Table (Direct UPI Proofs)
CREATE TABLE IF NOT EXISTS payment_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_reference TEXT NOT NULL UNIQUE,
  selected_upi_app TEXT NOT NULL,
  expected_payee_upi_id TEXT NOT NULL,
  expected_payee_name TEXT NOT NULL,
  expected_amount_paise INTEGER NOT NULL CHECK (expected_amount_paise > 0),
  payer_utr_hash TEXT NOT NULL,
  encrypted_utr TEXT NOT NULL,
  screenshot_storage_path TEXT NOT NULL,
  screenshot_sha256 TEXT NOT NULL,
  screenshot_phash TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL CHECK (status IN (
    'proof_submitted',
    'ai_checking',
    'proof_verified',
    'verification_failed',
    'superseded',
    'admin_confirmed',
    'admin_rejected',
    'expired'
  )),
  gemini_extraction JSONB,
  deterministic_comparison JSONB,
  risk_score INTEGER NOT NULL DEFAULT 0,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  ai_model_version TEXT,
  automated_decision_version TEXT,
  finalized_at TIMESTAMPTZ,
  idempotency_key TEXT,
  admin_reviewer_id UUID REFERENCES admin_users(id),
  admin_review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index: A verified UTR cannot finalize another booking
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_verified_utr 
  ON payment_submissions(payer_utr_hash) 
  WHERE status = 'proof_verified';

CREATE INDEX IF NOT EXISTS idx_payment_submissions_booking_id ON payment_submissions(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_status ON payment_submissions(status);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_sha256 ON payment_submissions(screenshot_sha256);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_created_at ON payment_submissions(created_at DESC);

-- 3. Payment Verification Runs Table
CREATE TABLE IF NOT EXISTS payment_verification_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL REFERENCES payment_submissions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence FLOAT,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  result_json JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_verification_runs_submission_id ON payment_verification_runs(submission_id);
