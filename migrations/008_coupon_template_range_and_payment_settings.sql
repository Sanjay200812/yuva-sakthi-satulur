-- Migration 008: Strict Coupon Range 1501-2250 and Sequence Configuration
-- Supabase / PostgreSQL Compatible, Additive & Idempotent

DO $$
DECLARE
  v_next_serial INTEGER;
  v_max_existing INTEGER;
BEGIN
  -- 1. Determine highest valid coupon in 1501-2250 range
  SELECT MAX(serial) INTO v_max_existing 
  FROM coupons 
  WHERE serial >= 1501 AND serial <= 2250;

  IF v_max_existing IS NOT NULL AND v_max_existing >= 1501 THEN
    v_next_serial := v_max_existing + 1;
  ELSE
    v_next_serial := 1501;
  END IF;

  -- 2. Configure sequence strictly with RESTART: MINVALUE 1501, MAXVALUE 2250, NO CYCLE
  EXECUTE format('ALTER SEQUENCE coupon_serial_seq RESTART WITH %s MINVALUE 1501 MAXVALUE 2250 START WITH 1501 NO CYCLE', v_next_serial);

  -- 3. Add Range Check constraint to coupons table (NOT VALID preserves existing historical records)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_serial_range_check'
  ) THEN
    ALTER TABLE coupons 
      ADD CONSTRAINT coupons_serial_range_check 
      CHECK (serial BETWEEN 1501 AND 2250) 
      NOT VALID;
  END IF;

  -- 4. Ensure uniqueness constraints are in place
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_serial_key'
  ) THEN
    ALTER TABLE coupons ADD CONSTRAINT coupons_serial_key UNIQUE (serial);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupons_coupon_number_key'
  ) THEN
    ALTER TABLE coupons ADD CONSTRAINT coupons_coupon_number_key UNIQUE (coupon_number);
  END IF;
END $$;
