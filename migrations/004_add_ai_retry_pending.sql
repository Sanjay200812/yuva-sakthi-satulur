-- Migration 004: Add ai_retry_pending to payment_submissions and bookings status constraints
DO $$
BEGIN
  -- 1. Update payment_submissions check constraint to allow ai_retry_pending
  ALTER TABLE payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_status_check;
  ALTER TABLE payment_submissions ADD CONSTRAINT payment_submissions_status_check CHECK (status IN (
    'proof_submitted',
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

  -- 2. Update bookings check constraint to allow ai_retry_pending
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
  ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'created',
    'payment_initiated',
    'proof_required',
    'proof_submitted',
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
