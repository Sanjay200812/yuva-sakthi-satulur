-- Schema for Yuva Shakti Youth Satulur Lucky Draw Portal
-- Concurrency-safe, transactional, Supabase/PostgreSQL compatible

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sequence for concurrency-safe coupon numbering
CREATE SEQUENCE IF NOT EXISTS coupon_serial_seq START WITH 1 INCREMENT BY 1;

-- 1. Global Event Settings
CREATE TABLE IF NOT EXISTS event_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name TEXT NOT NULL,
  organizer_name TEXT NOT NULL,
  prize_name TEXT NOT NULL,
  venue TEXT NOT NULL,
  helpline TEXT NOT NULL,
  draw_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  coupon_price_paise INTEGER NOT NULL CHECK (coupon_price_paise > 0),
  coupon_prefix TEXT NOT NULL DEFAULT 'YSYS',
  max_coupons_per_booking INTEGER NOT NULL DEFAULT 20 CHECK (max_coupons_per_booking > 0),
  booking_open BOOLEAN NOT NULL DEFAULT true,
  payments_enabled BOOLEAN NOT NULL DEFAULT true,
  legal_approval_confirmed BOOLEAN NOT NULL DEFAULT true,
  licence_number TEXT,
  licence_date TEXT,
  template_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Bookings Table
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_id TEXT NOT NULL UNIQUE,
  participant_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  village TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100),
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
  total_amount_paise INTEGER NOT NULL CHECK (total_amount_paise > 0),
  status TEXT NOT NULL CHECK (status IN ('created', 'payment_pending', 'payment_confirmed', 'payment_failed', 'expired', 'refunded', 'cancelled')),
  provider_name TEXT NOT NULL DEFAULT 'direct_upi',
  download_token_hash TEXT NOT NULL,
  status_token_hash TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_public_id ON bookings(public_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);

-- 3. Payment Attempts
CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  client_txn_id TEXT NOT NULL UNIQUE,
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  provider_status TEXT,
  normalized_status TEXT NOT NULL CHECK (normalized_status IN ('pending', 'confirmed', 'failed', 'expired')),
  checkout_url TEXT,
  qr_data TEXT,
  upi_intent_uri TEXT,
  expires_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_reason TEXT,
  provider_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_booking_id ON payment_attempts(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_client_txn_id ON payment_attempts(client_txn_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_order_id ON payment_attempts(provider_order_id);

-- 4. Coupons Table (Atomic, issued only upon confirmed payment)
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  serial INTEGER NOT NULL UNIQUE,
  coupon_number TEXT NOT NULL UNIQUE,
  holder_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  village TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'void', 'refunded')),
  template_version TEXT NOT NULL DEFAULT 'v1',
  verification_token_hash TEXT NOT NULL,
  ticket_index INTEGER NOT NULL DEFAULT 1,
  total_quantity INTEGER NOT NULL DEFAULT 1,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_coupon_number ON coupons(coupon_number);
CREATE INDEX IF NOT EXISTS idx_coupons_phone ON coupons(phone);
CREATE INDEX IF NOT EXISTS idx_coupons_booking_id ON coupons(booking_id);
CREATE INDEX IF NOT EXISTS idx_coupons_status ON coupons(status);
CREATE INDEX IF NOT EXISTS idx_coupons_issued_at ON coupons(issued_at DESC);

-- 5. Payment Events (Webhook idempotency & audit)
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT true,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_result TEXT,
  error_message TEXT,
  payload JSONB
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_event_id ON payment_events(provider_event_id);

-- 6. Admin Users
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Admin Audit Logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at DESC);
