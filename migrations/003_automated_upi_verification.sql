-- Migration 003: Automated UPI Verification, 5-Minute Session Expiry, and Unified Payment Confirmed Status
-- Supabase / PostgreSQL Compatible

DO $$
BEGIN
  -- 1. Add payment_expires_at column to bookings if not present
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'payment_expires_at') THEN
    ALTER TABLE bookings ADD COLUMN payment_expires_at TIMESTAMPTZ;
  END IF;

  -- 1b. Add verified_at column to bookings if not present
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'verified_at') THEN
    ALTER TABLE bookings ADD COLUMN verified_at TIMESTAMPTZ;
  END IF;

  -- 2. Relax or update status check constraint on bookings to unify on payment_confirmed
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'created',
    'payment_initiated',
    'proof_required',
    'proof_submitted',
    'ai_checking',
    'ai_check_failed',
    'awaiting_admin_review',
    'proof_verified',
    'payment_confirmed',
    'payment_rejected',
    'expired',
    'refunded',
    'cancelled'
  ));

  -- 3. Update payment_submissions check constraint to allow payment_confirmed and proof_verified
  ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_status_check;
  ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_status_check CHECK (status IN (
    'proof_submitted',
    'ai_checking',
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
END $$;

-- 4. Create index for session expiry polling/cleanups
CREATE INDEX IF NOT EXISTS idx_bookings_payment_expires_at ON bookings(payment_expires_at);

-- 5. Create unique partial index on finalized RRN hash to prevent duplicate coupons
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_submissions_confirmed_rrn 
  ON payment_submissions(payer_utr_hash) 
  WHERE status IN ('payment_confirmed', 'proof_verified');
